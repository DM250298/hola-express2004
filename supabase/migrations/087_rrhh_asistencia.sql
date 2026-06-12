-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 087 · RRHH Sprint 2 — Asistencia (tablas + PIN)           ║
-- ║                                                                     ║
-- ║  Turnos, horarios planificados, fichajes (append-only, idempotentes),║
-- ║  asistencia diaria derivada, trazabilidad de importaciones del reloj ║
-- ║  biométrico, y credenciales (PIN bcrypt) del kiosco.                 ║
-- ║                                                                     ║
-- ║  · Fuente PRINCIPAL de fichajes: el .xls del reloj (origen           ║
-- ║    'import_reloj'), idempotente por UNIQUE parcial (empleado,ts).    ║
-- ║  · Kiosco con PIN = respaldo; idempotente por id (client uuid), igual║
-- ║    patrón que cliente_uuid del POS.                                  ║
-- ║  · asistencia_diaria es DERIVADA: sólo la escriben las fn_*.         ║
-- ║  · El PIN se hashea con bcrypt (pgcrypto) y vive en una tabla SIN    ║
-- ║    policies → el hash jamás sale por la API; sólo fn_validar_pin     ║
-- ║    (security definer) lo compara.                                    ║
-- ║                                                                     ║
-- ║  Las FUNCIONES de cálculo (fn_recalcular_asistencia,                 ║
-- ║  fn_importar_fichajes, fn_registrar_fichaje, fn_cerrar_dia_…) van    ║
-- ║  en la migración 088.                                                ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- pgcrypto para crypt()/gen_salt() del PIN. En Supabase suele venir en el
-- schema `extensions`; if not exists lo deja idempotente.
create extension if not exists pgcrypto with schema extensions;

-- ─── 1. Enums ────────────────────────────────────────────────────────────
do $$ begin
  create type public.nombre_turno as enum ('manana', 'tarde', 'noche');
exception when duplicate_object then null; end $$;

do $$ begin
  -- 'marcacion' = punch crudo del reloj (no distingue entrada/salida; se
  -- emparejan en fn_recalcular_asistencia). 'correccion' = ajuste manual.
  create type public.tipo_fichaje as enum
    ('entrada', 'salida', 'marcacion', 'correccion');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.origen_fichaje as enum
    ('import_reloj', 'kiosco', 'manual_admin', 'app');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.estado_horario as enum
    ('planificado', 'cubierto', 'ausente', 'franco', 'licencia');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.estado_asistencia as enum
    ('presente', 'tardanza', 'ausente_justificado', 'ausente_injustificado',
     'franco', 'licencia', 'incompleto', 'sin_turno');
exception when duplicate_object then null; end $$;

-- ─── 2. Turnos plantilla (config) ────────────────────────────────────────
create table if not exists public.turnos_plantilla (
  id            serial primary key,
  nombre        public.nombre_turno not null unique,
  hora_inicio   time not null,
  hora_fin      time not null,
  -- cruza_medianoche se deriva de hora_fin < hora_inicio (turno noche).
  cruza_medianoche boolean generated always as (hora_fin <= hora_inicio) stored,
  tolerancia_min integer not null default 10,
  activo        boolean not null default true
);

insert into public.turnos_plantilla (nombre, hora_inicio, hora_fin, tolerancia_min) values
  ('manana', '06:00', '14:00', 10),
  ('tarde',  '14:00', '22:00', 10),
  ('noche',  '22:00', '06:00', 10)
on conflict (nombre) do nothing;

-- ─── 3. Horarios asignados (planificación, rotación 14 días) ─────────────
create table if not exists public.horarios_asignados (
  id          uuid primary key default gen_random_uuid(),
  empleado_id integer not null references public.empleados(id) on delete cascade,
  turno_id    integer references public.turnos_plantilla(id),  -- null en franco/licencia
  fecha       date not null,
  estado      public.estado_horario not null default 'planificado',
  notas       text,
  usuario_id  uuid references public.usuarios(id),
  created_at  timestamptz not null default now(),
  unique (empleado_id, fecha)
);
create index if not exists horarios_fecha_idx on public.horarios_asignados (fecha);
create index if not exists horarios_empleado_idx on public.horarios_asignados (empleado_id, fecha);

-- ─── 4. Importaciones del reloj (trazabilidad de cada subida) ────────────
create table if not exists public.importaciones_fichajes (
  id                uuid primary key default gen_random_uuid(),
  usuario_id        uuid references public.usuarios(id),
  archivo_nombre    text,
  periodo_desde     date,
  periodo_hasta     date,
  total_marcaciones integer not null default 0,
  nuevas            integer not null default 0,
  duplicadas        integer not null default 0,
  sin_match         integer not null default 0,
  dias_recalculados integer not null default 0,
  estado            text not null default 'completada',  -- completada|error
  created_at        timestamptz not null default now()
);

-- ─── 5. Fichajes (append-only; nunca se editan) ──────────────────────────
create table if not exists public.fichajes (
  id                   uuid primary key default gen_random_uuid(),  -- client-gen en kiosco (idempotencia offline)
  empleado_id          integer not null references public.empleados(id) on delete cascade,
  tipo                 public.tipo_fichaje not null,
  momento              timestamptz not null,   -- instante de la marcación
  origen               public.origen_fichaje not null,
  fichaje_corregido_id uuid references public.fichajes(id),  -- si tipo='correccion'
  import_id            uuid references public.importaciones_fichajes(id) on delete set null,
  usuario_id           uuid references public.usuarios(id),  -- quién lo registró (manual_admin)
  notas                text,
  created_at           timestamptz not null default now()
);
create index if not exists fichajes_empleado_ts_idx on public.fichajes (empleado_id, momento);
create index if not exists fichajes_import_idx on public.fichajes (import_id);
-- Idempotencia del reloj: la misma marcación (empleado+instante) no se duplica.
create unique index if not exists fichajes_reloj_uq
  on public.fichajes (empleado_id, momento)
  where origen = 'import_reloj';

-- ─── 6. Asistencia diaria (DERIVADA — sólo la escriben las fn_*) ─────────
create table if not exists public.asistencia_diaria (
  empleado_id        integer not null references public.empleados(id) on delete cascade,
  fecha              date not null,                 -- día del TURNO (la noche se imputa al día que arranca)
  turno_id           integer references public.turnos_plantilla(id),
  entrada_real       timestamptz,
  salida_real        timestamptz,
  minutos_trabajados integer not null default 0,
  minutos_tardanza   integer not null default 0,
  horas_extra_50     numeric(6,2) not null default 0,
  horas_extra_100    numeric(6,2) not null default 0,
  estado             public.estado_asistencia not null default 'sin_turno',
  marcaciones        integer not null default 0,    -- cuántas marcaciones se usaron
  updated_at         timestamptz not null default now(),
  primary key (empleado_id, fecha)
);
create index if not exists asistencia_fecha_idx on public.asistencia_diaria (fecha);

-- ─── 7. Credenciales (PIN bcrypt) — tabla SIN policies ──────────────────
-- El hash jamás se lee por la API: la tabla queda con RLS habilitado y CERO
-- policies (deny total para todos). Sólo las funciones SECURITY DEFINER
-- (fn_set_pin / fn_validar_pin) la tocan, corriendo como owner.
create table if not exists public.empleado_credencial (
  empleado_id integer primary key references public.empleados(id) on delete cascade,
  pin_hash    text not null,
  updated_at  timestamptz not null default now()
);

create or replace function public.fn_set_pin(p_empleado_id integer, p_pin text)
returns void language plpgsql security definer
set search_path = public, extensions as $$
begin
  if not public.fn_tiene_permiso('rrhh') then
    raise exception 'Sin permiso para definir PIN.';
  end if;
  if p_pin is null or p_pin !~ '^\d{4}$' then
    raise exception 'El PIN debe ser de 4 dígitos.';
  end if;
  -- PIN único por empleado: dos empleados no pueden compartir PIN (el kiosco
  -- identifica por nombre + PIN, pero igual lo forzamos para evitar líos).
  if exists (
    select 1 from public.empleado_credencial c
    where c.empleado_id <> p_empleado_id and crypt(p_pin, c.pin_hash) = c.pin_hash
  ) then
    raise exception 'Ese PIN ya está en uso por otro empleado.';
  end if;
  insert into public.empleado_credencial (empleado_id, pin_hash, updated_at)
  values (p_empleado_id, crypt(p_pin, gen_salt('bf', 10)), now())
  on conflict (empleado_id)
  do update set pin_hash = excluded.pin_hash, updated_at = now();
end $$;
grant execute on function public.fn_set_pin(integer, text) to authenticated;

create or replace function public.fn_validar_pin(p_empleado_id integer, p_pin text)
returns boolean language sql stable security definer
set search_path = public, extensions as $$
  select exists (
    select 1 from public.empleado_credencial
    where empleado_id = p_empleado_id and crypt(p_pin, pin_hash) = pin_hash
  )
$$;
-- Sólo se usa internamente desde fn_registrar_fichaje (SECURITY DEFINER → el
-- owner conserva el execute). Revocar el acceso directo por PostgREST evita un
-- oráculo de fuerza bruta del PIN de 4 dígitos por parte de cualquier autenticado.
revoke execute on function public.fn_validar_pin(integer, text) from public;

-- ─── 8. RLS ──────────────────────────────────────────────────────────────
-- Helper local (se dropea al final).
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
    || 'using (public.fn_tiene_permiso(%L)) with check (public.fn_tiene_permiso(%L))',
    p_tabla, p_permiso, p_permiso);
end $$;

-- Operativo (rrhh): turnos, importaciones.
select public.fn__rls_gate('turnos_plantilla',      'rrhh');
select public.fn__rls_gate('importaciones_fichajes', 'rrhh');

-- horarios_asignados: rrhh ve/edita todo; el empleado ve los suyos.
alter table public.horarios_asignados enable row level security;
drop policy if exists "horarios_select" on public.horarios_asignados;
drop policy if exists "horarios_write"  on public.horarios_asignados;
create policy "horarios_select" on public.horarios_asignados for select to authenticated
  using (
    public.fn_tiene_permiso('rrhh')
    or empleado_id in (select id from public.empleados where usuario_id = auth.uid())
  );
create policy "horarios_write" on public.horarios_asignados for all to authenticated
  using (public.fn_tiene_permiso('rrhh')) with check (public.fn_tiene_permiso('rrhh'));

-- fichajes: rrhh ve/edita todo (correcciones manuales); el empleado ve los
-- suyos (su panel). El kiosco inserta vía fn_registrar_fichaje (definer).
alter table public.fichajes enable row level security;
drop policy if exists "fichajes_select" on public.fichajes;
drop policy if exists "fichajes_write"  on public.fichajes;
create policy "fichajes_select" on public.fichajes for select to authenticated
  using (
    public.fn_tiene_permiso('rrhh')
    or empleado_id in (select id from public.empleados where usuario_id = auth.uid())
  );
create policy "fichajes_write" on public.fichajes for all to authenticated
  using (public.fn_tiene_permiso('rrhh')) with check (public.fn_tiene_permiso('rrhh'));

-- asistencia_diaria: rrhh ve todo; el empleado ve la suya. Escritura sólo
-- por las fn_* (definer); igual gateamos la escritura directa a rrhh.
alter table public.asistencia_diaria enable row level security;
drop policy if exists "asistencia_select" on public.asistencia_diaria;
drop policy if exists "asistencia_write"  on public.asistencia_diaria;
create policy "asistencia_select" on public.asistencia_diaria for select to authenticated
  using (
    public.fn_tiene_permiso('rrhh')
    or empleado_id in (select id from public.empleados where usuario_id = auth.uid())
  );
create policy "asistencia_write" on public.asistencia_diaria for all to authenticated
  using (public.fn_tiene_permiso('rrhh')) with check (public.fn_tiene_permiso('rrhh'));

-- empleado_credencial: RLS habilitado, SIN policies → nadie la lee/escribe
-- directo; sólo fn_set_pin / fn_validar_pin (definer).
alter table public.empleado_credencial enable row level security;

drop function if exists public.fn__rls_gate(text, text);

notify pgrst, 'reload schema';
