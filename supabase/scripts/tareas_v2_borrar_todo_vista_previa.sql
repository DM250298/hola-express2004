-- Vista previa del borrado de prueba (tareas, asistencia, incidencias y sanciones).
-- SOLO LECTURA: cuenta lo que borraría tareas_v2_borrar_todo.sql. No cambia nada.
-- Correr antes del borrado, en la misma base, para ver qué se va.

select 'Tareas · agenda (tareas_turno)' as que, count(*) as filas from public.tareas_turno
union all select 'Tareas · participantes de grupales', count(*) from public.tareas_turno_participantes
union all select 'Tareas · rutina (tareas_recurrentes)', count(*) from public.tareas_recurrentes
union all select 'Tareas · asignados fijos de la rutina', count(*) from public.tareas_recurrentes_asignados
union all select 'Tareas · registro de cambios', count(*) from public.tareas_eventos
union all select 'Tareas · pedidos de quitar', count(*) from public.tareas_pedidos
union all select 'Tareas · avisos de atraso', count(*) from public.tareas_avisos
union all select 'Tareas · avisos mandados al celular', count(*) from public.tareas_avisos_push
union all select 'Tareas · resúmenes semanales', count(*) from public.tareas_resumenes
union all select 'Tareas · cola de notificaciones', count(*) from public.notificaciones_push
union all select 'Incidencias', count(*) from public.incidencias
union all select 'Sanciones', count(*) from public.sanciones
union all select 'Sanciones ↔ incidencias', count(*) from public.sancion_incidencias
union all select 'Asistencia · días calculados', count(*) from public.asistencia_diaria
union all select 'Asistencia · fichadas', count(*) from public.fichajes
union all select 'Asistencia · importaciones del reloj', count(*) from public.importaciones_fichajes;
