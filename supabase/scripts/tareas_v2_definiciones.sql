-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Script (NO migración, SOLO LECTURA) · Definiciones a respaldar     ║
-- ║                                                                     ║
-- ║  Correr en las DOS bases antes de la 259 y guardar el resultado     ║
-- ║  con Export → CSV. Es la copia exacta de cada función y política    ║
-- ║  que reemplaza la Etapa 1 de Tareas v2: de acá salen los scripts    ║
-- ║  de vuelta atrás (nunca re-correr enteras la 158, 252 o 253).       ║
-- ║  No crea, cambia ni borra nada.                                     ║
-- ║  Última línea del archivo: "order by 1, 2;"                         ║
-- ╚════════════════════════════════════════════════════════════════════╝

select 'funcion' as tipo,
       p.oid::regprocedure::text as nombre,
       pg_get_functiondef(p.oid) as definicion
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prokind = 'f'
  and p.proname in (
    'fn_tiene_permiso', 'fn_mi_rol', 'handle_new_user', 'fn_mi_empleado_id',
    'fn_sueldo', 'fn_set_sueldo',
    'fn_materializar_tareas_turno', 'fn_plantillas_tareas_dia', 'fn_asignados_tareas_dia',
    'fn_marcar_tareas_vencidas', 'fn_tarea_puede_operar', 'fn_completar_tarea',
    'fn_rechazar_tarea', 'fn_iniciar_tarea', 'fn_omitir_tarea', 'fn_reabrir_tarea',
    'fn_trasladar_tarea', 'fn_cumplimiento_tareas', 'fn_calcular_evaluacion',
    'fn_dashboard_rrhh', 'fn_mis_tareas_participadas'
  )

union all

select 'policy',
       pl.schemaname || '.' || pl.tablename || ' · ' || pl.policyname,
       format('create policy %I on %I.%I as %s for %s to %s%s%s;',
              pl.policyname, pl.schemaname, pl.tablename, pl.permissive, pl.cmd,
              array_to_string(pl.roles, ', '),
              case when pl.qual is not null then ' using (' || pl.qual || ')' else '' end,
              case when pl.with_check is not null then ' with check (' || pl.with_check || ')' else '' end)
from pg_policies pl
where (pl.schemaname = 'public'
       and pl.tablename in ('roles', 'usuarios', 'empleados', 'tareas_turno',
         'tareas_turno_participantes', 'tareas_recurrentes', 'tareas_recurrentes_asignados',
         'turnos_plantilla'))
   or (pl.schemaname = 'storage'
       and coalesce(pl.qual, '') || coalesce(pl.with_check, '') like '%tareas-evidencia%')

order by 1, 2;
