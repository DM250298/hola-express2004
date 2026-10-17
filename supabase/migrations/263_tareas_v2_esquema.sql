-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  263 · Tareas v2: tipos y columnas nuevas de rutina y agenda        ║
-- ║  (Etapa 1 · bloque B)                                                ║
-- ║                                                                     ║
-- ║  Solo AGREGA (tipos, columnas con default, backfills). No cambia    ║
-- ║  ninguna función ni policy: la app de hoy sigue igual.              ║
-- ║   · Rutina (tareas_recurrentes): área, privada, aviso de atraso,    ║
-- ║     "aplica desde" + versión anterior, código, quién/cuándo editó.  ║
-- ║   · Agenda (tareas_turno): origen, área, privada, horario absoluto  ║
-- ║     (lo completa un trigger en la 266), todo el turno, motivo de    ║
-- ║     "no se pudo", nota para el próximo turno, estado del checklist, ║
-- ║     marcas de editada / asignada a mano, puesto de las puntuales,   ║
-- ║     quién inició/completó por usuario y horas originales.           ║
-- ║                                                                     ║
-- ║  Requiere la 262 (corrida en otro pegado). Se puede correr de nuevo.║
-- ║  Última línea del archivo: "notify pgrst, 'reload schema';"          ║
-- ╚════════════════════════════════════════════════════════════════════╝

set local lock_timeout = '5s';

do $$
begin
  if not exists (select 1 from pg_enum where enumtypid = 'public.estado_tarea_turno'::regtype
                  and enumlabel = 'no_se_pudo') then
    raise exception '263: falta correr la 262 (en su propio pegado).';
  end if;
end $$;

-- ─── 1. Tipos nuevos ────────────────────────────────────────────────────
do $$ begin
  create type public.tarea_area as enum
    ('atencion_caja', 'produccion_fiambreria', 'reposicion_limpieza', 'control_seguridad');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.tarea_origen as enum ('rutina', 'puntual');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.tarea_motivo_no_se_pudo as enum
    ('falto_insumo', 'no_alcanzo_tiempo', 'se_rompio', 'otro');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.tarea_pedido_estado as enum ('pendiente', 'aprobado', 'rechazado');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.tarea_evento_tipo as enum (
    'creada', 'editada', 'iniciada', 'completada', 'no_se_pudo', 'reabierta',
    'hora_corregida', 'cancelada', 'pedido_quitar', 'pedido_aprobado', 'pedido_rechazado',
    'aviso_atraso', 'trasladada', 'rechazada', 'quitada', 'reactivada', 'agenda_actualizada',
    'turno_editado', 'reasignada', 'nota_editada', 'checklist_paso', 'pedido_deshecho',
    'registro_completo');
exception when duplicate_object then null; end $$;

-- ─── 2. Rutina ──────────────────────────────────────────────────────────
alter table public.tareas_recurrentes
  add column if not exists area              public.tarea_area,
  add column if not exists privada           boolean not null default false,
  add column if not exists avisar_atraso_min integer,
  add column if not exists cambios_desde     date,
  add column if not exists version_anterior  jsonb,
  add column if not exists codigo            text,
  add column if not exists updated_at        timestamptz not null default now(),
  add column if not exists updated_by        uuid references public.usuarios(id) on delete set null;

do $$ begin
  alter table public.tareas_recurrentes
    add constraint tareas_rec_avisar_atraso_chk check (avisar_atraso_min between 1 and 480);
exception when duplicate_object then null; end $$;

create unique index if not exists tareas_rec_codigo_uq
  on public.tareas_recurrentes (codigo) where codigo is not null;

-- La rutina guarda el inicio en minutos desde el inicio del turno (spec §2):
-- las que tienen hora de reloj pasan a minutos (+1440 si la noche cruzó).
update public.tareas_recurrentes r
   set minutos_desde_inicio = (
         (extract(epoch from (r.hora - tp.hora_inicio))::integer / 60 + 1440) % 1440),
       hora = null
  from public.turnos_plantilla tp
 where tp.id = r.turno_id and r.hora is not null;

-- ─── 3. Agenda ──────────────────────────────────────────────────────────
alter table public.tareas_turno
  add column if not exists origen                  public.tarea_origen,
  add column if not exists area                    public.tarea_area,
  add column if not exists privada                 boolean not null default false,
  add column if not exists minutos_desde_inicio    integer,
  add column if not exists inicio_at               timestamptz,
  add column if not exists fin_at                  timestamptz,
  add column if not exists limite_at               timestamptz,
  add column if not exists todo_el_turno           boolean not null default false,
  add column if not exists motivo_no_se_pudo       public.tarea_motivo_no_se_pudo,
  add column if not exists detalle_motivo          text,
  add column if not exists nota_proximo_turno      text,
  add column if not exists avisar_atraso_min       integer,
  add column if not exists aviso_atraso_enviado_at timestamptz,
  add column if not exists checklist_estado        jsonb not null default '[]'::jsonb,
  add column if not exists contenido_tocado_at     timestamptz,
  add column if not exists asignacion_manual       boolean not null default false,
  add column if not exists empleado_rutina_id      integer references public.empleados(id) on delete set null,
  add column if not exists roles_puesto            text[],
  add column if not exists iniciada_por_usuario    uuid references public.usuarios(id) on delete set null,
  add column if not exists completada_por_usuario  uuid references public.usuarios(id) on delete set null,
  add column if not exists iniciada_at_original    timestamptz,
  add column if not exists completada_at_original  timestamptz;

do $$ begin
  alter table public.tareas_turno
    add constraint tareas_turno_motivo_chk
    check ((estado::text = 'no_se_pudo') = (motivo_no_se_pudo is not null));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.tareas_turno
    add constraint tareas_turno_avisar_atraso_chk check (avisar_atraso_min between 1 and 480);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.tareas_turno
    add constraint tareas_turno_roles_puesto_chk check (roles_puesto is null or roles_puesto <@ array[
      'direccion', 'responsable_general', 'encargado', 'pivote', 'compras', 'cajero',
      'fiambreria', 'otro']::text[]);
exception when duplicate_object then null; end $$;

-- ─── 4. Backfills de la agenda ──────────────────────────────────────────
-- Origen: rutina si viene de una plantilla; las trasladadas heredan el de
-- la tarea original (siguiendo la cadena de traslados).
with recursive cadena as (
  select t.id, t.id as raiz, t.trasladada_de, t.plantilla_id
    from public.tareas_turno t
  union all
  select c.id, p.id, p.trasladada_de, p.plantilla_id
    from cadena c join public.tareas_turno p on p.id = c.trasladada_de
),
raices as (
  select distinct on (id) id, plantilla_id
    from cadena where trasladada_de is null
   order by id
)
update public.tareas_turno t
   set origen = case when r.plantilla_id is not null then 'rutina' else 'puntual' end::public.tarea_origen
  from raices r
 where r.id = t.id and t.origen is null;

update public.tareas_turno
   set empleado_rutina_id = empleado_id
 where plantilla_id is not null and empleado_id is not null and empleado_rutina_id is null;

update public.tareas_turno set asignacion_manual = true where fijada and not asignacion_manual;

update public.tareas_turno set todo_el_turno = true where hora is null and not todo_el_turno;

-- Minutos desde el inicio del turno (sirve para seguir al turno si cambia su horario).
update public.tareas_turno t
   set minutos_desde_inicio = (extract(epoch from (t.hora - tp.hora_inicio))::integer / 60 + 1440) % 1440
  from public.turnos_plantilla tp
 where tp.id = t.turno_id and t.hora is not null and t.minutos_desde_inicio is null;

-- Área y privada desde la plantilla (las actuales no tienen área: quedan "Sin área").
update public.tareas_turno t
   set area = r.area, privada = r.privada, avisar_atraso_min = r.avisar_atraso_min
  from public.tareas_recurrentes r
 where r.id = t.plantilla_id
   and (t.area, t.privada, t.avisar_atraso_min) is distinct from (r.area, r.privada, r.avisar_atraso_min);

create index if not exists tareas_turno_limite_idx
  on public.tareas_turno (limite_at) where estado in ('pendiente', 'en_curso');

-- ─── 5. Verificación ────────────────────────────────────────────────────
do $$
declare v_faltan text;
begin
  select string_agg(c, ', ') into v_faltan
  from unnest(array['origen', 'area', 'privada', 'inicio_at', 'fin_at', 'limite_at',
    'todo_el_turno', 'motivo_no_se_pudo', 'nota_proximo_turno', 'checklist_estado',
    'contenido_tocado_at', 'asignacion_manual', 'empleado_rutina_id', 'roles_puesto',
    'completada_por_usuario']) c
  where not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'tareas_turno' and column_name = c);
  if v_faltan is not null then
    raise exception '263: faltan columnas en tareas_turno: %', v_faltan;
  end if;
  if (select count(*) from information_schema.columns where table_schema = 'public'
       and table_name = 'tareas_recurrentes'
       and column_name in ('area', 'privada', 'avisar_atraso_min', 'cambios_desde',
                           'version_anterior', 'codigo', 'updated_at', 'updated_by')) <> 8 then
    raise exception '263: faltan columnas en tareas_recurrentes.';
  end if;
  if exists (select 1 from public.tareas_turno where origen is null) then
    raise exception '263: quedaron tareas sin origen.';
  end if;
  if exists (select 1 from public.tareas_recurrentes where hora is not null and turno_id is not null) then
    raise exception '263: quedaron plantillas con hora de reloj.';
  end if;
end $$;

notify pgrst, 'reload schema';
