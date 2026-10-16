-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 251 · Tareas con horario: esquema para la agenda por     ║
-- ║  turno (Personal › Tareas › Agenda del día)                         ║
-- ║                                                                     ║
-- ║  Hasta acá una tarea solo sabía su fecha y su turno. Para ordenar   ║
-- ║  cronológicamente, detectar atraso y mostrar carga por persona      ║
-- ║  hacen falta hora, duración, ventana y tipo de actividad, tanto en  ║
-- ║  la plantilla (tareas_recurrentes) como en la instancia del día     ║
-- ║  (tareas_turno). También se registra quién inició, por qué se       ║
-- ║  omitió y el traslado al turno siguiente con trazabilidad.          ║
-- ║                                                                     ║
-- ║  Semántica de fecha: tareas_turno.fecha es el día en que EMPIEZA el ║
-- ║  turno (igual que horarios_asignados). La noche del lunes termina   ║
-- ║  el martes a la hora_fin del turno noche.                           ║
-- ║                                                                     ║
-- ║  Las plantillas existentes quedan con hora NULL ("durante el        ║
-- ║  turno"): la hora se carga desde Configurar rutina, no se inventa.  ║
-- ║  REQUIERE: migs 087, 089, 158, 248. Primero PRUEBA, después PROD.   ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─── 1. Tipo de actividad ───────────────────────────────────────────────
--  puntual  → tarea con hora y duración (entra en la lista cronológica)
--  continua → durante todo el turno (atención al público, orden): banner,
--             no se lista ni cuenta como "tarea a completar"
--  bloque   → descanso / pase de turno: se lista como bloque de tiempo
do $$ begin
  create type public.tipo_actividad_tarea as enum ('puntual', 'continua', 'bloque');
exception when duplicate_object then null; end $$;

-- ─── 2. Plantillas ──────────────────────────────────────────────────────
alter table public.tareas_recurrentes
  add column if not exists hora time,
  -- Alternativa a `hora`: minutos desde el inicio del turno. Si el turno
  -- cambia de horario, la tarea se mueve sola en la próxima sincronización.
  add column if not exists minutos_desde_inicio integer
    check (minutos_desde_inicio is null or minutos_desde_inicio >= 0),
  add column if not exists duracion_min integer
    check (duracion_min is null or duracion_min > 0),
  -- Plazo para completarla desde `hora`; NULL = igual a duracion_min.
  add column if not exists ventana_min integer
    check (ventana_min is null or ventana_min > 0),
  add column if not exists tipo_actividad public.tipo_actividad_tarea
    not null default 'puntual',
  add column if not exists checklist text[] not null default '{}';

comment on column public.tareas_recurrentes.hora is
  'Hora del reloj en que empieza (AR). NULL = durante el turno, sin hora fija.';
comment on column public.tareas_recurrentes.minutos_desde_inicio is
  'Alternativa a hora: minutos desde hora_inicio del turno. La materialización resuelve la hora.';
comment on column public.tareas_recurrentes.ventana_min is
  'Minutos desde hora para completarla antes de quedar atrasada. NULL = duracion_min.';

-- ─── 3. Instancias del día ──────────────────────────────────────────────
alter table public.tareas_turno
  add column if not exists hora time,
  add column if not exists duracion_min integer
    check (duracion_min is null or duracion_min > 0),
  add column if not exists ventana_min integer
    check (ventana_min is null or ventana_min > 0),
  add column if not exists tipo_actividad public.tipo_actividad_tarea
    not null default 'puntual',
  add column if not exists checklist text[] not null default '{}',
  add column if not exists iniciada_por integer references public.empleados(id) on delete set null,
  add column if not exists iniciada_at timestamptz,
  add column if not exists motivo_omision text,
  -- Traslado al turno siguiente (fn_trasladar_tarea, mig 253):
  --  la original queda cancelada con trasladada_a → nueva;
  --  la nueva nace pendiente con trasladada_de → original.
  add column if not exists trasladada_de uuid references public.tareas_turno(id) on delete set null,
  add column if not exists trasladada_a  uuid references public.tareas_turno(id) on delete set null;

comment on column public.tareas_turno.hora is
  'Hora del reloj (AR) en que empieza. NULL = durante el turno. La fecha es el día en que empieza el turno.';
comment on column public.tareas_turno.trasladada_de is
  'Instancia original de la que viene (traslado al turno siguiente).';
comment on column public.tareas_turno.trasladada_a is
  'Instancia nueva a la que se trasladó; la original queda cancelada.';

create index if not exists tareas_turno_fecha_turno_hora_idx
  on public.tareas_turno (fecha, turno_id, hora);
create index if not exists tareas_turno_trasladada_de_idx
  on public.tareas_turno (trasladada_de) where trasladada_de is not null;

-- ─── 4. turnos_plantilla: el empleado (mi_panel) necesita leer los horarios
--        de turno para su propia agenda (Mis tareas / móvil). Solo SELECT. ───
drop policy if exists "turnos_plantilla_select" on public.turnos_plantilla;
create policy "turnos_plantilla_select" on public.turnos_plantilla
  for select to authenticated
  using (
    (select public.fn_tiene_permiso('rrhh'))
    or (select public.fn_tiene_permiso('tareas_gestion'))
    or (select public.fn_tiene_permiso('mi_panel'))
  );

notify pgrst, 'reload schema';

-- Verificación rápida (debe listar las columnas nuevas):
-- select column_name from information_schema.columns
--  where table_name = 'tareas_turno' and column_name in
--  ('hora','duracion_min','ventana_min','tipo_actividad','checklist',
--   'iniciada_por','iniciada_at','motivo_omision','trasladada_de','trasladada_a');
