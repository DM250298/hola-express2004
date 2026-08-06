-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 139 · Cuenta corriente (fiado) — cimientos               ║
-- ║                                                                     ║
-- ║  PROBLEMA: el POS no puede fiar. La cta. cte. de EMPLEADOS existe   ║
-- ║  (mig 039, la liquidación la descuenta del recibo) pero se carga a  ║
-- ║  mano; para CLIENTES no existe nada.                                ║
-- ║                                                                     ║
-- ║  SOLUCIÓN (fase 1 de 5):                                            ║
-- ║   1. `cuenta_corriente_cliente` — espejo del libro del empleado     ║
-- ║      (movimientos con signo: consumo +, pago −; saldo = sum(monto)) ║
-- ║   2. Columnas de trazabilidad en `cuenta_corriente_empleado`        ║
-- ║      (venta_id, turno_id, cuenta_id, movimiento_id, asiento_id)     ║
-- ║   3. `limite_credito` — tope de fiado por deudor (cliente XOR       ║
-- ║      empleado). Tabla APARTE y gateada: el tope del empleado es su  ║
-- ║      sueldo, y `empleados` la leen el propio empleado y el cajero.  ║
-- ║      Fila ausente o monto 0 = NO se le fía (opt-in explícito).      ║
-- ║   4. Seed de topes de empleados = sueldo básico (owner bypasea el   ║
-- ║      gate de empleado_sueldo)                                       ║
-- ║   5. fn_saldo_cta_cte_cliente + vista_clientes con saldo y tope     ║
-- ║   6. fn_buscar_deudores — buscador unificado del POS (definer).     ║
-- ║      Para EMPLEADOS devuelve disponible NULL: el cupo revelaría el  ║
-- ║      sueldo al cajero. Para clientes sí devuelve el disponible.     ║
-- ║   7. fn_limite_sugerido_empleado — sugerencia (solo rrhh_sueldos)   ║
-- ║   8. Medio de pago 'cuenta_corriente' (cuenta_id NULL, no acredita) ║
-- ║   9. RLS + permiso nuevo 'cuenta_corriente' a administración y      ║
-- ║      encargado (¡no existe rol 'admin' en producción!)              ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─── 1. Tabla: cuenta corriente de clientes ──────────────────────────
-- Mismo modelo que cuenta_corriente_empleado (mig 039): libro de
-- movimientos con signo. consumo → POSITIVO (debe más), pago_libre →
-- NEGATIVO (pagó), ajuste → libre (perdón, corrección, reversión).
-- El cliente no tiene 'descuento_sueldo': ese tipo es solo del empleado.

create table if not exists public.cuenta_corriente_cliente (
  id          serial primary key,
  cliente_id  integer not null
    references public.clientes(id) on delete restrict,
  fecha       date not null default current_date,
  tipo        text not null check (tipo in ('consumo', 'pago_libre', 'ajuste')),
  concepto    text,
  monto       numeric(14,2) not null,            -- CON SIGNO
  venta_id    integer references public.ventas(id) on delete set null,
  turno_id    integer references public.caja_turnos(id),
  cuenta_id   integer references public.cuentas(id),
  movimiento_id integer,
  asiento_id  integer references public.asientos(id) on delete set null,
  usuario_id  uuid references public.usuarios(id),
  created_at  timestamptz not null default now()
);

comment on column public.cuenta_corriente_cliente.monto is
  'Con signo: consumo positivo (aumenta la deuda), pago/ajuste negativo (la cancela). Saldo del cliente = sum(monto).';
comment on column public.cuenta_corriente_cliente.turno_id is
  'Turno de caja si el movimiento nació en el POS (consumo de una venta o cobro en efectivo del cajón).';
comment on column public.cuenta_corriente_cliente.cuenta_id is
  'Cuenta de tesorería acreditada si el cobro entró por Finanzas (transferencia, etc.). NULL si fue en la caja.';

-- on delete restrict en cliente_id a propósito: no se pierde deuda por
-- borrar un cliente (el ABM desactiva, no borra).

create index if not exists ccc_cliente_idx
  on public.cuenta_corriente_cliente (cliente_id, fecha desc, id desc);
create index if not exists ccc_venta_idx
  on public.cuenta_corriente_cliente (venta_id) where venta_id is not null;
create index if not exists ccc_turno_idx
  on public.cuenta_corriente_cliente (turno_id) where turno_id is not null;

-- ─── 2. Simetría: trazabilidad en la cta. cte. del empleado ──────────
-- Todo aditivo y nullable: fn_generar_liquidacion (090) y la UI de RRHH
-- siguen andando sin cambios.

alter table public.cuenta_corriente_empleado
  add column if not exists venta_id      integer references public.ventas(id) on delete set null,
  add column if not exists turno_id      integer references public.caja_turnos(id),
  add column if not exists cuenta_id     integer references public.cuentas(id),
  add column if not exists movimiento_id integer,
  add column if not exists asiento_id    integer references public.asientos(id) on delete set null;

create index if not exists cce_venta_idx
  on public.cuenta_corriente_empleado (venta_id) where venta_id is not null;
create index if not exists cce_turno_idx
  on public.cuenta_corriente_empleado (turno_id) where turno_id is not null;

-- ─── 3. Límite de crédito por deudor ─────────────────────────────────
-- Tabla aparte (NO columna en clientes/empleados): el tope sugerido del
-- empleado ES su sueldo básico, y `empleados` la leen el propio empleado
-- (usuario_id = auth.uid()) y todo rol con 'rrhh' (cajero incluido).
-- Acá queda gateada al permiso 'cuenta_corriente'.

create table if not exists public.limite_credito (
  id          serial primary key,
  cliente_id  integer references public.clientes(id)  on delete cascade,
  empleado_id integer references public.empleados(id) on delete cascade,
  monto       numeric(14,2) not null default 0 check (monto >= 0),
  nota        text,
  usuario_id  uuid references public.usuarios(id),
  updated_at  timestamptz not null default now(),
  check (num_nonnulls(cliente_id, empleado_id) = 1)
);

comment on table public.limite_credito is
  'Tope de fiado por deudor (cliente XOR empleado). Sin fila o monto 0 = no se le fía. El POS bloquea al superarlo.';

create unique index if not exists limite_credito_cliente_uq
  on public.limite_credito (cliente_id) where cliente_id is not null;
create unique index if not exists limite_credito_empleado_uq
  on public.limite_credito (empleado_id) where empleado_id is not null;

-- ─── 4. Seed: tope inicial del empleado = su sueldo básico ───────────
-- La migración corre como owner → lee empleado_sueldo sin pasar por el
-- gate de RLS. Después el tope se edita desde la UI (permiso
-- cuenta_corriente) sin volver a tocar el sueldo.

insert into public.limite_credito (empleado_id, monto, nota)
select e.id, coalesce(s.sueldo_basico, 0),
       'Sugerido: sueldo básico al ' || to_char(current_date, 'DD/MM/YYYY')
from public.empleados e
join public.empleado_sueldo s on s.empleado_id = e.id
where e.activo and coalesce(s.sueldo_basico, 0) > 0
on conflict do nothing;

-- ─── 5. Saldo del cliente + vista del CRM ────────────────────────────

create or replace function public.fn_saldo_cta_cte_cliente(p_cliente_id integer)
returns numeric
language sql
stable
as $$
  select coalesce(sum(monto), 0)
  from public.cuenta_corriente_cliente
  where cliente_id = p_cliente_id;
$$;

-- vista_clientes: se recrea (drop + create, patrón 085) sumando el saldo
-- de cta. cte. y el tope al final. Es security_invoker: la policy de
-- SELECT de cuenta_corriente_cliente y limite_credito debe incluir el
-- permiso 'clientes' (ver §8) o el CRM vería saldo 0 en silencio.
drop view if exists public.vista_clientes;

create view public.vista_clientes
with (security_invoker = true) as
select
  c.*,
  coalesce(count(v.id) filter (where v.estado = 'completada'), 0)
    as cantidad_compras,
  coalesce(sum(v.total) filter (where v.estado = 'completada'), 0)
    as total_gastado,
  max(v.fecha) filter (where v.estado = 'completada')
    as ultima_compra,
  coalesce((
    select sum(cc.monto)
    from public.cuenta_corriente_cliente cc
    where cc.cliente_id = c.id
  ), 0) as saldo_cta_cte,
  (
    select l.monto
    from public.limite_credito l
    where l.cliente_id = c.id
  ) as limite_credito
from public.clientes c
left join public.ventas v on v.cliente_id = c.id
group by c.id;

grant select on public.vista_clientes to anon, authenticated;

-- ─── 6. Buscador unificado de deudores (POS) ─────────────────────────
-- Definer: el cajero NO puede leer empleados/cta_cte_empleado/limite por
-- RLS, pero necesita elegir a quién fiarle. La función devuelve lo mínimo:
-- nombre, saldo y si tiene cupo. Para EMPLEADOS, `disponible` viaja NULL
-- a propósito: tope − saldo con saldo bajo revelaría el sueldo al cajero.

create or replace function public.fn_buscar_deudores(
  p_busqueda text,
  p_limite   integer default 8
)
returns table (
  deudor_tipo text,
  deudor_id   integer,
  nombre      text,
  documento   text,
  saldo       numeric,
  tiene_cupo  boolean,
  disponible  numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q text := coalesce(nullif(btrim(p_busqueda), ''), '');
begin
  if not ((select public.fn_tiene_permiso('pos'))
       or (select public.fn_tiene_permiso('cuenta_corriente'))) then
    raise exception 'Sin permiso para consultar cuentas corrientes.';
  end if;

  return query
  select * from (
    select 'cliente'::text as deudor_tipo,
           c.id as deudor_id,
           c.nombre,
           c.documento,
           coalesce((select sum(x.monto) from public.cuenta_corriente_cliente x
                     where x.cliente_id = c.id), 0) as saldo,
           coalesce((select sum(x.monto) from public.cuenta_corriente_cliente x
                     where x.cliente_id = c.id), 0)
             < coalesce(l.monto, 0) - 0.009 as tiene_cupo,
           greatest(0, coalesce(l.monto, 0)
             - coalesce((select sum(x.monto) from public.cuenta_corriente_cliente x
                         where x.cliente_id = c.id), 0)) as disponible
    from public.clientes c
    left join public.limite_credito l on l.cliente_id = c.id
    where c.activo
      and (v_q = ''
           or c.nombre ilike '%' || v_q || '%'
           or coalesce(c.documento, '') ilike v_q || '%'
           or coalesce(c.telefono, '') ilike '%' || v_q || '%')

    union all

    select 'empleado'::text,
           e.id,
           btrim(coalesce(e.nombre, '') || ' ' || coalesce(e.apellido, '')),
           coalesce(e.dni, e.documento),
           coalesce((select sum(x.monto) from public.cuenta_corriente_empleado x
                     where x.empleado_id = e.id), 0),
           coalesce((select sum(x.monto) from public.cuenta_corriente_empleado x
                     where x.empleado_id = e.id), 0)
             < coalesce(l.monto, 0) - 0.009,
           null::numeric   -- ← el POS NO recibe el cupo del empleado (= su sueldo)
    from public.empleados e
    left join public.limite_credito l on l.empleado_id = e.id
    where e.activo
      and (v_q = ''
           or btrim(coalesce(e.nombre, '') || ' ' || coalesce(e.apellido, '')) ilike '%' || v_q || '%'
           or coalesce(e.dni, '') ilike v_q || '%'
           or coalesce(e.documento, '') ilike v_q || '%')
  ) s
  order by s.nombre
  limit greatest(1, coalesce(p_limite, 8));
end $$;

revoke execute on function public.fn_buscar_deudores(text, integer) from anon;
grant  execute on function public.fn_buscar_deudores(text, integer) to authenticated;

-- ─── 7. Sugerencia de tope del empleado (solo rrhh_sueldos) ──────────
-- Para el botón "Sugerir sueldo básico" del modal de topes. Gateada:
-- devuelve el sueldo, así que solo quien ya puede verlo la ejecuta.

create or replace function public.fn_limite_sugerido_empleado(p_empleado_id integer)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (select public.fn_tiene_permiso('rrhh_sueldos')) then
    raise exception 'Sin permiso para ver la sugerencia de tope (sueldos).';
  end if;
  return coalesce((
    select s.sueldo_basico from public.empleado_sueldo s
    where s.empleado_id = p_empleado_id
  ), 0);
end $$;

revoke execute on function public.fn_limite_sugerido_empleado(integer) from anon;
grant  execute on function public.fn_limite_sugerido_empleado(integer) to authenticated;

-- ─── 8. Medio de pago 'cuenta_corriente' ─────────────────────────────
-- Medio REAL (no código sintético del front): aparece en el ModalCobro
-- con nombre/ícono/orden editables y en el desglose del cierre de caja.
-- cuenta_id NULL + acredita_en_venta false → no mueve plata en la venta
-- (el trigger trg_guard_medio_cuenta de la 118 lo re-blinda solo).

insert into public.medios_pago
  (codigo, nombre, icono, activo, orden, comision_porcentaje,
   cuenta_id, protegido, dias_acreditacion, disponible_terminal, acredita_en_venta)
values
  ('cuenta_corriente', 'Cuenta corriente', 'hand-coins', true, 90, 0,
   null, true, 0, false, false)
on conflict (codigo) do update
  set cuenta_id = null,
      comision_porcentaje = 0,
      dias_acreditacion = 0,
      disponible_terminal = false,
      acredita_en_venta = false,
      protegido = true;

-- ─── 9. RLS ──────────────────────────────────────────────────────────
-- Lectura: fiado ('cuenta_corriente') + CRM ('clientes', porque
-- vista_clientes es security_invoker y necesita leer saldo/tope).
-- Escritura directa: SOLO 'cuenta_corriente' (los movimientos del POS y
-- de cobranza entran por RPCs security definer, que bypasean esto).

alter table public.cuenta_corriente_cliente enable row level security;

drop policy if exists "cta_cte_cliente_select" on public.cuenta_corriente_cliente;
create policy "cta_cte_cliente_select" on public.cuenta_corriente_cliente
  for select to authenticated
  using ((select public.fn_tiene_permiso('cuenta_corriente'))
      or (select public.fn_tiene_permiso('clientes')));

drop policy if exists "cta_cte_cliente_write" on public.cuenta_corriente_cliente;
create policy "cta_cte_cliente_write" on public.cuenta_corriente_cliente
  for insert to authenticated
  with check ((select public.fn_tiene_permiso('cuenta_corriente')));

drop policy if exists "cta_cte_cliente_update" on public.cuenta_corriente_cliente;
create policy "cta_cte_cliente_update" on public.cuenta_corriente_cliente
  for update to authenticated
  using ((select public.fn_tiene_permiso('cuenta_corriente')))
  with check ((select public.fn_tiene_permiso('cuenta_corriente')));

drop policy if exists "cta_cte_cliente_delete" on public.cuenta_corriente_cliente;
create policy "cta_cte_cliente_delete" on public.cuenta_corriente_cliente
  for delete to authenticated
  using ((select public.fn_tiene_permiso('cuenta_corriente')));

alter table public.limite_credito enable row level security;

-- El permiso 'clientes' (que tienen cajero/fiambrero) solo ve topes de
-- CLIENTES: el tope del empleado ≈ su sueldo y queda solo para
-- 'cuenta_corriente'.
drop policy if exists "limite_credito_select" on public.limite_credito;
create policy "limite_credito_select" on public.limite_credito
  for select to authenticated
  using ((select public.fn_tiene_permiso('cuenta_corriente'))
      or ((select public.fn_tiene_permiso('clientes')) and cliente_id is not null));

drop policy if exists "limite_credito_write" on public.limite_credito;
create policy "limite_credito_write" on public.limite_credito
  for insert to authenticated
  with check ((select public.fn_tiene_permiso('cuenta_corriente')));

drop policy if exists "limite_credito_update" on public.limite_credito;
create policy "limite_credito_update" on public.limite_credito
  for update to authenticated
  using ((select public.fn_tiene_permiso('cuenta_corriente')))
  with check ((select public.fn_tiene_permiso('cuenta_corriente')));

drop policy if exists "limite_credito_delete" on public.limite_credito;
create policy "limite_credito_delete" on public.limite_credito
  for delete to authenticated
  using ((select public.fn_tiene_permiso('cuenta_corriente')));

-- ─── 10. Permiso nuevo a los roles reales ────────────────────────────
-- NO existe rol 'admin' en producción (el dueño usa 'administración', y
-- el bypass hardcodeado de fn_tiene_permiso no le aplica): asignación
-- explícita. Idempotente vía el guard @>.

update public.roles
   set permisos = permisos || '{cuenta_corriente}'
 where (codigo ilike 'administra%' or codigo in ('admin', 'encargado'))
   and not (permisos @> '{cuenta_corriente}');

notify pgrst, 'reload schema';
