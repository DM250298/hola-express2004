-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 252 · fn_materializar_tareas_turno v5 (horario)          ║
-- ║                                                                     ║
-- ║  Base: v4 (mig 250) íntegro. Cambios:                               ║
-- ║   · Las instancias nuevas copian hora, duración, ventana, tipo de   ║
-- ║     actividad y checklist de la plantilla. Si la plantilla usa      ║
-- ║     minutos_desde_inicio, la hora se resuelve contra hora_inicio    ║
-- ║     del turno (turnos_plantilla), así cambiar el horario del turno  ║
-- ║     mueve las tareas en la próxima sincronización.                  ║
-- ║   · Paso 2b: editar la rutina afecta a las instancias PENDIENTES    ║
-- ║     vírgenes (sin iniciar, sin evidencia, sin rechazos, no fijadas) ║
-- ║     con fecha ≥ vigencia_desde: se les actualizan título, descr.,   ║
-- ║     prioridad, evidencia, hora, duración, ventana, tipo y checklist.║
-- ║     Lo iniciado, completado, cancelado o fijado no se toca.         ║
-- ║  Misma firma → create or replace, sin sobrecargas.                  ║
-- ║  REQUIERE: migs 249, 250, 251. Primero PRUEBA, después PRODUCCIÓN.  ║
-- ╚════════════════════════════════════════════════════════════════════╝

create or replace function public.fn_materializar_tareas_turno(p_fecha date)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_n integer := 0;
  v_m integer;
  v_hoy date := (timezone('America/Argentina/Buenos_Aires', now()))::date;
begin
  if auth.uid() is not null
     and not (public.fn_tiene_permiso('tareas_gestion')
              or public.fn_tiene_permiso('rrhh')
              or public.fn_tiene_permiso('mi_panel')) then
    raise exception 'Sin permiso.';
  end if;
  if p_fecha < v_hoy - 1 or p_fecha > v_hoy + 7 then
    raise exception 'Fecha fuera de rango.';
  end if;

  -- Plantillas que caen hoy, con la hora ya resuelta contra el turno.
  create temp table if not exists tmp_plantillas_hoy
    (like public.tareas_recurrentes, hora_resuelta time) on commit drop;
  truncate tmp_plantillas_hoy;
  insert into tmp_plantillas_hoy
  select p.*,
         coalesce(
           p.hora,
           case when p.minutos_desde_inicio is not null and tp.hora_inicio is not null
                then (tp.hora_inicio + make_interval(mins => p.minutos_desde_inicio))::time
           end
         ) as hora_resuelta
  from public.fn_plantillas_tareas_dia(p_fecha) p
  left join public.turnos_plantilla tp on tp.id = p.turno_id;

  create temp table if not exists tmp_objetivo (
    plantilla_id uuid, empleado_id integer, notas text, modo public.modo_tarea,
    primary key (plantilla_id, empleado_id)
  ) on commit drop;
  truncate tmp_objetivo;
  insert into tmp_objetivo (plantilla_id, empleado_id, notas, modo)
  select o.plantilla_id, o.empleado_id, o.notas, p.modo
  from public.fn_asignados_tareas_dia(p_fecha) o
  join tmp_plantillas_hoy p on p.id = o.plantilla_id;

  -- 1. Individuales que ya no corresponden (pendientes vírgenes, no fijadas).
  delete from public.tareas_turno t
  where t.fecha = p_fecha
    and t.plantilla_id is not null and t.empleado_id is not null
    and t.modo = 'individual' and t.estado = 'pendiente'
    and t.rechazos_count = 0 and t.evidencia_url is null and not t.fijada
    and t.iniciada_at is null
    and exists (select 1 from tmp_plantillas_hoy p where p.id = t.plantilla_id and p.modo = 'individual')
    and not exists (select 1 from tmp_objetivo o
                    where o.plantilla_id = t.plantilla_id and o.empleado_id = t.empleado_id);
  get diagnostics v_m = row_count;
  v_n := v_n + v_m;

  -- 2. Nota de cobertura de las que siguen (no cuenta como cambio).
  update public.tareas_turno t
  set notas = o.notas
  from tmp_objetivo o
  where t.fecha = p_fecha and t.plantilla_id = o.plantilla_id and t.empleado_id = o.empleado_id
    and t.estado in ('pendiente', 'en_curso') and not t.fijada
    and t.notas is distinct from o.notas;

  -- 2b. La rutina editada alcanza a las pendientes vírgenes desde su vigencia
  --     (no cuenta como cambio; lo iniciado/completado/fijado no se toca).
  update public.tareas_turno t
  set titulo = p.titulo,
      descripcion = p.descripcion,
      prioridad = p.prioridad,
      requiere_evidencia = p.requiere_evidencia,
      hora = p.hora_resuelta,
      duracion_min = p.duracion_min,
      ventana_min = p.ventana_min,
      tipo_actividad = p.tipo_actividad,
      checklist = p.checklist
  from tmp_plantillas_hoy p
  where t.fecha = p_fecha and t.plantilla_id = p.id
    and t.estado = 'pendiente' and not t.fijada
    and t.rechazos_count = 0 and t.evidencia_url is null and t.iniciada_at is null
    and p_fecha >= coalesce(p.vigencia_desde, p_fecha)
    and (t.titulo, t.descripcion, t.prioridad, t.requiere_evidencia, t.hora,
         t.duracion_min, t.ventana_min, t.tipo_actividad, t.checklist)
        is distinct from
        (p.titulo, p.descripcion, p.prioridad, p.requiere_evidencia, p.hora_resuelta,
         p.duracion_min, p.ventana_min, p.tipo_actividad, p.checklist);

  -- 3. Individuales que faltan.
  insert into public.tareas_turno (
    plantilla_id, titulo, descripcion, empleado_id, turno_id, fecha,
    prioridad, requiere_evidencia, estado, modo, usuario_id, notas,
    hora, duracion_min, ventana_min, tipo_actividad, checklist
  )
  select p.id, p.titulo, p.descripcion, o.empleado_id, p.turno_id, p_fecha,
         p.prioridad, p.requiere_evidencia, 'pendiente', 'individual', p.usuario_id, o.notas,
         p.hora_resuelta, p.duracion_min, p.ventana_min, p.tipo_actividad, p.checklist
  from tmp_objetivo o
  join tmp_plantillas_hoy p on p.id = o.plantilla_id
  where p.modo = 'individual'
  on conflict (plantilla_id, fecha, empleado_id)
    where plantilla_id is not null and empleado_id is not null do nothing;
  get diagnostics v_m = row_count;
  v_n := v_n + v_m;

  -- 4. Grupales: UNA instancia por plantilla del día (empleado_id NULL).
  insert into public.tareas_turno (
    plantilla_id, titulo, descripcion, empleado_id, turno_id, fecha,
    prioridad, requiere_evidencia, estado, modo, usuario_id,
    hora, duracion_min, ventana_min, tipo_actividad, checklist
  )
  select p.id, p.titulo, p.descripcion, null, p.turno_id, p_fecha,
         p.prioridad, p.requiere_evidencia, 'pendiente', 'grupal', p.usuario_id,
         p.hora_resuelta, p.duracion_min, p.ventana_min, p.tipo_actividad, p.checklist
  from tmp_plantillas_hoy p
  where p.modo = 'grupal'
  on conflict (plantilla_id, fecha)
    where plantilla_id is not null and empleado_id is null do nothing;
  get diagnostics v_m = row_count;
  v_n := v_n + v_m;

  -- 5. Participantes de las grupales abiertas: quitar los que no corresponden…
  delete from public.tareas_turno_participantes pp
  using public.tareas_turno t
  where pp.tarea_id = t.id
    and t.fecha = p_fecha and t.empleado_id is null and t.plantilla_id is not null
    and t.estado in ('pendiente', 'en_curso') and not t.fijada
    and exists (select 1 from tmp_plantillas_hoy p where p.id = t.plantilla_id)
    and not exists (select 1 from tmp_objetivo o
                    where o.plantilla_id = t.plantilla_id and o.empleado_id = pp.empleado_id);
  get diagnostics v_m = row_count;
  v_n := v_n + v_m;

  -- …y sumar los que faltan.
  insert into public.tareas_turno_participantes (tarea_id, empleado_id)
  select t.id, o.empleado_id
  from tmp_objetivo o
  join public.tareas_turno t
    on t.plantilla_id = o.plantilla_id and t.fecha = p_fecha and t.empleado_id is null
  where o.modo = 'grupal' and t.estado in ('pendiente', 'en_curso') and not t.fijada
  on conflict do nothing;
  get diagnostics v_m = row_count;
  v_n := v_n + v_m;

  return v_n;
end $$;
grant execute on function public.fn_materializar_tareas_turno(date) to authenticated, service_role;

notify pgrst, 'reload schema';

-- Chequeo T1 (debe dar 0 filas):
-- select proname, count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
-- where n.nspname='public' and proname like 'fn_%' group by proname having count(*)>1;
