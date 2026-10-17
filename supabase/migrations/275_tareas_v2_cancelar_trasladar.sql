-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  275 · Tareas v2: cancelar y trasladar (Etapa 1 · bloque E)         ║
-- ║                                                                     ║
-- ║   · fn_tarea_cancelar(tarea, motivo): NUEVA. Reemplaza al "Eliminar" ║
-- ║     de la agenda (nada se borra). La encargada cancela puntuales y   ║
-- ║     tareas de una rutina que ya no aplica ese día; las de la rutina  ║
-- ║     vigente, solo un administrador (la encargada usa "Omitir" o      ║
-- ║     "No se pudo"). Privadas: solo administradores.                   ║
-- ║   · fn_trasladar_tarea v2, misma firma: la nueva copia área, aviso y ║
-- ║     puesto; registra "trasladada" en las dos tareas.                 ║
-- ║                                                                     ║
-- ║  Requiere la 274. Se puede correr de nuevo.                          ║
-- ║  Última línea del archivo: "notify pgrst, 'reload schema';"          ║
-- ╚════════════════════════════════════════════════════════════════════╝

do $$
begin
  if to_regprocedure('public.fn_tarea_no_se_pudo(uuid,public.tarea_motivo_no_se_pudo,text)') is null then
    raise exception '275: falta la 274.';
  end if;
end $$;

create or replace function public.fn_tarea_cancelar(p_tarea_id uuid, p_motivo text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_t record; v_motivo text := nullif(btrim(p_motivo), '');
begin
  perform public.fn_tarea_puede_gestionar(p_tarea_id);
  select * into v_t from public.tareas_turno where id = p_tarea_id for update;
  if v_t.estado not in ('pendiente', 'en_curso', 'vencida') then
    raise exception 'La tarea no se puede cancelar en su estado actual (%).', v_t.estado;
  end if;
  if v_t.plantilla_id is not null and not public.fn_tiene_permiso('tareas_admin')
     and exists (select 1 from public.fn_plantillas_tareas_dia(v_t.fecha) p where p.id = v_t.plantilla_id) then
    raise exception 'Es una tarea de la rutina: usá "No se pudo" o pedí que se quite de la rutina.';
  end if;
  update public.tareas_turno
     set estado = 'cancelada', motivo_omision = coalesce(v_motivo, 'Cancelada')
   where id = p_tarea_id;
  perform public.fn_tarea_evento('cancelada', p_tarea_id, null,
    jsonb_build_object('estado', v_t.estado), jsonb_build_object('estado', 'cancelada'), v_motivo, 'app');
end $$;

create or replace function public.fn_trasladar_tarea(p_tarea_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_t record; v_emp integer; v_fecha date; v_nuevo uuid;
  v_sig_id integer; v_nombre_sig text;
begin
  v_emp := public.fn_tarea_puede_operar(p_tarea_id);
  select * into v_t from public.tareas_turno where id = p_tarea_id for update;
  if v_t.estado not in ('pendiente', 'en_curso', 'vencida') then
    raise exception 'La tarea no se puede trasladar en su estado actual (%).', v_t.estado;
  end if;
  if v_t.trasladada_a is not null then
    raise exception 'La tarea ya fue trasladada.';
  end if;

  v_fecha := v_t.fecha;
  if v_t.turno_id is not null then
    with ordenados as (
      select tp.id, tp.nombre, row_number() over (order by tp.hora_inicio) as n,
             count(*) over () as total
      from public.turnos_plantilla tp where tp.activo or tp.id = v_t.turno_id
    ), actual as (
      select n from ordenados where id = v_t.turno_id
    )
    select o.id, o.nombre::text into v_sig_id, v_nombre_sig
    from ordenados o, actual a
    where o.n = (a.n % o.total) + 1 and o.id <> v_t.turno_id;
    if v_sig_id is null then
      raise exception 'No hay un turno siguiente activo.';
    end if;
    if exists (select 1 from public.turnos_plantilla where id = v_t.turno_id and cruza_medianoche) then
      v_fecha := v_t.fecha + 1;
    end if;
  end if;

  insert into public.tareas_turno (
    plantilla_id, titulo, descripcion, empleado_id, turno_id, fecha,
    prioridad, requiere_evidencia, estado, modo, usuario_id, notas,
    hora, duracion_min, ventana_min, tipo_actividad, checklist,
    fijada, asignacion_manual, trasladada_de, area, avisar_atraso_min, roles_puesto
  ) values (
    null, v_t.titulo, v_t.descripcion, v_t.empleado_id,
    coalesce(v_sig_id, v_t.turno_id), v_fecha,
    v_t.prioridad, v_t.requiere_evidencia, 'pendiente', v_t.modo, v_t.usuario_id,
    'Trasladada desde el turno anterior (' || to_char(v_t.fecha, 'DD/MM') || ')',
    null, v_t.duracion_min, v_t.ventana_min, v_t.tipo_actividad, v_t.checklist,
    true, v_t.asignacion_manual, v_t.id, v_t.area, v_t.avisar_atraso_min, v_t.roles_puesto
  ) returning id into v_nuevo;

  insert into public.tareas_turno_participantes (tarea_id, empleado_id)
  select v_nuevo, empleado_id from public.tareas_turno_participantes
  where tarea_id = v_t.id on conflict do nothing;

  update public.tareas_turno
    set estado = 'cancelada', trasladada_a = v_nuevo,
        motivo_omision = coalesce(motivo_omision,
          'Trasladada al turno ' || coalesce(v_nombre_sig, 'siguiente') ||
          ' del ' || to_char(v_fecha, 'DD/MM'))
    where id = v_t.id;

  perform public.fn_tarea_evento('trasladada', v_t.id, null,
    jsonb_build_object('estado', v_t.estado),
    jsonb_build_object('estado', 'cancelada', 'trasladada_a', v_nuevo), null, 'app');
  perform public.fn_tarea_evento('trasladada', v_nuevo, null,
    jsonb_build_object('trasladada_de', v_t.id, 'fecha', v_t.fecha, 'turno_id', v_t.turno_id),
    jsonb_build_object('fecha', v_fecha, 'turno_id', coalesce(v_sig_id, v_t.turno_id)), null, 'app');
  return v_nuevo;
end $$;

revoke execute on function public.fn_tarea_cancelar(uuid, text) from public, anon;
revoke execute on function public.fn_trasladar_tarea(uuid) from public, anon;
grant execute on function public.fn_tarea_cancelar(uuid, text) to authenticated;
grant execute on function public.fn_trasladar_tarea(uuid) to authenticated;

do $$
begin
  if to_regprocedure('public.fn_tarea_cancelar(uuid,text)') is null
     or not exists (select 1 from pg_proc where proname = 'fn_trasladar_tarea' and prosrc like '%fn_tarea_evento%') then
    raise exception '275: faltan funciones.';
  end if;
end $$;

notify pgrst, 'reload schema';
