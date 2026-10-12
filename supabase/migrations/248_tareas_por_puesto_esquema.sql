-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 248 · Tareas recurrentes por PUESTO (según cronograma)   ║
-- ║                                                                     ║
-- ║  Hasta acá los checklists diarios (mig 243) estaban atados a        ║
-- ║  personas fijas. Ahora una plantilla puede tener alcance 'puesto':  ║
-- ║  se asigna cada día a quien esté PLANIFICADO en el cronograma con   ║
-- ║  ese rol_operativo (mig 229) en el turno de la plantilla; si el     ║
-- ║  puesto no tiene a nadie ese día, la cubre alguien del turno        ║
-- ║  (resolución en fn_asignados_tareas_dia, mig 249; sincronización   ║
-- ║  en fn_materializar_tareas_turno v4, mig 250).                      ║
-- ║   · tareas_recurrentes.alcance admite 'puesto'.                     ║
-- ║   · tareas_recurrentes.roles_puesto text[]: los roles del puesto.   ║
-- ║   · tareas_turno.fijada: instancia reasignada a mano por gestión;   ║
-- ║     la sincronización no la toca.                                   ║
-- ║   · Datos: las 30 plantillas de la 243 pasan a 'puesto' con los     ║
-- ║     roles de sus asignados actuales. Los asignados fijos se         ║
-- ║     conservan como último recurso (cronograma vacío).               ║
-- ║  Idempotente. REQUIERE: migs 158, 229, 243.                         ║
-- ║  Primero PRUEBA, después PRODUCCIÓN.                                ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─── 1. Esquema ──────────────────────────────────────────────────────────
alter table public.tareas_recurrentes
  drop constraint if exists tareas_recurrentes_alcance_check;
alter table public.tareas_recurrentes
  add constraint tareas_recurrentes_alcance_check
  check (alcance in ('empleados', 'todos', 'puesto'));

alter table public.tareas_recurrentes
  add column if not exists roles_puesto text[] not null default '{}';
alter table public.tareas_recurrentes
  drop constraint if exists tareas_recurrentes_roles_puesto_check;
alter table public.tareas_recurrentes
  add constraint tareas_recurrentes_roles_puesto_check
  check (roles_puesto <@ array['direccion', 'responsable_general', 'encargado', 'pivote',
                               'compras', 'cajero', 'fiambreria', 'otro']::text[]);
comment on column public.tareas_recurrentes.roles_puesto is
  'Con alcance=puesto: roles operativos (empleados.rol_operativo) que hacen la tarea; se resuelven contra el cronograma del día.';

alter table public.tareas_turno
  add column if not exists fijada boolean not null default false;
comment on column public.tareas_turno.fijada is
  'true = gestión cambió el responsable a mano; fn_materializar_tareas_turno no la reasigna ni la borra.';

-- ─── 2. Datos: checklists de la 243 → por puesto ─────────────────────────
-- Solo las plantillas con esos títulos y turno que sigan en alcance
-- 'empleados'; roles = rol_operativo (≠ otro) de sus asignados fijos.
with checklist as (
  select t.id as turno_id, x.titulo
  from (values
    ('manana', 'Validar pase recibido del turno noche y marcar conformidad'),
    ('manana', 'Verificar orden y limpieza inicial del salón, caja, fiambrería y zonas críticas'),
    ('manana', 'Controlar insumos críticos de producción antes de producir'),
    ('manana', 'Iniciar producción a más tardar a las 07:20'),
    ('manana', 'Registrar producción realizada en el sistema (hecho / no hecho vs. plan)'),
    ('manana', 'Verificar reposición de góndolas y heladeras'),
    ('manana', 'Verificar precios visibles y correctos; corregir en el momento'),
    ('manana', 'Ejecutar el conteo cíclico del sector asignado del día'),
    ('manana', 'Controlar vencimientos del sector asignado del día'),
    ('manana', 'Procesar recepciones de mercadería y asegurar guardado / reposición'),
    ('manana', 'Mantener música / ambiente, orden y limpieza acordes'),
    ('manana', 'Registrar incidencias y pendientes del turno'),
    ('manana', 'Completar el pase de turno a la tarde'),
    ('tarde',  'Validar pase recibido del turno mañana y revisar pendientes'),
    ('tarde',  'Mantener reposición continua de góndolas y heladeras'),
    ('tarde',  'Verificar precios visibles y correctos; corregir en el momento'),
    ('tarde',  'Mantener orden y limpieza del salón y sectores operativos'),
    ('tarde',  'Controlar el sector asignado de vencimientos'),
    ('tarde',  'Revisar suficiencia de producción y elevar necesidad de refuerzo'),
    ('tarde',  'Procesar recepciones de mercadería y asegurar guardado / reposición'),
    ('tarde',  'Controlar el orden del depósito al cierre del turno'),
    ('tarde',  'Registrar incidencias y pendientes con responsable'),
    ('tarde',  'Completar el pase de turno a la noche'),
    ('noche',  'Validar pase recibido del turno tarde'),
    ('noche',  'Atender clientes y registrar todas las ventas según procedimiento de caja'),
    ('noche',  'Mantener orden y limpieza de caja, salón y sectores de uso del personal'),
    ('noche',  'Control visual del local y registro de incidencias de seguridad / operación'),
    ('noche',  'Informar faltantes críticos como incidencia (sin hacer conteos de inventario)'),
    ('noche',  'Registrar pendientes relevantes para el turno mañana'),
    ('noche',  'Completar el pase de turno a la mañana')
  ) as x(turno, titulo)
  join public.turnos_plantilla t on t.nombre = x.turno::public.nombre_turno
),
roles as (
  select r.id as plantilla_id,
         array_agg(distinct e.rol_operativo order by e.rol_operativo) as roles
  from public.tareas_recurrentes r
  join checklist c on c.titulo = r.titulo and c.turno_id = r.turno_id
  join public.tareas_recurrentes_asignados a on a.plantilla_id = r.id
  join public.empleados e on e.id = a.empleado_id and e.rol_operativo <> 'otro'
  where r.alcance = 'empleados'
  group by r.id
)
update public.tareas_recurrentes r
set alcance = 'puesto', roles_puesto = roles.roles
from roles
where roles.plantilla_id = r.id;

notify pgrst, 'reload schema';

-- Verificación (30 filas con alcance=puesto y sus roles):
--   select t.nombre as turno, r.titulo, r.modo, r.alcance, r.roles_puesto
--   from public.tareas_recurrentes r join public.turnos_plantilla t on t.id = r.turno_id
--   order by t.nombre, r.titulo;
