-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 085 · RRHH Sprint 1 — Legajo de empleados + documentos    ║
-- ║                                                                     ║
-- ║  Primer ladrillo del módulo RRHH nuevo. Evoluciona la tabla         ║
-- ║  `empleados` (que ya existía simple) sin romper el flujo de         ║
-- ║  liquidación legacy, y separa el SUELDO a una tabla gateada aparte  ║
-- ║  (mismo patrón que `costos_producto`) para que el encargado pueda   ║
-- ║  ver el personal SIN ver montos de sueldo — ni por la UI ni por la  ║
-- ║  API (RLS real, no solo ocultar en el front).                       ║
-- ║                                                                     ║
-- ║  Decisiones (ver chat):                                             ║
-- ║   · empleados.id sigue siendo integer (tabla maestra, no offline).  ║
-- ║     El UUID se reserva para fichajes/tareas (alta frecuencia).      ║
-- ║   · sueldo_basico/valor_hora → tabla `empleado_sueldo` gateada por  ║
-- ║     permiso 'rrhh_sueldos' (solo admin). fn_sueldo()/fn_set_sueldo  ║
-- ║     como fn_costo()/fn_set_costo().                                  ║
-- ║   · permiso 'rrhh' pasa a ser OPERATIVO (admin + encargado);        ║
-- ║     'rrhh_sueldos' gatea todo monto salarial (solo admin).          ║
-- ║   · rol nuevo 'empleado' (login propio para su panel, Sprint 5).    ║
-- ║                                                                     ║
-- ║  Tablas nuevas: empleado_sueldo, empleado_documentos, rrhh_config.  ║
-- ║  Buckets: rrhh-docs (privado), rrhh-fotos (público).                ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─── 1. Enums ────────────────────────────────────────────────────────────
do $$ begin
  create type public.unidad_negocio as enum
    ('hola_express', 'nor_construcciones', 'otra');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.tipo_contrato as enum
    ('relacion_dependencia', 'monotributista', 'informal_a_regularizar');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.tipo_documento_empleado as enum
    ('dni', 'cuil', 'contrato', 'apto_medico', 'certificado', 'otro');
exception when duplicate_object then null; end $$;

-- ─── 2. Secuencia + generador de legajo (EMP-001) ────────────────────────
create sequence if not exists public.empleados_legajo_seq start 1;

create or replace function public.fn_generar_legajo()
returns text language sql volatile as $$
  select 'EMP-' || lpad(nextval('public.empleados_legajo_seq')::text, 3, '0')
$$;
grant execute on function public.fn_generar_legajo() to authenticated;

-- ─── 3. Evolución de `empleados` ─────────────────────────────────────────
alter table public.empleados
  add column if not exists legajo          text,
  add column if not exists apellido        text,
  add column if not exists dni             text,
  add column if not exists fecha_nacimiento date,
  add column if not exists unidad_negocio  public.unidad_negocio not null default 'hola_express',
  add column if not exists tipo_contrato   public.tipo_contrato  not null default 'informal_a_regularizar',
  add column if not exists banco_cbu_alias text,
  add column if not exists reloj_id        integer,
  add column if not exists foto_url        text;
-- Nota: el PIN del kiosco (pin_hash) llega en el Sprint 2 junto con el fichaje,
-- en una tabla de credenciales gateada para que el hash NUNCA viaje al cliente.

-- dni: backfill desde el `documento` legacy (se conserva `documento` por
-- compatibilidad con el módulo de cta. cte. existente).
update public.empleados
  set dni = documento
  where dni is null and documento is not null and btrim(documento) <> '';

-- legajo: backfill de los existentes, default para los nuevos, único + not null.
update public.empleados
  set legajo = public.fn_generar_legajo()
  where legajo is null;
alter table public.empleados
  alter column legajo set default public.fn_generar_legajo();
alter table public.empleados
  alter column legajo set not null;
create unique index if not exists empleados_legajo_uq   on public.empleados (legajo);
create unique index if not exists empleados_reloj_id_uq on public.empleados (reloj_id);

-- ─── 4. Tabla gateada de sueldos (patrón costos_producto) ────────────────
create table if not exists public.empleado_sueldo (
  empleado_id   integer primary key references public.empleados(id) on delete cascade,
  sueldo_basico numeric(14,2) not null default 0,
  -- valor_hora = sueldo / 200 (configurable: si hace falta otra base se pasa
  -- a fn_ leyendo rrhh_config.divisor_valor_hora). Hoy GENERATED por fila.
  valor_hora    numeric(14,2) generated always as (round(sueldo_basico / 200.0, 2)) stored,
  updated_at    timestamptz not null default now()
);

-- Migrar los sueldos que hoy viven en empleados.sueldo_basico ANTES de
-- dropear la columna.
insert into public.empleado_sueldo (empleado_id, sueldo_basico)
  select id, coalesce(sueldo_basico, 0) from public.empleados
  on conflict (empleado_id) do nothing;

create or replace function public.fn_sueldo(p_empleado_id integer)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sueldo_basico, 0) from public.empleado_sueldo
  where empleado_id = p_empleado_id
$$;

create or replace function public.fn_set_sueldo(p_empleado_id integer, p_sueldo numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.empleado_sueldo (empleado_id, sueldo_basico, updated_at)
  values (p_empleado_id, coalesce(p_sueldo, 0), now())
  on conflict (empleado_id)
  do update set sueldo_basico = excluded.sueldo_basico, updated_at = now();
end $$;

-- ⚠ Seguridad: estas funciones son SECURITY DEFINER → bypassan la RLS de
-- empleado_sueldo. Si quedaran ejecutables por PostgREST, CUALQUIER autenticado
-- (encargado, cajero) podría leer/escribir sueldos vía rpc('fn_sueldo'/'fn_set_sueldo'),
-- saltándose el gate 'rrhh_sueldos'. Por eso se REVOCA el EXECUTE por defecto a
-- PUBLIC. El único llamador legítimo es fn_liquidar_periodo (también definer, corre
-- como owner → conserva el execute). El front lee el sueldo por el embed gateado
-- empleado_sueldo(...) y lo escribe por upsert directo: ambos pasan por RLS.
revoke execute on function public.fn_sueldo(integer) from public;
revoke execute on function public.fn_set_sueldo(integer, numeric) from public;

-- ─── 5. Re-issue fn_liquidar_periodo: lee el sueldo vía fn_sueldo() ──────
-- (Base = versión 039 con descuento de cta. cte.; sólo cambia la fuente del
-- sueldo básico. Misma firma para no romper el POS de liquidaciones legacy,
-- que sigue vivo hasta que el Sprint 4 lo reemplace por el modelo nuevo.)
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
  v_sueldo numeric;
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
    select id from public.empleados where activo = true
  loop
    v_sueldo := coalesce(public.fn_sueldo(v_emp.id), 0);

    select
      coalesce(sum(monto) filter (
        where tipo in ('hora_extra', 'bono', 'presentismo', 'otro')), 0),
      coalesce(sum(monto) filter (where tipo = 'adelanto'), 0),
      coalesce(sum(monto) filter (where tipo = 'descuento'), 0)
    into v_haberes, v_adelantos, v_descuentos
    from public.novedades_empleado
    where empleado_id = v_emp.id and periodo = p_periodo;

    select coalesce(sum(monto), 0)
      into v_saldo_cta
      from public.cuenta_corriente_empleado
      where empleado_id = v_emp.id
        and recibo_id is null;
    v_descuento_cta := greatest(0, v_saldo_cta);

    v_bruto := v_sueldo + v_haberes;
    v_aportes := round(v_bruto * v_pct / 100, 2);
    v_neto := v_bruto - v_aportes - v_adelantos - v_descuentos - v_descuento_cta;

    insert into public.recibos_sueldo (
      liquidacion_id, empleado_id, sueldo_basico, haberes_extra,
      bruto, aportes, adelantos, otros_descuentos,
      descuento_cta_cte, neto
    ) values (
      v_liq.id, v_emp.id, v_sueldo, v_haberes,
      v_bruto, v_aportes, v_adelantos, v_descuentos,
      v_descuento_cta, v_neto
    ) returning id into v_recibo_id;

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

-- ─── 6. Dropear empleados.sueldo_basico (la vista depende de e.*) ────────
-- La vista vista_empleados_saldo hace `select e.*` → hay que recrearla
-- después de dropear la columna, o el ALTER falla por dependencia.
drop view if exists public.vista_empleados_saldo;

alter table public.empleados drop column if exists sueldo_basico;

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

-- ─── 7. Documentos del empleado ──────────────────────────────────────────
create table if not exists public.empleado_documentos (
  id                 uuid primary key default gen_random_uuid(),
  empleado_id        integer not null references public.empleados(id) on delete cascade,
  tipo               public.tipo_documento_empleado not null default 'otro',
  archivo_url        text not null,        -- path dentro del bucket rrhh-docs
  nombre_archivo     text,
  fecha_vencimiento  date,                 -- aptos médicos / certificados que vencen
  notas              text,
  usuario_id         uuid references public.usuarios(id),
  created_at         timestamptz not null default now()
);
create index if not exists empleado_documentos_empleado_idx
  on public.empleado_documentos (empleado_id);
create index if not exists empleado_documentos_venc_idx
  on public.empleado_documentos (fecha_vencimiento)
  where fecha_vencimiento is not null;

-- ─── 8. Config key-value de RRHH (nada hardcodeado) ─────────────────────
create table if not exists public.rrhh_config (
  clave       text primary key,
  valor       jsonb not null,
  descripcion text,
  updated_at  timestamptz not null default now()
);

insert into public.rrhh_config (clave, valor, descripcion) values
  ('tolerancia_tardanza_min',   '10',    'Minutos de gracia antes de marcar tardanza'),
  ('divisor_valor_hora',        '200',   'Divisor del sueldo básico para el valor hora'),
  ('presentismo_porcentaje',    '8.33',  'Presentismo como % del sueldo básico'),
  ('presentismo_max_tardanzas', '3',     'Tardanzas que hacen perder el presentismo'),
  ('presentismo_max_ausencias', '1',     'Ausencias injustificadas que hacen perder el presentismo'),
  ('hora_extra_50_factor',      '1.5',   'Factor de hora extra al 50% (días hábiles)'),
  ('hora_extra_100_factor',     '2.0',   'Factor de hora extra al 100% (feriados/domingos)'),
  ('eval_ponderacion_asistencia', '40',  'Peso % de asistencia en la evaluación de desempeño'),
  ('eval_ponderacion_tareas',     '40',  'Peso % de tareas en la evaluación de desempeño'),
  ('eval_ponderacion_manual',     '20',  'Peso % de la evaluación manual del dueño')
on conflict (clave) do nothing;

-- ─── 9. Storage: buckets rrhh-docs (privado) y rrhh-fotos (público) ──────
insert into storage.buckets (id, name, public) values
  ('rrhh-docs',  'rrhh-docs',  false),
  ('rrhh-fotos', 'rrhh-fotos', true)
on conflict (id) do nothing;

drop policy if exists "rrhh_docs_leer"   on storage.objects;
drop policy if exists "rrhh_docs_subir"  on storage.objects;
drop policy if exists "rrhh_docs_editar" on storage.objects;
drop policy if exists "rrhh_docs_borrar" on storage.objects;

create policy "rrhh_docs_leer" on storage.objects
  for select to authenticated
  using (bucket_id = 'rrhh-docs' and public.fn_tiene_permiso('rrhh'));
create policy "rrhh_docs_subir" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'rrhh-docs' and public.fn_tiene_permiso('rrhh'));
create policy "rrhh_docs_editar" on storage.objects
  for update to authenticated
  using (bucket_id = 'rrhh-docs' and public.fn_tiene_permiso('rrhh'))
  with check (bucket_id = 'rrhh-docs' and public.fn_tiene_permiso('rrhh'));
create policy "rrhh_docs_borrar" on storage.objects
  for delete to authenticated
  using (bucket_id = 'rrhh-docs' and public.fn_tiene_permiso('rrhh'));

drop policy if exists "rrhh_fotos_subir"  on storage.objects;
drop policy if exists "rrhh_fotos_editar" on storage.objects;
drop policy if exists "rrhh_fotos_borrar" on storage.objects;

create policy "rrhh_fotos_subir" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'rrhh-fotos' and public.fn_tiene_permiso('rrhh'));
create policy "rrhh_fotos_editar" on storage.objects
  for update to authenticated
  using (bucket_id = 'rrhh-fotos' and public.fn_tiene_permiso('rrhh'))
  with check (bucket_id = 'rrhh-fotos' and public.fn_tiene_permiso('rrhh'));
create policy "rrhh_fotos_borrar" on storage.objects
  for delete to authenticated
  using (bucket_id = 'rrhh-fotos' and public.fn_tiene_permiso('rrhh'));
-- (lectura de rrhh-fotos es pública por ser bucket público)

-- ─── 10. Permisos y roles ────────────────────────────────────────────────
do $$ begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'roles'
  ) then
    -- 'rrhh' (operativo) pasa a estar también en encargado.
    update public.roles
      set permisos = array_append(permisos, 'rrhh'), updated_at = now()
      where codigo = 'encargado' and not ('rrhh' = any(permisos));

    -- 'rrhh_sueldos' (montos salariales) sólo para admin (que igual pasa por
    -- hardcode en fn_tiene_permiso; se agrega explícito para la matriz).
    update public.roles
      set permisos = array_append(permisos, 'rrhh_sueldos'), updated_at = now()
      where codigo = 'admin' and not ('rrhh_sueldos' = any(permisos));

    -- Rol 'empleado': autoservicio (ficha + fichaje + su panel). Sin acceso a
    -- montos. El wiring de /rrhh/mi-panel llega en el Sprint 5.
    insert into public.roles (codigo, nombre, es_sistema, permisos)
      values ('empleado', 'Empleado', true, array['mi_panel'])
      on conflict (codigo) do nothing;
  end if;
end $$;

-- ─── 11. RLS ─────────────────────────────────────────────────────────────
-- Helper local (se dropea al final) que gatea una tabla por permiso.
create or replace function public.fn__rls_gate(p_tabla text, p_permiso text)
returns void language plpgsql as $$
declare v_pol text;
begin
  for v_pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = p_tabla
  loop
    execute format('drop policy %I on public.%I', v_pol, p_tabla);
  end loop;
  execute format('alter table public.%I enable row level security', p_tabla);
  execute format(
    'create policy "gate_rw" on public.%I for all to authenticated '
    || 'using (public.fn_tiene_permiso(%L)) '
    || 'with check (public.fn_tiene_permiso(%L))',
    p_tabla, p_permiso, p_permiso);
end $$;

-- Tablas con MONTO salarial → 'rrhh_sueldos' (encargado NO ve nada de esto).
select public.fn__rls_gate('empleado_sueldo',    'rrhh_sueldos');
select public.fn__rls_gate('liquidaciones',      'rrhh_sueldos');
select public.fn__rls_gate('recibos_sueldo',     'rrhh_sueldos');
select public.fn__rls_gate('novedades_empleado', 'rrhh_sueldos');
-- (cuenta_corriente_empleado queda en 'rrhh': es deuda operativa de consumo,
--  no revela sueldos; la dejó gateada la mig 047, no se toca.)

-- Config de RRHH → 'rrhh' (operativo).
select public.fn__rls_gate('rrhh_config', 'rrhh');

-- empleados: rrhh ve/edita todo; el propio empleado ve SU ficha (para el
-- panel del Sprint 5). Sin montos: el sueldo vive en empleado_sueldo.
do $$ declare v_pol text; begin
  for v_pol in select policyname from pg_policies
    where schemaname='public' and tablename='empleados'
  loop execute format('drop policy %I on public.empleados', v_pol); end loop;
end $$;
alter table public.empleados enable row level security;
create policy "empleados_select" on public.empleados for select to authenticated
  using (public.fn_tiene_permiso('rrhh') or usuario_id = auth.uid());
create policy "empleados_insert" on public.empleados for insert to authenticated
  with check (public.fn_tiene_permiso('rrhh'));
create policy "empleados_update" on public.empleados for update to authenticated
  using (public.fn_tiene_permiso('rrhh'))
  with check (public.fn_tiene_permiso('rrhh'));
create policy "empleados_delete" on public.empleados for delete to authenticated
  using (public.fn_tiene_permiso('rrhh'));

-- empleado_documentos: rrhh ve/edita todo; el empleado ve los suyos.
alter table public.empleado_documentos enable row level security;
drop policy if exists "emp_docs_select" on public.empleado_documentos;
drop policy if exists "emp_docs_write"  on public.empleado_documentos;
create policy "emp_docs_select" on public.empleado_documentos for select to authenticated
  using (
    public.fn_tiene_permiso('rrhh')
    or empleado_id in (select id from public.empleados where usuario_id = auth.uid())
  );
create policy "emp_docs_write" on public.empleado_documentos for all to authenticated
  using (public.fn_tiene_permiso('rrhh'))
  with check (public.fn_tiene_permiso('rrhh'));

drop function if exists public.fn__rls_gate(text, text);

-- ─── 12. Seed del mapeo del reloj biométrico (editable desde la ficha) ──
-- Departamento "hola" del export real. Sólo setea si el empleado existe por
-- nombre y todavía no tiene reloj_id (idempotente, no pisa ediciones manuales).
do $$
declare
  v_map jsonb := '[
    {"n":"sonia","r":1},{"n":"camila","r":2},{"n":"rebeca","r":3},
    {"n":"agustin","r":6},{"n":"tomas","r":8},{"n":"santiago","r":9},
    {"n":"gaston","r":10},{"n":"alan","r":13},{"n":"carlos","r":14}
  ]'::jsonb;
  v_item jsonb;
begin
  for v_item in select * from jsonb_array_elements(v_map) loop
    -- Apuntar a UNA sola fila: si dos empleados comparten prefijo de nombre, un
    -- UPDATE por LIKE asignaría el mismo reloj_id a ambos y violaría el índice
    -- único (abortando toda la migración). El subselect con limit 1 lo evita.
    update public.empleados
      set reloj_id = (v_item->>'r')::int
      where id = (
        select id from public.empleados
        where reloj_id is null
          and lower(nombre) like (v_item->>'n') || '%'
        order by id
        limit 1
      )
      and not exists (
        select 1 from public.empleados e2 where e2.reloj_id = (v_item->>'r')::int
      );
  end loop;
end $$;

notify pgrst, 'reload schema';
