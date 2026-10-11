-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 230 · Incidencias operativas y sanciones formales        ║
-- ║                                                                     ║
-- ║  Manual Maestro §8 y Reglamento §10 (oct-2026): los incumplimientos ║
-- ║  se registran como hecho objetivo por persona y tipología. La       ║
-- ║  reincidencia se evalúa por la MISMA tipología dentro de 30 días:   ║
-- ║    1ª → registro + corrección inmediata                             ║
-- ║    2ª → observación formal interna + acción correctiva              ║
-- ║    3ª → escala a Resp. General y Dirección                          ║
-- ║    grave → escala de inmediato                                      ║
-- ║  Esa escala es OPERATIVA. Las sanciones FORMALES (estatuto art. 13: ║
-- ║  llamado de atención, apercibimiento, suspensión ≤30 días,          ║
-- ║  exclusión) las aplica Dirección y, salvo el llamado de atención,   ║
-- ║  quedan en el legajo (art. 18).                                     ║
-- ║                                                                     ║
-- ║  Tablas: tipologias_incidencia (catálogo + seed), incidencias,      ║
-- ║  sanciones, sancion_incidencias. Estados como text + check.         ║
-- ║  Escritura SOLO por RPC (mig 231/232): sin policy de insert.        ║
-- ║  Ejecutar UNA sola vez en el SQL Editor. Primero PRUEBA, después    ║
-- ║  PRODUCCIÓN.                                                        ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─── 1. Catálogo de tipologías ───────────────────────────────────────
create table if not exists public.tipologias_incidencia (
  id serial primary key,
  codigo text not null unique,
  nombre text not null,
  gravedad_default text not null default 'leve'
    check (gravedad_default in ('leve', 'grave')),
  orden integer not null default 100,
  activa boolean not null default true
);

insert into public.tipologias_incidencia (codigo, nombre, gravedad_default, orden) values
  ('faltante_no_avisado',        'Faltante visible no avisado',                 'leve',  10),
  ('precio_incorrecto',          'Producto exhibido sin precio o con precio incorrecto', 'leve', 20),
  ('produccion_tardia',          'Producción iniciada después de las 07:20',    'leve',  30),
  ('tarea_critica_no_realizada', 'Tarea crítica no realizada sin registro',     'leve',  40),
  ('pase_turno_incompleto',      'Pase de turno incompleto o no conforme',      'leve',  50),
  ('impuntualidad',              'Impuntualidad',                               'leve',  60),
  ('ausencia_sin_aviso',         'Ausencia sin aviso',                          'grave', 70),
  ('recepcion_mal_cerrada',      'Recepción mal cerrada o mercadería liberada antes', 'leve', 80),
  ('uso_telefono',               'Uso del teléfono que interfiere con la operación', 'leve', 90),
  ('deposito_desordenado',       'Depósito desordenado o ubicaciones cambiadas', 'leve', 100),
  ('vencido_exhibido',           'Mercadería vencida exhibida',                 'grave', 110),
  ('otro',                       'Otro incumplimiento operativo',               'leve', 999)
on conflict (codigo) do nothing;

-- ─── 2. Incidencias ──────────────────────────────────────────────────
create table if not exists public.incidencias (
  id serial primary key,
  empleado_id integer not null references public.empleados(id),
  tipologia_id integer not null references public.tipologias_incidencia(id),
  fecha date not null,
  turno_id integer references public.turnos_plantilla(id),
  tarea_turno_id uuid references public.tareas_turno(id) on delete set null,
  descripcion text not null,
  gravedad text not null check (gravedad in ('leve', 'grave')),
  -- Instancia según la escala de 30 días (1, 2 o 3+). La calcula la RPC.
  instancia smallint not null check (instancia between 1 and 3),
  reincidencias_30d smallint not null default 0,
  escalada boolean not null default false,
  accion_correctiva text,
  estado text not null default 'abierta' check (estado in ('abierta', 'cerrada')),
  cerrada_at timestamptz,
  cerrada_por uuid references public.usuarios(id),
  registrada_por uuid not null references public.usuarios(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists incidencias_empleado_fecha_idx
  on public.incidencias (empleado_id, fecha desc);
create index if not exists incidencias_tipologia_empleado_fecha_idx
  on public.incidencias (tipologia_id, empleado_id, fecha);
create index if not exists incidencias_abiertas_idx
  on public.incidencias (fecha) where estado = 'abierta';

-- ─── 3. Sanciones formales ───────────────────────────────────────────
create table if not exists public.sanciones (
  id serial primary key,
  empleado_id integer not null references public.empleados(id),
  tipo text not null check (
    tipo in ('llamado_atencion', 'apercibimiento', 'suspension', 'exclusion')
  ),
  fecha date not null,
  motivo text not null,
  dias_suspension integer
    check (dias_suspension is null or dias_suspension between 1 and 30),
  referencia_acta text,
  resolucion text,
  -- Art. 18: salvo llamado de atención, se registra en el legajo.
  va_al_legajo boolean not null,
  aplicada_por uuid not null references public.usuarios(id),
  anulada_at timestamptz,
  anulada_por uuid references public.usuarios(id),
  motivo_anulacion text,
  created_at timestamptz not null default now(),
  constraint sanciones_suspension_dias
    check (tipo <> 'suspension' or dias_suspension is not null)
);

create index if not exists sanciones_empleado_fecha_idx
  on public.sanciones (empleado_id, fecha desc);

create table if not exists public.sancion_incidencias (
  sancion_id integer not null references public.sanciones(id) on delete cascade,
  incidencia_id integer not null references public.incidencias(id) on delete cascade,
  primary key (sancion_id, incidencia_id)
);

-- ─── 4. RLS ──────────────────────────────────────────────────────────
alter table public.tipologias_incidencia enable row level security;
drop policy if exists "tipologias_inc_select" on public.tipologias_incidencia;
drop policy if exists "tipologias_inc_write"  on public.tipologias_incidencia;
create policy "tipologias_inc_select" on public.tipologias_incidencia
  for select to authenticated
  using (
    (select public.fn_tiene_permiso('rrhh'))
    or (select public.fn_tiene_permiso('tareas_gestion'))
    or (select public.fn_tiene_permiso('mi_panel'))
  );
create policy "tipologias_inc_write" on public.tipologias_incidencia
  for all to authenticated
  using ((select public.fn_tiene_permiso('rrhh')))
  with check ((select public.fn_tiene_permiso('rrhh')));

-- Incidencias: rrhh ve todas; el empleado ve las propias. Alta solo por RPC.
alter table public.incidencias enable row level security;
drop policy if exists "incidencias_select" on public.incidencias;
drop policy if exists "incidencias_update" on public.incidencias;
drop policy if exists "incidencias_delete" on public.incidencias;
create policy "incidencias_select" on public.incidencias
  for select to authenticated
  using (
    (select public.fn_tiene_permiso('rrhh'))
    or empleado_id = (select public.fn_mi_empleado_id())
  );
create policy "incidencias_update" on public.incidencias
  for update to authenticated
  using ((select public.fn_tiene_permiso('rrhh')))
  with check ((select public.fn_tiene_permiso('rrhh')));
create policy "incidencias_delete" on public.incidencias
  for delete to authenticated
  using ((select public.fn_tiene_permiso('rrhh_sanciones')));

-- Sanciones: solo Dirección (rrhh_sanciones) y el propio empleado.
alter table public.sanciones enable row level security;
drop policy if exists "sanciones_select" on public.sanciones;
drop policy if exists "sanciones_update" on public.sanciones;
create policy "sanciones_select" on public.sanciones
  for select to authenticated
  using (
    (select public.fn_tiene_permiso('rrhh_sanciones'))
    or empleado_id = (select public.fn_mi_empleado_id())
  );
create policy "sanciones_update" on public.sanciones
  for update to authenticated
  using ((select public.fn_tiene_permiso('rrhh_sanciones')))
  with check ((select public.fn_tiene_permiso('rrhh_sanciones')));

alter table public.sancion_incidencias enable row level security;
drop policy if exists "sancion_inc_select" on public.sancion_incidencias;
create policy "sancion_inc_select" on public.sancion_incidencias
  for select to authenticated
  using (
    (select public.fn_tiene_permiso('rrhh_sanciones'))
    or exists (
      select 1 from public.sanciones s
      where s.id = sancion_id
        and s.empleado_id = (select public.fn_mi_empleado_id())
    )
  );

notify pgrst, 'reload schema';
