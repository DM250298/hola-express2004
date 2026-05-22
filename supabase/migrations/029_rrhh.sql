-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 029 · FASE 4 — RR.HH. / Nóminas                          ║
-- ║                                                                     ║
-- ║   • empleados          → legajo del personal                        ║
-- ║   • novedades_empleado → horas extra, bonos, adelantos, descuentos  ║
-- ║   • liquidaciones      → cabecera mensual de sueldos                ║
-- ║   • recibos_sueldo     → un recibo por empleado por período         ║
-- ║                                                                     ║
-- ║  Liquidación simple: bruto = básico + haberes extra; aportes = un   ║
-- ║  % configurable del bruto; neto = bruto − aportes − adelantos −     ║
-- ║  otros descuentos.                                                   ║
-- ║                                                                     ║
-- ║  Funciones (atómicas):                                              ║
-- ║   • fn_liquidar_periodo    → arma el borrador con un recibo c/empl. ║
-- ║   • fn_confirmar_liquidacion → asiento de devengamiento             ║
-- ║       Debe Sueldos y Jornales / Haber Sueldos a Pagar + Cargas Soc. ║
-- ║   • fn_pagar_liquidacion   → egreso en tesorería + asiento de pago  ║
-- ║       Debe Sueldos a Pagar / Haber Caja|Bancos                      ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─── 1. Tablas ──────────────────────────────────────────────────────

create table if not exists public.empleados (
  id serial primary key,
  nombre text not null,
  documento text,
  cuil text,
  puesto text,
  fecha_ingreso date,
  fecha_egreso date,
  sueldo_basico numeric(14,2) not null default 0,
  telefono text,
  email text,
  direccion text,
  usuario_id uuid references public.usuarios(id),
  notas text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.novedades_empleado (
  id serial primary key,
  empleado_id integer not null references public.empleados(id) on delete cascade,
  periodo text not null,                    -- YYYY-MM
  tipo text not null,                       -- hora_extra|bono|presentismo|adelanto|descuento|otro
  concepto text,
  monto numeric(14,2) not null default 0,
  usuario_id uuid references public.usuarios(id),
  created_at timestamptz not null default now()
);

create index if not exists novedades_periodo_idx
  on public.novedades_empleado (periodo);
create index if not exists novedades_empleado_idx
  on public.novedades_empleado (empleado_id, periodo);

create table if not exists public.liquidaciones (
  id serial primary key,
  periodo text not null unique,             -- YYYY-MM
  estado text not null default 'borrador',  -- borrador|confirmada|pagada
  aportes_porcentaje numeric(5,2) not null default 17,
  total_bruto numeric(14,2) not null default 0,
  total_aportes numeric(14,2) not null default 0,
  total_neto numeric(14,2) not null default 0,
  asiento_id integer references public.asientos(id),
  cuenta_id integer references public.cuentas(id),
  fecha_pago date,
  usuario_id uuid references public.usuarios(id),
  created_at timestamptz not null default now(),
  confirmada_at timestamptz
);

create table if not exists public.recibos_sueldo (
  id serial primary key,
  liquidacion_id integer not null
    references public.liquidaciones(id) on delete cascade,
  empleado_id integer not null references public.empleados(id),
  sueldo_basico numeric(14,2) not null default 0,
  haberes_extra numeric(14,2) not null default 0,
  bruto numeric(14,2) not null default 0,
  aportes numeric(14,2) not null default 0,
  adelantos numeric(14,2) not null default 0,
  otros_descuentos numeric(14,2) not null default 0,
  neto numeric(14,2) not null default 0,
  pagado boolean not null default false,
  fecha_pago date,
  created_at timestamptz not null default now()
);

create index if not exists recibos_liquidacion_idx
  on public.recibos_sueldo (liquidacion_id);

-- ─── 2. RLS ─────────────────────────────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array[
    'empleados', 'novedades_empleado', 'liquidaciones', 'recibos_sueldo'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    begin
      execute format(
        'create policy "todo" on public.%I for all to authenticated using (true) with check (true)',
        t
      );
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ─── 3. fn_liquidar_periodo ─────────────────────────────────────────
-- Arma (o re-arma) el borrador de liquidación de un período.

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
  v_bruto numeric;
  v_aportes numeric;
  v_neto numeric;
  v_tot_bruto numeric := 0;
  v_tot_aportes numeric := 0;
  v_tot_neto numeric := 0;
begin
  -- Si ya hay una liquidación NO borrador, no se puede regenerar.
  if exists (
    select 1 from public.liquidaciones
    where periodo = p_periodo and estado <> 'borrador'
  ) then
    raise exception 'Ya existe una liquidación cerrada para el período %.', p_periodo;
  end if;

  -- Borrar el borrador anterior del período (los recibos caen en cascada).
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

    v_bruto := coalesce(v_emp.sueldo_basico, 0) + v_haberes;
    v_aportes := round(v_bruto * v_pct / 100, 2);
    v_neto := v_bruto - v_aportes - v_adelantos - v_descuentos;

    insert into public.recibos_sueldo (
      liquidacion_id, empleado_id, sueldo_basico, haberes_extra,
      bruto, aportes, adelantos, otros_descuentos, neto
    ) values (
      v_liq.id, v_emp.id, coalesce(v_emp.sueldo_basico, 0), v_haberes,
      v_bruto, v_aportes, v_adelantos, v_descuentos, v_neto
    );

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
end;
$$;

-- ─── 4. fn_confirmar_liquidacion ────────────────────────────────────
-- Cierra el borrador y genera el asiento de devengamiento.

create or replace function public.fn_confirmar_liquidacion(
  p_liquidacion_id integer,
  p_usuario_id uuid
) returns public.liquidaciones
language plpgsql
security definer
set search_path = public
as $$
declare
  v_liq public.liquidaciones;
  v_asiento_id integer;
  v_cta_sueldos integer;
  v_cta_apagar integer;
  v_cta_cargas integer;
  v_orden integer := 0;
begin
  select * into v_liq from public.liquidaciones where id = p_liquidacion_id;
  if v_liq.id is null then
    raise exception 'La liquidación no existe.';
  end if;
  if v_liq.estado <> 'borrador' then
    raise exception 'La liquidación ya fue confirmada.';
  end if;

  select id into v_cta_sueldos from public.plan_cuentas where codigo = '5.2.01';
  select id into v_cta_apagar from public.plan_cuentas where codigo = '2.1.03';
  select id into v_cta_cargas from public.plan_cuentas where codigo = '2.1.04';

  if v_liq.total_bruto > 0 and v_cta_sueldos is not null
     and v_cta_apagar is not null then
    insert into public.asientos (fecha, descripcion, tipo, origen, referencia_id, usuario_id)
    values (
      current_date, 'Sueldos ' || v_liq.periodo,
      'automatico', 'liquidacion', v_liq.id, p_usuario_id
    )
    returning id into v_asiento_id;

    insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
    values (v_asiento_id, v_cta_sueldos, v_liq.total_bruto, 0, v_orden);
    v_orden := v_orden + 1;

    insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
    values (v_asiento_id, v_cta_apagar, 0, v_liq.total_neto, v_orden);
    v_orden := v_orden + 1;

    if v_liq.total_aportes > 0 and v_cta_cargas is not null then
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_cargas, 0, v_liq.total_aportes, v_orden);
    end if;
  end if;

  update public.liquidaciones
    set estado = 'confirmada',
        confirmada_at = now(),
        asiento_id = v_asiento_id
    where id = v_liq.id
    returning * into v_liq;

  return v_liq;
end;
$$;

-- ─── 5. fn_pagar_liquidacion ────────────────────────────────────────
-- Paga todos los recibos desde una cuenta de tesorería.

create or replace function public.fn_pagar_liquidacion(
  p_liquidacion_id integer,
  p_cuenta_id integer,
  p_usuario_id uuid
) returns public.liquidaciones
language plpgsql
security definer
set search_path = public
as $$
declare
  v_liq public.liquidaciones;
  v_saldo numeric;
  v_tipo public.tipo_cuenta;
  v_hoy date := current_date;
  v_asiento_id integer;
  v_cta_apagar integer;
  v_cta_dinero integer;
begin
  select * into v_liq from public.liquidaciones where id = p_liquidacion_id;
  if v_liq.id is null then
    raise exception 'La liquidación no existe.';
  end if;
  if v_liq.estado = 'borrador' then
    raise exception 'Primero confirmá la liquidación.';
  end if;
  if v_liq.estado = 'pagada' then
    raise exception 'La liquidación ya está pagada.';
  end if;

  select saldo_actual, tipo into v_saldo, v_tipo
    from public.cuentas where id = p_cuenta_id for update;
  if v_saldo is null then
    raise exception 'La cuenta de pago no existe.';
  end if;

  -- Movimiento de tesorería (egreso) por el neto total.
  if v_liq.total_neto > 0 then
    insert into public.movimientos_cuenta (
      cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo,
      descripcion, categoria, referencia_tipo, referencia_id, usuario_id, fecha
    ) values (
      p_cuenta_id, 'egreso', v_liq.total_neto,
      v_saldo, v_saldo - v_liq.total_neto,
      'Pago de sueldos ' || v_liq.periodo, 'sueldos',
      'liquidacion', v_liq.id, p_usuario_id, v_hoy
    );
    update public.cuentas
      set saldo_actual = v_saldo - v_liq.total_neto, updated_at = now()
      where id = p_cuenta_id;
  end if;

  -- Asiento de pago: Debe Sueldos a Pagar / Haber Caja|Bancos.
  select id into v_cta_apagar from public.plan_cuentas where codigo = '2.1.03';
  select id into v_cta_dinero from public.plan_cuentas
    where codigo = case when v_tipo = 'caja' then '1.1.01' else '1.1.02' end;

  if v_liq.total_neto > 0 and v_cta_apagar is not null
     and v_cta_dinero is not null then
    insert into public.asientos (fecha, descripcion, tipo, origen, referencia_id, usuario_id)
    values (
      v_hoy, 'Pago sueldos ' || v_liq.periodo,
      'automatico', 'pago_sueldos', v_liq.id, p_usuario_id
    )
    returning id into v_asiento_id;
    insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
    values (v_asiento_id, v_cta_apagar, v_liq.total_neto, 0, 0);
    insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
    values (v_asiento_id, v_cta_dinero, 0, v_liq.total_neto, 1);
  end if;

  update public.recibos_sueldo
    set pagado = true, fecha_pago = v_hoy
    where liquidacion_id = v_liq.id;

  update public.liquidaciones
    set estado = 'pagada', cuenta_id = p_cuenta_id, fecha_pago = v_hoy
    where id = v_liq.id
    returning * into v_liq;

  return v_liq;
end;
$$;

-- ─── 6. Permiso 'rrhh' para el rol admin ────────────────────────────

do $$ begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'roles'
  ) then
    update public.roles
    set permisos = array_append(permisos, 'rrhh'),
        updated_at = now()
    where codigo = 'admin'
      and not ('rrhh' = any(permisos));
  end if;
end $$;

notify pgrst, 'reload schema';
