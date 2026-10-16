-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Script (NO migración, SOLO LECTURA) · Relevamiento Tareas v2       ║
-- ║                                                                     ║
-- ║  Correr en las DOS bases (prueba y producción) antes de escribir    ║
-- ║  las migraciones 259 en adelante. Arriba del SQL Editor tiene que   ║
-- ║  decir el proyecto correcto. Después: Export → CSV y pasar el       ║
-- ║  archivo (trae emails de usuarios: no se commitea).                 ║
-- ║                                                                     ║
-- ║  Devuelve una fila por dato: (orden, seccion, clave, valor).        ║
-- ║  No lee documento, CUIL, sueldo, teléfono ni dirección de legajos.  ║
-- ║  No crea, cambia ni borra nada. Se puede correr las veces que sea.  ║
-- ║  Última línea del archivo: "order by 1, 2, 3;"                      ║
-- ╚════════════════════════════════════════════════════════════════════╝

with hoy as (
  select (now() at time zone 'America/Argentina/La_Rioja')::date as d
),
tablas as (
  select unnest(array[
    'roles', 'usuarios', 'empleados', 'tareas_turno', 'tareas_turno_participantes',
    'tareas_recurrentes', 'tareas_recurrentes_asignados', 'turnos_plantilla',
    'horarios_asignados', 'auditoria', 'cuenta_corriente_empleado'
  ]) as t
),
funciones as (
  select p.oid, p.proname, p.prosrc, p.prosecdef
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'fn_tiene_permiso', 'fn_mi_rol', 'handle_new_user', 'fn_mi_empleado_id',
      'fn_usuario_efectivo', 'fn_auditar', 'fn_sueldo', 'fn_set_sueldo',
      'fn_materializar_tareas_turno', 'fn_plantillas_tareas_dia', 'fn_asignados_tareas_dia',
      'fn_marcar_tareas_vencidas', 'fn_tarea_puede_operar', 'fn_completar_tarea',
      'fn_rechazar_tarea', 'fn_iniciar_tarea', 'fn_omitir_tarea', 'fn_reabrir_tarea',
      'fn_trasladar_tarea', 'fn_cumplimiento_tareas', 'fn_calcular_evaluacion',
      'fn_guardar_evaluacion', 'fn_dashboard_rrhh', 'fn_mis_tareas_participadas',
      'fn_registrar_incidencia', 'fn_cerrar_dia_asistencia'
    )
)

-- 1. Base
select 1 as orden, 'base' as seccion, 'version' as clave, to_jsonb(version()) as valor
union all
select 1, 'base', 'ahora_la_rioja', to_jsonb(now() at time zone 'America/Argentina/La_Rioja')

-- 2. Roles y sus permisos
union all
select 2, 'roles', r.codigo,
  jsonb_build_object('nombre', r.nombre, 'es_sistema', r.es_sistema, 'permisos', to_jsonb(r.permisos))
from public.roles r

-- 3. Usuarios por rol (y si el código existe en roles)
union all
select 3, 'usuarios_por_rol',
  coalesce(u.rol::text, '(sin rol)') || case when u.activo then '' else ' · inactivo' end,
  jsonb_build_object('cantidad', count(*),
    'rol_existe', exists (select 1 from public.roles r where r.codigo = u.rol::text))
from public.usuarios u
group by u.rol, u.activo

-- 4. Usuarios: rol, activo, legajo vinculado, último ingreso y última actividad.
--    last_sign_in_at no cambia al renovar el token: una pestaña del POS abierta
--    hace meses sigue entrando. La actividad sale de auth.sessions (solo
--    fechas; to_jsonb para no depender de columnas que cambian entre versiones).
union all
select 4, 'usuarios', u.email,
  jsonb_build_object('nombre', u.nombre, 'rol', u.rol::text, 'activo', u.activo,
    'legajos', (select jsonb_agg(e.id) from public.empleados e where e.usuario_id = u.id),
    'ultimo_ingreso', au.last_sign_in_at, 'alta', au.created_at,
    'ultima_actividad', (
      select max(greatest(s.created_at, s.updated_at,
                          ((to_jsonb(s) ->> 'refreshed_at')::timestamp at time zone 'UTC')))
      from auth.sessions s where s.user_id = u.id),
    'sesiones_abiertas', (
      select count(*) from auth.sessions s
      where s.user_id = u.id
        and ((to_jsonb(s) ->> 'not_after') is null
             or (to_jsonb(s) ->> 'not_after')::timestamptz > now())))
from public.usuarios u
left join auth.users au on au.id = u.id

-- 5. Cuentas de Auth sin fila en usuarios (altas ajenas)
union all
select 5, 'auth_sin_usuario', coalesce(au.email, au.id::text),
  jsonb_build_object('alta', au.created_at, 'ultimo_ingreso', au.last_sign_in_at)
from auth.users au
where not exists (select 1 from public.usuarios u where u.id = au.id)

-- 6. Legajos activos: puesto, jefe y cuenta de login
union all
select 6, 'empleados', e.id::text,
  jsonb_build_object('nombre', e.nombre, 'apellido', e.apellido, 'legajo', e.legajo,
    'rol_operativo', e.rol_operativo, 'reporta_a', e.reporta_a,
    'usuario', u.email, 'rol_login', u.rol::text, 'login_activo', u.activo)
from public.empleados e
left join public.usuarios u on u.id = e.usuario_id
where e.activo

-- 7. Una cuenta vinculada a más de un legajo (bloquea el índice único de la 260)
union all
select 7, 'vinculo_duplicado', e.usuario_id::text, jsonb_agg(e.id order by e.id)
from public.empleados e
where e.usuario_id is not null
group by e.usuario_id
having count(*) > 1

-- 8. Políticas RLS vigentes
union all
select 8, 'policies', p.schemaname || '.' || p.tablename || ' · ' || p.policyname,
  jsonb_build_object('cmd', p.cmd, 'roles', p.roles, 'using', p.qual, 'check', p.with_check)
from pg_policies p
where (p.schemaname = 'public' and p.tablename in (select t from tablas))
   or (p.schemaname = 'storage' and coalesce(p.qual, '') || coalesce(p.with_check, '') like '%tareas-evidencia%')

-- 9. RLS activo por tabla
union all
select 9, 'rls_activo', c.relname,
  jsonb_build_object('rls', c.relrowsecurity, 'forzado', c.relforcerowsecurity)
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in (select t from tablas)

-- 10. Privilegios directos sobre las tablas (por rol de Postgres)
union all
select 10, 'privilegios_tablas', x.t || ' · ' || x.r,
  jsonb_build_object(
    'select', has_table_privilege(x.r, 'public.' || x.t, 'SELECT'),
    'insert', has_table_privilege(x.r, 'public.' || x.t, 'INSERT'),
    'update', has_table_privilege(x.r, 'public.' || x.t, 'UPDATE'),
    'delete', has_table_privilege(x.r, 'public.' || x.t, 'DELETE'),
    'truncate', has_table_privilege(x.r, 'public.' || x.t, 'TRUNCATE'))
from (select t, r from tablas cross join unnest(array['anon', 'authenticated']) r) x
where to_regclass('public.' || x.t) is not null

-- 11. Funciones que se van a reemitir: quién las puede ejecutar y huella del cuerpo
union all
select 11, 'funciones', f.oid::regprocedure::text,
  jsonb_build_object(
    'definer', f.prosecdef,
    'anon', has_function_privilege('anon', f.oid, 'EXECUTE'),
    'authenticated', has_function_privilege('authenticated', f.oid, 'EXECUTE'),
    'md5', md5(f.prosrc), 'largo', length(f.prosrc))
from funciones f

-- 12. Triggers en auth.users y en las tablas del módulo
union all
select 12, 'triggers', n.nspname || '.' || c.relname || ' · ' || tg.tgname,
  jsonb_build_object('funcion', tg.tgfoid::regproc::text, 'estado', tg.tgenabled)
from pg_trigger tg
join pg_class c on c.oid = tg.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where not tg.tgisinternal
  and ((n.nspname = 'auth' and c.relname = 'users')
    or (n.nspname = 'public' and c.relname in (select t from tablas)))

-- 13. Enums del módulo (y si ya existe alguno de los nuevos)
union all
select 13, 'enums', ty.typname, jsonb_agg(e.enumlabel order by e.enumsortorder)
from pg_type ty
join pg_enum e on e.enumtypid = ty.oid
join pg_namespace n on n.oid = ty.typnamespace
where n.nspname = 'public'
  and ty.typname in ('estado_tarea_turno', 'prioridad_tarea', 'modo_tarea', 'tipo_actividad_tarea',
    'tipo_recurrencia_tarea', 'nombre_turno', 'estado_horario', 'tarea_area', 'tarea_origen',
    'tarea_motivo_no_se_pudo', 'tarea_evento_tipo', 'tarea_pedido_estado')
group by ty.typname

-- 14. Extensiones (¿hay pg_cron / pg_net?) y tablas en Realtime
union all
select 14, 'extensiones', x.extname, to_jsonb(x.extversion)
from pg_extension x
union all
select 14, 'realtime', pt.schemaname || '.' || pt.tablename, to_jsonb(pt.pubname)
from pg_publication_tables pt
where pt.pubname = 'supabase_realtime'

-- 15. Bucket de fotos de evidencia
union all
select 15, 'storage', b.id,
  jsonb_build_object('publico', b.public, 'limite', b.file_size_limit, 'tipos', b.allowed_mime_types)
from storage.buckets b
where b.id = 'tareas-evidencia'

-- 16. Horarios de turno
union all
select 16, 'turnos', tp.nombre::text,
  jsonb_build_object('id', tp.id, 'inicio', tp.hora_inicio, 'fin', tp.hora_fin,
    'cruza_medianoche', tp.cruza_medianoche, 'activo', tp.activo, 'tolerancia_min', tp.tolerancia_min)
from public.turnos_plantilla tp

-- 17. Cronograma cargado de ayer a hoy+8, por día y turno
union all
select 17, 'cronograma', x.fecha::text || ' · ' || x.turno, jsonb_object_agg(x.estado, x.n)
from (
  select h.fecha, coalesce(tp.nombre::text, '(sin turno)') as turno, h.estado::text as estado, count(*) as n
  from public.horarios_asignados h
  left join public.turnos_plantilla tp on tp.id = h.turno_id
  where h.fecha between (select d from hoy) - 1 and (select d from hoy) + 8
  group by 1, 2, 3
) x
group by x.fecha, x.turno

-- 18. Rutina viva (plantillas) con turno y asignados fijos
union all
select 18, 'rutina', coalesce(tp.nombre::text, '(sin turno)') || ' · ' || r.titulo,
  (to_jsonb(r) - 'empleado_id') || jsonb_build_object(
    'asignados_fijos', (select jsonb_agg(e.nombre || coalesce(' ' || e.apellido, '') order by e.nombre)
                          from public.tareas_recurrentes_asignados a
                          join public.empleados e on e.id = a.empleado_id
                         where a.plantilla_id = r.id))
from public.tareas_recurrentes r
left join public.turnos_plantilla tp on tp.id = r.turno_id

-- 19. Agenda de los últimos 60 días por estado
union all
select 19, 'agenda_estados_60d', t.estado::text,
  jsonb_build_object('total', count(*),
    'continua_o_bloque', count(*) filter (where t.tipo_actividad::text <> 'puntual'),
    'sin_plantilla', count(*) filter (where t.plantilla_id is null),
    'fijadas', count(*) filter (where t.fijada),
    'con_motivo_omision', count(*) filter (where t.motivo_omision is not null),
    'trasladadas', count(*) filter (where t.trasladada_a is not null))
from public.tareas_turno t
where t.fecha >= (select d from hoy) - 60
group by t.estado

-- 20. Agenda ya generada desde ayer
union all
select 20, 'agenda_generada', t.fecha::text,
  jsonb_build_object('total', count(*),
    'de_rutina', count(*) filter (where t.plantilla_id is not null),
    'abiertas', count(*) filter (where t.estado::text in ('pendiente', 'en_curso')))
from public.tareas_turno t
where t.fecha >= (select d from hoy) - 1
group by t.fecha

order by 1, 2, 3;
