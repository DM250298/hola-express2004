-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  274 · Tareas v2: iniciar, reabrir, rechazar, omitir y "no se pudo" ║
-- ║  (Etapa 1 · bloque E)                                                ║
-- ║                                                                     ║
-- ║  Mismas firmas que usa la app de hoy; ahora cada acción queda en el  ║
-- ║  registro (con "en nombre de" si la encargada marca por otro) y      ║
-- ║  respeta las privadas y el plazo de 2 h del empleado (273).          ║
-- ║   · fn_iniciar_tarea, fn_omitir_tarea: quien puede operar.           ║
-- ║   · fn_reabrir_tarea, fn_rechazar_tarea: encargada o admin.          ║
-- ║   · fn_tarea_no_se_pudo(tarea, motivo, detalle): NUEVA. Queda        ║
-- ║     cerrada para la app hasta la 283 (la app vieja no conoce el      ║
-- ║     estado nuevo).                                                   ║
-- ║                                                                     ║
-- ║  Requiere la 273. Se puede correr de nuevo.                          ║
-- ║  Última línea del archivo: "notify pgrst, 'reload schema';"          ║
-- ╚════════════════════════════════════════════════════════════════════╝

do $$
begin
  if to_regprocedure('public.fn_tarea_puede_gestionar(uuid)') is null then
    raise exception '274: falta la 273.';
  end if;
end $$;

create or replace function public.fn_iniciar_tarea(p_tarea_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_emp integer; v_t record;
begin
  v_emp := public.fn_tarea_puede_operar(p_tarea_id);
  select estado, tipo_actividad into v_t from public.tareas_turno where id = p_tarea_id for update;
  if v_t.estado not in ('pendiente', 'vencida') then
    raise exception 'La tarea no se puede iniciar en su estado actual (%).', v_t.estado;
  end if;
  if v_t.tipo_actividad = 'continua' then
    raise exception 'Es un recordatorio de todo el turno: no se marca.';
  end if;
  update public.tareas_turno
     set estado = 'en_curso', iniciada_por = v_emp, iniciada_por_usuario = auth.uid(), iniciada_at = now()
   where id = p_tarea_id;
  perform public.fn_tarea_evento('iniciada', p_tarea_id, null,
    jsonb_build_object('estado', v_t.estado), jsonb_build_object('estado', 'en_curso'), null, 'app');
end $$;

create or replace function public.fn_omitir_tarea(p_tarea_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare v_estado public.estado_tarea_turno;
begin
  perform public.fn_tarea_puede_operar(p_tarea_id);
  if p_motivo is null or length(btrim(p_motivo)) < 5 then
    raise exception 'Indicá el motivo para omitir la tarea (mínimo 5 caracteres).';
  end if;
  select estado into v_estado from public.tareas_turno where id = p_tarea_id for update;
  if v_estado not in ('pendiente', 'en_curso', 'vencida') then
    raise exception 'La tarea no se puede omitir en su estado actual (%).', v_estado;
  end if;
  update public.tareas_turno set estado = 'cancelada', motivo_omision = btrim(p_motivo) where id = p_tarea_id;
  perform public.fn_tarea_evento('cancelada', p_tarea_id, null,
    jsonb_build_object('estado', v_estado), jsonb_build_object('estado', 'cancelada'),
    btrim(p_motivo), 'app:omitir');
end $$;

create or replace function public.fn_tarea_no_se_pudo(
  p_tarea_id uuid, p_motivo public.tarea_motivo_no_se_pudo, p_detalle text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_t record; v_detalle text := nullif(btrim(p_detalle), '');
begin
  perform public.fn_tarea_puede_operar(p_tarea_id);
  if p_motivo is null then raise exception 'Elegí el motivo.'; end if;
  if length(v_detalle) > 500 then raise exception 'El detalle no puede superar los 500 caracteres.'; end if;
  select estado, tipo_actividad into v_t from public.tareas_turno where id = p_tarea_id for update;
  if v_t.estado not in ('pendiente', 'en_curso', 'vencida') then
    raise exception 'La tarea no se puede cerrar en su estado actual (%).', v_t.estado;
  end if;
  if v_t.tipo_actividad = 'continua' then
    raise exception 'Es un recordatorio de todo el turno: no se marca.';
  end if;
  update public.tareas_turno
     set estado = 'no_se_pudo', motivo_no_se_pudo = p_motivo, detalle_motivo = v_detalle
   where id = p_tarea_id;
  perform public.fn_tarea_evento('no_se_pudo', p_tarea_id, null,
    jsonb_build_object('estado', v_t.estado),
    jsonb_strip_nulls(jsonb_build_object('estado', 'no_se_pudo', 'motivo', p_motivo, 'detalle', v_detalle)),
    v_detalle, 'app');
end $$;

create or replace function public.fn_reabrir_tarea(p_tarea_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_t record;
begin
  perform public.fn_tarea_puede_gestionar(p_tarea_id);
  select * into v_t from public.tareas_turno where id = p_tarea_id for update;
  if v_t.estado not in ('completada', 'cancelada', 'vencida', 'no_se_pudo') then
    raise exception 'La tarea ya está abierta (%).', v_t.estado;
  end if;
  if v_t.trasladada_a is not null then
    raise exception 'La tarea fue trasladada al turno siguiente: operá sobre la nueva.';
  end if;
  update public.tareas_turno
     set estado = 'pendiente', completada_por = null, completada_por_usuario = null, completada_at = null,
         evidencia_url = null, motivo_omision = null, motivo_no_se_pudo = null, detalle_motivo = null,
         iniciada_por = null, iniciada_por_usuario = null, iniciada_at = null
   where id = p_tarea_id;
  perform public.fn_tarea_evento('reabierta', p_tarea_id, null,
    jsonb_strip_nulls(jsonb_build_object('estado', v_t.estado, 'motivo', v_t.motivo_no_se_pudo,
      'detalle', v_t.detalle_motivo, 'motivo_omision', v_t.motivo_omision,
      'completada_at', v_t.completada_at, 'evidencia_url', v_t.evidencia_url)),
    jsonb_build_object('estado', 'pendiente'), null, 'app');
end $$;

create or replace function public.fn_rechazar_tarea(p_tarea_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare v_t record;
begin
  perform public.fn_tarea_puede_gestionar(p_tarea_id);
  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception 'El motivo del rechazo es obligatorio.';
  end if;
  select * into v_t from public.tareas_turno where id = p_tarea_id for update;
  if v_t.estado <> 'completada' then
    raise exception 'Solo se puede rechazar una tarea completada (estado actual: %).', v_t.estado;
  end if;
  update public.tareas_turno set
    estado = 'pendiente', rechazada_por = auth.uid(), rechazada_at = now(),
    motivo_rechazo = btrim(p_motivo), rechazos_count = rechazos_count + 1,
    completada_por = null, completada_por_usuario = null, completada_at = null, evidencia_url = null
  where id = p_tarea_id;
  perform public.fn_tarea_evento('rechazada', p_tarea_id, null,
    jsonb_strip_nulls(jsonb_build_object('estado', 'completada', 'completada_por', v_t.completada_por,
      'completada_at', v_t.completada_at, 'evidencia_url', v_t.evidencia_url)),
    jsonb_build_object('estado', 'pendiente'), btrim(p_motivo), 'app');
end $$;

revoke execute on function public.fn_iniciar_tarea(uuid) from public, anon;
revoke execute on function public.fn_omitir_tarea(uuid, text) from public, anon;
revoke execute on function public.fn_reabrir_tarea(uuid) from public, anon;
revoke execute on function public.fn_rechazar_tarea(uuid, text) from public, anon;
grant execute on function public.fn_iniciar_tarea(uuid) to authenticated;
grant execute on function public.fn_omitir_tarea(uuid, text) to authenticated;
grant execute on function public.fn_reabrir_tarea(uuid) to authenticated;
grant execute on function public.fn_rechazar_tarea(uuid, text) to authenticated;
-- Se habilita para la app en la 283, cuando la app nueva ya esté publicada.
revoke execute on function public.fn_tarea_no_se_pudo(uuid, public.tarea_motivo_no_se_pudo, text)
  from public, anon, authenticated;

do $$
begin
  if to_regprocedure('public.fn_tarea_no_se_pudo(uuid,public.tarea_motivo_no_se_pudo,text)') is null then
    raise exception '274: falta fn_tarea_no_se_pudo.';
  end if;
  if has_function_privilege('anon', 'public.fn_iniciar_tarea(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.fn_tarea_no_se_pudo(uuid,public.tarea_motivo_no_se_pudo,text)', 'EXECUTE') then
    raise exception '274: quedaron permisos de más.';
  end if;
end $$;

notify pgrst, 'reload schema';
