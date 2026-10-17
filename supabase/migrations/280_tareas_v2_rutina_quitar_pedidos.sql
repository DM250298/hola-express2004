-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  280 · Tareas v2: quitar de la rutina, pedidos y "actualizar hoy"   ║
-- ║  (Etapa 1 · bloque F)                                                ║
-- ║                                                                     ║
-- ║   · fn_rutina_quitar(id, motivo, aplicar): el administrador la       ║
-- ║     desactiva (nunca se borra), desde mañana por defecto; si la      ║
-- ║     llama la encargada, se convierte en un pedido. Devuelve el id    ║
-- ║     del pedido o null.                                               ║
-- ║   · fn_rutina_reactivar(id, aplicar): administrador.                 ║
-- ║   · fn_rutina_pedir_quitar(id, motivo): la encargada pide; un solo   ║
-- ║     pedido pendiente por tarea.                                      ║
-- ║   · fn_pedido_resolver(pedido, aprobar, nota): administrador, una    ║
-- ║     sola vez. Aprobar = quitar desde mañana.                         ║
-- ║   · fn_agenda_actualizar_hoy(turno, plantilla): adelanta a hoy los   ║
-- ║     cambios "desde mañana" (de una tarea o de todo el turno), solo   ║
-- ║     en lo que nadie tocó. Encargada o admin.                         ║
-- ║  Todo queda en el registro. Requiere la 279. Se puede correr de      ║
-- ║  nuevo. Última línea del archivo: "notify pgrst, 'reload schema';"   ║
-- ╚════════════════════════════════════════════════════════════════════╝

do $$
begin
  if to_regprocedure('public.fn_rutina_guardar(uuid,jsonb,text,integer[])') is null then
    raise exception '280: falta la 279.';
  end if;
end $$;

-- Interna: activa/desactiva con versión (lo de antes rige hasta el día anterior a p_desde).
create or replace function public.fn_rutina_set_activa(p_id uuid, p_activa boolean, p_desde date)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_old public.tareas_recurrentes; v_hoy date := public.fn_tareas_hoy();
begin
  select * into v_old from public.tareas_recurrentes where id = p_id for update;
  if v_old.id is null then raise exception 'La tarea de la rutina no existe.'; end if;
  if v_old.activa = p_activa and coalesce(v_old.cambios_desde, v_hoy) <= v_hoy then return false; end if;
  update public.tareas_recurrentes set
    activa = p_activa,
    version_anterior = case when v_old.cambios_desde > v_hoy and v_old.version_anterior is not null
                            then v_old.version_anterior else public.fn_rutina_version(v_old) end,
    cambios_desde = p_desde, updated_at = now(), updated_by = auth.uid()
  where id = p_id;
  perform public.fn_rutina_resincronizar(p_desde);
  return true;
end $$;

create or replace function public.fn_rutina_pedir_quitar(p_id uuid, p_motivo text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_pedido bigint; v_emp integer; v_motivo text := nullif(btrim(p_motivo), '');
begin
  if not (public.fn_tiene_permiso('tareas_gestion') or public.fn_tiene_permiso('tareas_admin')) then
    raise exception 'Solo la encargada puede pedir que se quite una tarea.';
  end if;
  if v_motivo is null or length(v_motivo) < 5 then raise exception 'Contá por qué (mínimo 5 caracteres).'; end if;
  if not exists (select 1 from public.tareas_recurrentes r where r.id = p_id and r.activa and not r.privada) then
    raise exception 'La tarea no existe o ya no está en la rutina.';
  end if;
  if exists (select 1 from public.tareas_pedidos where tarea_recurrente_id = p_id and estado = 'pendiente') then
    raise exception 'Ya hay un pedido pendiente para esta tarea.';
  end if;
  select id into v_emp from public.empleados where usuario_id = auth.uid();
  insert into public.tareas_pedidos (tarea_recurrente_id, tipo, motivo, pedido_por, pedido_por_empleado)
  values (p_id, 'quitar', v_motivo, auth.uid(), v_emp) returning id into v_pedido;
  perform public.fn_tarea_evento('pedido_quitar', null, p_id, null, jsonb_build_object('pedido_id', v_pedido),
    v_motivo, 'app', v_pedido);
  return v_pedido;
end $$;

create or replace function public.fn_rutina_quitar(p_id uuid, p_motivo text default null, p_aplicar text default 'manana')
returns bigint language plpgsql security definer set search_path = public as $$
declare v_hoy date := public.fn_tareas_hoy();
begin
  if not public.fn_tiene_permiso('tareas_admin') then
    return public.fn_rutina_pedir_quitar(p_id, p_motivo);
  end if;
  if p_aplicar not in ('hoy', 'manana') then raise exception 'Elegí si aplica desde hoy o desde mañana.'; end if;
  if public.fn_rutina_set_activa(p_id, false, case when p_aplicar = 'hoy' then v_hoy else v_hoy + 1 end) then
    perform public.fn_tarea_evento('quitada', null, p_id, jsonb_build_object('activa', true),
      jsonb_build_object('activa', false),
      coalesce(nullif(btrim(p_motivo), '') || ' ', '') || case when p_aplicar = 'hoy' then '(desde hoy)' else '(desde mañana)' end,
      'app');
  end if;
  return null;
end $$;

create or replace function public.fn_rutina_reactivar(p_id uuid, p_aplicar text default 'manana')
returns void language plpgsql security definer set search_path = public as $$
declare v_hoy date := public.fn_tareas_hoy();
begin
  if not public.fn_tiene_permiso('tareas_admin') then
    raise exception 'Solo un administrador vuelve a poner una tarea en la rutina.';
  end if;
  if p_aplicar not in ('hoy', 'manana') then raise exception 'Elegí si aplica desde hoy o desde mañana.'; end if;
  if public.fn_rutina_set_activa(p_id, true, case when p_aplicar = 'hoy' then v_hoy else v_hoy + 1 end) then
    perform public.fn_tarea_evento('reactivada', null, p_id, jsonb_build_object('activa', false),
      jsonb_build_object('activa', true), null, 'app');
  end if;
end $$;

create or replace function public.fn_pedido_resolver(p_pedido_id bigint, p_aprobar boolean, p_nota text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_p public.tareas_pedidos;
begin
  if not public.fn_tiene_permiso('tareas_admin') then
    raise exception 'Solo un administrador resuelve pedidos.';
  end if;
  select * into v_p from public.tareas_pedidos where id = p_pedido_id for update;
  if v_p.id is null then raise exception 'El pedido no existe.'; end if;
  if v_p.estado <> 'pendiente' then raise exception 'El pedido ya fue resuelto.'; end if;
  perform set_config('hex.pedido_resolver', 'on', true);
  update public.tareas_pedidos
     set estado = case when p_aprobar then 'aprobado' else 'rechazado' end::public.tarea_pedido_estado,
         resuelto_por = auth.uid(), resuelto_at = now(), nota_resolucion = nullif(btrim(p_nota), '')
   where id = p_pedido_id;
  perform set_config('hex.pedido_resolver', '', true);
  perform public.fn_tarea_evento(case when p_aprobar then 'pedido_aprobado' else 'pedido_rechazado' end::public.tarea_evento_tipo,
    null, v_p.tarea_recurrente_id, jsonb_build_object('estado', 'pendiente'),
    jsonb_build_object('estado', case when p_aprobar then 'aprobado' else 'rechazado' end),
    nullif(btrim(p_nota), ''), 'app', p_pedido_id);
  if p_aprobar and public.fn_rutina_set_activa(v_p.tarea_recurrente_id, false, public.fn_tareas_hoy() + 1) then
    perform public.fn_tarea_evento('quitada', null, v_p.tarea_recurrente_id, jsonb_build_object('activa', true),
      jsonb_build_object('activa', false), 'Pedido aprobado (desde mañana)', 'app', p_pedido_id);
  end if;
end $$;

create or replace function public.fn_agenda_actualizar_hoy(p_turno_id integer, p_plantilla_id uuid default null)
returns integer language plpgsql security definer set search_path = public as $$
declare v_hoy date := public.fn_tareas_hoy(); v_n integer; v_ids uuid[];
begin
  if not (public.fn_tiene_permiso('tareas_gestion') or public.fn_tiene_permiso('tareas_admin')) then
    raise exception 'Solo la encargada o un administrador.';
  end if;
  if p_plantilla_id is not null and not public.fn_tiene_permiso('tareas_admin')
     and exists (select 1 from public.tareas_recurrentes where id = p_plantilla_id and privada) then
    raise exception 'Sin permiso para esta tarea.';
  end if;
  with u as (
    update public.tareas_recurrentes r set cambios_desde = v_hoy
     where r.cambios_desde > v_hoy and r.turno_id = p_turno_id
       and (p_plantilla_id is null or r.id = p_plantilla_id)
       and (not r.privada or public.fn_tiene_permiso('tareas_admin'))
    returning r.id)
  select array_agg(id) into v_ids from u;
  v_n := public.fn_tareas_sincronizar(v_hoy, p_turno_id);
  perform public.fn_tarea_evento('agenda_actualizada', null, p_plantilla_id, null,
    jsonb_build_object('fecha', v_hoy, 'plantillas', coalesce(v_ids, '{}'), 'cambios', v_n),
    null, 'app', null, p_turno_id);
  return v_n;
end $$;

revoke execute on function public.fn_rutina_set_activa(uuid, boolean, date) from public, anon, authenticated;
revoke execute on function public.fn_rutina_pedir_quitar(uuid, text) from public, anon;
revoke execute on function public.fn_rutina_quitar(uuid, text, text) from public, anon;
revoke execute on function public.fn_rutina_reactivar(uuid, text) from public, anon;
revoke execute on function public.fn_pedido_resolver(bigint, boolean, text) from public, anon;
revoke execute on function public.fn_agenda_actualizar_hoy(integer, uuid) from public, anon;
grant execute on function public.fn_rutina_pedir_quitar(uuid, text) to authenticated;
grant execute on function public.fn_rutina_quitar(uuid, text, text) to authenticated;
grant execute on function public.fn_rutina_reactivar(uuid, text) to authenticated;
grant execute on function public.fn_pedido_resolver(bigint, boolean, text) to authenticated;
grant execute on function public.fn_agenda_actualizar_hoy(integer, uuid) to authenticated;

do $$
begin
  if (select count(*) from pg_proc where proname in ('fn_rutina_set_activa', 'fn_rutina_pedir_quitar',
        'fn_rutina_quitar', 'fn_rutina_reactivar', 'fn_pedido_resolver', 'fn_agenda_actualizar_hoy')) <> 6 then
    raise exception '280: faltan funciones (o hay duplicadas).';
  end if;
end $$;

notify pgrst, 'reload schema';
