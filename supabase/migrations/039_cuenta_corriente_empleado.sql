-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 039 · Cuenta corriente de empleados                       ║
-- ║                                                                     ║
-- ║  Cada empleado tiene una cuenta corriente con consumos (ej. se      ║
-- ║  llevó mercadería del local) y pagos (canceló en efectivo). Al      ║
-- ║  liquidar el sueldo del mes, el saldo deudor se descuenta           ║
-- ║  automáticamente del neto.                                          ║
-- ║                                                                     ║
-- ║  Movimientos (monto siempre con signo):                             ║
-- ║   · consumo          → POSITIVO (aumenta lo que debe)               ║
-- ║   · pago_libre       → NEGATIVO (paga fuera del sueldo)             ║
-- ║   · descuento_sueldo → NEGATIVO (lo creamos al liquidar)            ║
-- ║   · ajuste           → libre (perdón, error de carga, etc.)         ║
-- ║                                                                     ║
-- ║  Saldo deudor del empleado = sum(monto) de todos sus movimientos.   ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─── 1. Tabla ──────────────────────────────────────────────────────────

create table if not exists public.cuenta_corriente_empleado (
  id serial primary key,
  empleado_id integer not null
    references public.empleados(id) on delete cascade,
  fecha date not null default current_date,
  tipo text not null,                              -- consumo|pago_libre|descuento_sueldo|ajuste
  concepto text,
  monto numeric(14,2) not null,                    -- con signo
  recibo_id integer
    references public.recibos_sueldo(id) on delete cascade,
  usuario_id uuid references public.usuarios(id),
  created_at timestamptz not null default now()
);

create index if not exists cce_empleado_idx
  on public.cuenta_corriente_empleado (empleado_id);
create index if not exists cce_recibo_idx
  on public.cuenta_corriente_empleado (recibo_id);

-- RLS permisivo a nivel SQL; la UI filtra.
alter table public.cuenta_corriente_empleado enable row level security;
do $$ begin
  create policy "todo" on public.cuenta_corriente_empleado
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null;
end $$;

-- ─── 2. Columna descuento_cta_cte en recibos ───────────────────────────

alter table public.recibos_sueldo
  add column if not exists descuento_cta_cte numeric(14,2) not null default 0;

-- ─── 3. Función: saldo deudor actual de un empleado ───────────────────

create or replace function public.fn_saldo_cta_cte_empleado(p_empleado_id integer)
returns numeric
language sql
stable
as $$
  select coalesce(sum(monto), 0)
  from public.cuenta_corriente_empleado
  where empleado_id = p_empleado_id;
$$;

-- ─── 4. Vista: empleados con saldo corriente ──────────────────────────

create or replace view public.vista_empleados_saldo
with (security_invoker = true) as
select
  e.*,
  coalesce(
    (
      select sum(monto)
      from public.cuenta_corriente_empleado cce
      where cce.empleado_id = e.id
    ),
    0
  ) as saldo_cta_cte
from public.empleados e;

grant select on public.vista_empleados_saldo to anon, authenticated;

-- ─── 5. Reemplazo de fn_liquidar_periodo con descuento de cta. cte. ───

create or replace function public.fn_liquidar_periodo(
  p_periodo text,
  p_aportes_porcentaje numeric,
  p_usuario_id uuid
) returns public.liquidaciones
language plpgsql
security definer
set search_path = public
as $$
declare
  v_liq public.liquidaciones;
  v_emp record;
  v_pct numeric := coalesce(p_aportes_porcentaje, 0);
  v_haberes numeric;
  v_adelantos numeric;
  v_descuentos numeric;
  v_saldo_cta numeric;
  v_descuento_cta numeric;
  v_bruto numeric;
  v_aportes numeric;
  v_neto numeric;
  v_recibo_id integer;
  v_tot_bruto numeric := 0;
  v_tot_aportes numeric := 0;
  v_tot_neto numeric := 0;
begin
  if exists (
    select 1 from public.liquidaciones
    where periodo = p_periodo and estado <> 'borrador'
  ) then
    raise exception 'Ya existe una liquidación cerrada para el período %.', p_periodo;
  end if;

  delete from public.liquidaciones
    where periodo = p_periodo and estado = 'borrador';

  insert into public.liquidaciones (periodo, estado, aportes_porcentaje, usuario_id)
  values (p_periodo, 'borrador', v_pct, p_usuario_id)
  returning * into v_liq;

  for v_emp in
    select id, sueldo_basico from public.empleados where activo = true
  loop
    select
      coalesce(sum(monto) filter (
        where tipo in ('hora_extra', 'bono', 'presentismo', 'otro')), 0),
      coalesce(sum(monto) filter (where tipo = 'adelanto'), 0),
      coalesce(sum(monto) filter (where tipo = 'descuento'), 0)
    into v_haberes, v_adelantos, v_descuentos
    from public.novedades_empleado
    where empleado_id = v_emp.id and periodo = p_periodo;

    -- Saldo deudor actual de cta. cte. (solo movimientos no vinculados
    -- todavía a un recibo). Si es positivo (debe), se descuenta del sueldo.
    select coalesce(sum(monto), 0)
      into v_saldo_cta
      from public.cuenta_corriente_empleado
      where empleado_id = v_emp.id
        and recibo_id is null;
    v_descuento_cta := greatest(0, v_saldo_cta);

    v_bruto := coalesce(v_emp.sueldo_basico, 0) + v_haberes;
    v_aportes := round(v_bruto * v_pct / 100, 2);
    v_neto := v_bruto - v_aportes - v_adelantos - v_descuentos - v_descuento_cta;

    insert into public.recibos_sueldo (
      liquidacion_id, empleado_id, sueldo_basico, haberes_extra,
      bruto, aportes, adelantos, otros_descuentos,
      descuento_cta_cte, neto
    ) values (
      v_liq.id, v_emp.id, coalesce(v_emp.sueldo_basico, 0), v_haberes,
      v_bruto, v_aportes, v_adelantos, v_descuentos,
      v_descuento_cta, v_neto
    ) returning id into v_recibo_id;

    -- Si hubo descuento por cta. cte., crear un movimiento negativo que
    -- cancela el saldo pendiente y se vincula al recibo. Si más adelante
    -- se borra el borrador, este movimiento cae en cascade y el saldo
    -- vuelve a aparecer en el empleado.
    if v_descuento_cta > 0 then
      insert into public.cuenta_corriente_empleado (
        empleado_id, fecha, tipo, concepto, monto, recibo_id, usuario_id
      ) values (
        v_emp.id, current_date, 'descuento_sueldo',
        format('Liquidación %s', p_periodo),
        -v_descuento_cta, v_recibo_id, p_usuario_id
      );
    end if;

    v_tot_bruto := v_tot_bruto + v_bruto;
    v_tot_aportes := v_tot_aportes + v_aportes;
    v_tot_neto := v_tot_neto + v_neto;
  end loop;

  update public.liquidaciones
    set total_bruto = v_tot_bruto,
        total_aportes = v_tot_aportes,
        total_neto = v_tot_neto
    where id = v_liq.id
    returning * into v_liq;

  return v_liq;
end $$;

grant execute on function public.fn_liquidar_periodo(text, numeric, uuid)
  to authenticated;

notify pgrst, 'reload schema';
