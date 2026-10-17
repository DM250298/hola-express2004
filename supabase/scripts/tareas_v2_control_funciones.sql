  -- Control de Tareas v2 (migs 259–298): qué falta en esta base.
  -- Solo lectura. Correr en cada base; cada fila que devuelve es un problema
  -- y dice qué migración volver a correr. Sin filas = todo en su lugar.
  with esperadas(mig, fn) as (values
    (260,'fn_seguridad_puede_otorgar'),(260,'fn_sesion_es_sistema'),(260,'fn_tiene_permiso'),(260,'fn_trg_roles_guarda'),
    (260,'fn_trg_usuarios_guarda'),(261,'fn_seguridad_evento'),(261,'fn_trg_empleados_vinculo'),(261,'fn_trg_registro_inmutable'),
    (261,'fn_trg_roles_registro'),(261,'fn_trg_usuarios_registro'),(264,'fn_trg_tareas_pedidos_guarda'),(266,'fn_tarea_evento'),
    (266,'fn_tarea_fin_turno'),(266,'fn_tarea_inicio_turno'),(266,'fn_tarea_rango'),(266,'fn_tareas_actor'),(266,'fn_tareas_hoy'),
    (267,'fn_trg_tareas_sin_asignados_en_privada'),(267,'fn_trg_tareas_turno_antes'),(268,'fn_trg_turnos_plantilla_tareas'),
    (269,'fn_a_quien_le_toca'),(269,'fn_asignados_tareas_dia'),(269,'fn_personas_turno'),(269,'fn_plantillas_tareas_dia'),
    (270,'fn_tarea_evento_sistema'),(270,'fn_tareas_sync_cubre'),(270,'fn_tareas_sync_preparar'),(270,'fn_tareas_sync_reasignar'),
    (271,'fn_tareas_sincronizar'),(272,'fn_marcar_tareas_vencidas'),(272,'fn_materializar_tareas_turno'),(273,'fn_completar_tarea'),
    (273,'fn_tarea_puede_gestionar'),(273,'fn_tarea_puede_operar'),(274,'fn_iniciar_tarea'),(274,'fn_omitir_tarea'),
    (274,'fn_reabrir_tarea'),(274,'fn_rechazar_tarea'),(274,'fn_tarea_no_se_pudo'),(275,'fn_tarea_cancelar'),
    (275,'fn_trasladar_tarea'),(276,'fn_tarea_crear_puntual'),(276,'fn_tarea_editar'),(276,'fn_tarea_validar_horario'),
    (277,'fn_agenda_mover'),(277,'fn_tarea_checklist_paso'),(277,'fn_tarea_corregir_hora'),(277,'fn_tarea_nota'),
    (278,'fn_mi_turno'),(278,'fn_notas_proximo_turno'),(278,'fn_rutina_historial'),(278,'fn_tarea_historial'),
    (279,'fn_rutina_guardar'),(279,'fn_rutina_resincronizar'),(279,'fn_rutina_version'),(280,'fn_agenda_actualizar_hoy'),
    (280,'fn_pedido_resolver'),(280,'fn_rutina_pedir_quitar'),(280,'fn_rutina_quitar'),(280,'fn_rutina_reactivar'),
    (280,'fn_rutina_set_activa'),(282,'fn_rutina_privadas_ids'),(282,'fn_tareas_privadas_ids'),(283,'fn_cumplimiento_tareas'),
    (284,'fn_calcular_evaluacion'),(293,'fn_trg_tareas_avisos_guarda'),(294,'fn_tareas_avisar_atrasos'),
    (294,'fn_tareas_aviso_para'),(294,'fn_tareas_usuarios_con'),(295,'fn_tareas_resumen_semana'),
    (296,'fn_tareas_guardar_resumen'),(298,'fn_tareas_push_pendiente')
  ),
  faltan as (
    select e.mig, 'falta la función ' || e.fn as problema
    from esperadas e
    where not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                       where n.nspname = 'public' and p.proname = e.fn)
  ),
  versiones as (
    -- Funciones que existían antes: tienen que estar en la versión nueva.
    select v.mig, 'versión vieja de ' || v.fn as problema
    from (values
      (269, 'fn_plantillas_tareas_dia', 'version_anterior'),
      (269, 'fn_asignados_tareas_dia', 'cubierto'),
      (272, 'fn_materializar_tareas_turno', 'fn_tareas_sincronizar'),
      (272, 'fn_marcar_tareas_vencidas', 'fn_tarea_fin_turno'),
      (274, 'fn_iniciar_tarea', 'fn_tarea_evento'),
      (275, 'fn_trasladar_tarea', 'fn_tarea_evento'),
      (283, 'fn_cumplimiento_tareas', 'no_se_pudo'),
      (284, 'fn_calcular_evaluacion', 'no_se_pudo'),
      (288, 'fn_omitir_tarea', 'no_se_pudo')
    ) v(mig, fn, marca)
    where exists (select 1 from pg_proc p where p.proname = v.fn)
      and not exists (select 1 from pg_proc p where p.proname = v.fn and p.prosrc like '%' || v.marca || '%')
  ),
  permisos as (
    select x.mig, x.problema from (values
      (269, 'la app puede leer toda la rutina (fn_plantillas_tareas_dia)',
            has_function_privilege('authenticated', 'public.fn_plantillas_tareas_dia(date)', 'EXECUTE')),
      (269, 'la app puede leer quién trabaja cada día (fn_asignados_tareas_dia)',
            has_function_privilege('authenticated', 'public.fn_asignados_tareas_dia(date)', 'EXECUTE')),
      (272, 'anon puede armar la agenda (fn_materializar_tareas_turno)',
            has_function_privilege('anon', 'public.fn_materializar_tareas_turno(date)', 'EXECUTE')),
      (288, 'la app todavía escribe directo en tareas_turno',
            has_table_privilege('authenticated', 'public.tareas_turno', 'UPDATE')),
      (293, 'la app puede escribir o borrar avisos (tareas_avisos)',
            exists (select 1 from pg_class c where c.oid = to_regclass('public.tareas_avisos')
                     and (has_table_privilege('authenticated', c.oid, 'DELETE')
                          or has_table_privilege('authenticated', c.oid, 'UPDATE')))),
      (294, 'la app puede correr el control de atrasos',
            exists (select 1 from pg_proc p where p.proname = 'fn_tareas_avisar_atrasos'
                     and has_function_privilege('authenticated', p.oid, 'EXECUTE')))
    ) x(mig, problema, mal)
    where x.mal
  ),
  objetos as (
    select 271, 'falta el índice único por empleado_rutina_id'
    where to_regclass('public.tareas_turno_plantilla_fecha_rutina_uq') is null
    union all
    select 287, 'faltan tareas del Anexo A (tienen que ser 44)'
    where (select count(*) from public.tareas_recurrentes where codigo is not null) <> 44
    union all
    select 288, 'falta el evento registro_completo'
    where not exists (select 1 from public.tareas_eventos where tipo = 'registro_completo')
    union all
    select 289, 'tareas_turno no está en Realtime'
    where not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'tareas_turno')
    union all
    select 293, 'tareas_avisos no está en Realtime'
    where not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'tareas_avisos')
    union all
    select 296, 'falta activar pg_cron (Database → Extensions)'
    where not exists (select 1 from pg_extension where extname = 'pg_cron')
    union all
    select 297, 'falta la columna push_subscriptions.temas'
    where not exists (select 1 from information_schema.columns where table_schema = 'public'
                        and table_name = 'push_subscriptions' and column_name = 'temas')
    union all
    select 298, 'falta activar pg_net (Database → Extensions)'
    where not exists (select 1 from pg_extension where extname = 'pg_net')
  )
  select mig, problema from faltan
  union all select mig, problema from versiones
  union all select mig, problema from permisos
  union all select * from objetos
  order by 1, 2;
