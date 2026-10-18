-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Script (NO migración, SOLO LECTURA) · Relevamiento para cargar la  ║
-- ║  rutina de los 3 turnos (docs/carga-rutina-3-turnos.md, Paso 1)     ║
-- ║                                                                     ║
-- ║  Correr en PRODUCCIÓN (arriba del SQL Editor: HEX-V1, main          ║
-- ║  PRODUCTION) y, si se puede, también en prueba. Después:            ║
-- ║  Export → CSV y pasar el archivo.                                   ║
-- ║                                                                     ║
-- ║  Devuelve una fila por dato: (orden, seccion, clave, valor).        ║
-- ║  Solo nombres y puestos del personal: nada de documento, sueldo ni  ║
-- ║  contacto. No crea, cambia ni borra nada.                           ║
-- ║  Última línea del archivo: "order by 1, 2, 3;"                      ║
-- ╚════════════════════════════════════════════════════════════════════╝

with hoy as (
  select (now() at time zone 'America/Argentina/La_Rioja')::date as d
),
emp as (
  select e.id, e.nombre || coalesce(' ' || e.apellido, '') as nombre, e.rol_operativo, e.activo,
         e.usuario_id is not null as tiene_usuario
  from public.empleados e
),
crono as (
  select h.fecha, h.estado::text as estado, tp.nombre::text as turno, e.nombre, e.rol_operativo
  from public.horarios_asignados h
  join emp e on e.id = h.empleado_id
  left join public.turnos_plantilla tp on tp.id = h.turno_id
  where h.fecha between (select d from hoy) - 28 and (select d from hoy) + 7
)

-- 1. Base
select 1 as orden, 'base' as seccion, 'ahora_la_rioja' as clave,
       to_jsonb(now() at time zone 'America/Argentina/La_Rioja') as valor
union all
select 1, 'base', 'hoy', jsonb_build_object('fecha', d, 'isodow', extract(isodow from d)) from hoy

-- 2. Turnos
union all
select 2, 'turnos', tp.nombre::text,
  jsonb_build_object('id', tp.id, 'inicio', tp.hora_inicio, 'fin', tp.hora_fin,
                     'cruza_medianoche', tp.cruza_medianoche, 'activo', tp.activo)
from public.turnos_plantilla tp

-- 3. Personal activo y su puesto
union all
select 3, 'personal', e.nombre,
  jsonb_build_object('id', e.id, 'rol_operativo', e.rol_operativo, 'tiene_usuario', e.tiene_usuario)
from emp e where e.activo

-- 4. Cronograma de hoy a hoy+7, por día y turno (quién trabaja y quién descansa)
union all
select 4, 'cronograma_semana',
  c.fecha::text || ' ' || to_char(c.fecha, 'Dy') || ' · ' || coalesce(c.turno, 'sin turno'),
  jsonb_agg(c.nombre || ' (' || c.rol_operativo || ') ' || c.estado order by c.rol_operativo, c.nombre)
from crono c
where c.fecha >= (select d from hoy)
group by c.fecha, c.turno

-- 5. Últimas 4 semanas: cuántos días hizo cada persona en cada turno
union all
select 5, 'cronograma_4_semanas', c.nombre || ' (' || c.rol_operativo || ')',
  jsonb_object_agg(coalesce(c.turno || ' ' || c.estado, c.estado), c.dias)
from (
  select nombre, rol_operativo, turno, estado, count(*) as dias
  from crono
  where fecha between (select d from hoy) - 28 and (select d from hoy) - 1
  group by nombre, rol_operativo, turno, estado
) c
group by c.nombre, c.rol_operativo

-- 6. Patrones del cronograma
union all
select 6, 'patrones', p.nombre,
  jsonb_build_object('tipo', p.tipo, 'turno_id', p.turno_id, 'ancla', p.fecha_ancla, 'activo', p.activo,
                     'pivote', (select e.nombre from emp e where e.id = p.pivote_empleado_id))
from public.patrones_cronograma p

-- 7. Rutina actual completa (activas e inactivas)
union all
select 7, 'rutina', coalesce(r.codigo, '(sin código)') || ' · ' || coalesce(tp.nombre::text, '-') || ' · ' || r.titulo,
  jsonb_build_object('activa', r.activa, 'alcance', r.alcance, 'roles', r.roles_puesto, 'modo', r.modo,
    'tipo', r.tipo_actividad, 'min_desde_inicio', r.minutos_desde_inicio, 'duracion', r.duracion_min,
    'dias', r.dias_semana, 'prioridad', r.prioridad, 'area', r.area, 'aviso', r.avisar_atraso_min,
    'foto', r.requiere_evidencia, 'pasos', cardinality(r.checklist), 'vigencia_desde', r.vigencia_desde,
    'cambios_desde', r.cambios_desde, 'tiene_version_anterior', r.version_anterior is not null,
    'creada', r.created_at::date)
from public.tareas_recurrentes r
left join public.turnos_plantilla tp on tp.id = r.turno_id

-- 8. ¿Se corrió el borrado de prueba? (respaldo propio dentro de la base)
union all
select 8, 'respaldo_borrado', 'existe', to_jsonb(to_regclass('respaldo_borrado_prueba.tareas_recurrentes') is not null)
union all
select 8, 'respaldo_borrado', 'rutina_respaldada · ' || x.titulo,
  jsonb_build_object('codigo', x.codigo, 'activa', x.activa)
from (select case when to_regclass('respaldo_borrado_prueba.tareas_recurrentes') is not null
                  then query_to_xml('select codigo, titulo, activa from respaldo_borrado_prueba.tareas_recurrentes',
                                    true, false, '') end as x) q
cross join lateral xmltable('/table/row' passing q.x
  columns codigo text path 'codigo', titulo text path 'titulo', activa boolean path 'activa') x

-- 9. Agenda ya generada, de ayer a hoy+7 (y cuánto tiene algo hecho o tocado a mano)
union all
select 9, 'agenda', t.fecha::text || ' ' || to_char(t.fecha, 'Dy') || ' · ' || coalesce(tp.nombre::text, '-'),
  jsonb_build_object('total', count(*), 'de_rutina', count(*) filter (where t.plantilla_id is not null),
    'tocadas', count(*) filter (where t.estado <> 'pendiente' or t.iniciada_at is not null
                                   or t.contenido_tocado_at is not null or t.asignacion_manual),
    'estados', (select jsonb_object_agg(s.estado, s.n) from (
                  select x.estado::text as estado, count(*) as n from public.tareas_turno x
                  where x.fecha = t.fecha and x.turno_id is not distinct from t.turno_id group by x.estado) s))
from public.tareas_turno t
left join public.turnos_plantilla tp on tp.id = t.turno_id
where t.fecha between (select d from hoy) - 1 and (select d from hoy) + 7
group by t.fecha, t.turno_id, tp.nombre

-- 10. Procesos programados (pg_cron)
union all
select 10, 'cron', j.jobname, jsonb_build_object('schedule', j.schedule, 'active', j.active)
from (select case when to_regclass('cron.job') is not null
                  then query_to_xml('select jobname, schedule, active from cron.job', true, false, '') end as x) q
cross join lateral xmltable('/table/row' passing q.x
  columns jobname text path 'jobname', schedule text path 'schedule', active boolean path 'active') j

-- 11. Funciones que usa la carga (tienen que estar en su última versión)
union all
select 11, 'funciones', f.n, to_jsonb(exists (
  select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace
  where s.nspname = 'public' and p.proname = f.n and p.prosrc like '%' || f.marca || '%'))
from (values ('fn_plantillas_tareas_dia', 'version_anterior'), ('fn_asignados_tareas_dia', 'cubierto'),
             ('fn_tareas_sincronizar', 'tmp_sync_p'), ('fn_rutina_resincronizar', 'fn_tareas_sincronizar'),
             ('fn_rutina_version', 'version_anterior'), ('fn_tarea_evento', ''),
             ('fn_materializar_tareas_turno', 'fn_tareas_sincronizar')) f(n, marca)

order by 1, 2, 3;
