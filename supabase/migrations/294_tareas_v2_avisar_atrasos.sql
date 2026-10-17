-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  294 · Tareas v2: control de atrasos (Etapa 5, 2/4)                 ║
-- ║  fn_tareas_avisar_atrasos(): solo el sistema, cada 5 min (la 296).  ║
-- ║  Resuelve los avisos de tareas cerradas y avisa UNA vez cuando una  ║
-- ║  tarea pasa su margen (sin recordatorios, bloques ni atrasos de más ║
-- ║  de 2 h). A la encargada del turno (si no hay, a todas); si es de   ║
-- ║  una encargada (por puesto o usuario) o privada, a los admin.       ║
-- ║  Probar a mano: select public.fn_tareas_avisar_atrasos();           ║
-- ║  Requiere la 293. Se puede correr de nuevo. Termina en "notify".    ║
-- ╚════════════════════════════════════════════════════════════════════╝

do $$
begin
  if to_regclass('public.tareas_avisos') is null then
    raise exception '294: falta la 293.';
  end if;
end $$;

-- Usuarios activos con un permiso (admin = todos), sin depender de la sesión.
create or replace function public.fn_tareas_usuarios_con(p_clave text)
returns table(usuario_id uuid, nombre text)
language sql stable security definer set search_path = public as $$
  select u.id, u.nombre
  from public.usuarios u left join public.roles r on r.codigo = u.rol
  where u.activo and (u.rol = 'admin' or p_clave = any(coalesce(r.permisos, '{}')))
$$;

-- A quién avisar por una tarea.
create or replace function public.fn_tareas_aviso_para(
  p_tarea_id uuid, out para text, out destinatarios uuid[], out nombres text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_t record;
  v_duenos integer[];
  v_admin uuid[];
begin
  select t.* into v_t from public.tareas_turno t where t.id = p_tarea_id;
  v_duenos := case when v_t.empleado_id is not null then array[v_t.empleado_id]
                   else coalesce((select array_agg(p.empleado_id) from public.tareas_turno_participantes p
                                   where p.tarea_id = p_tarea_id), '{}') end;
  select array_agg(a.usuario_id) into v_admin from public.fn_tareas_usuarios_con('tareas_admin') a;

  -- Es de una encargada: por su puesto o porque su usuario gestiona tareas.
  if not v_t.privada and not exists (
       select 1 from public.empleados e
       where e.id = any(v_duenos)
         and (e.rol_operativo::text in ('encargado', 'responsable_general')
              or e.usuario_id in (select g.usuario_id from public.fn_tareas_usuarios_con('tareas_gestion') g))) then
    para := 'encargada';
    -- Encargadas (gestión sin ser admin) que trabajan ese turno según el cronograma.
    select array_agg(distinct g.usuario_id) into destinatarios
      from public.fn_tareas_usuarios_con('tareas_gestion') g
      join public.empleados e on e.usuario_id = g.usuario_id and e.activo
      join public.horarios_asignados h on h.empleado_id = e.id and h.fecha = v_t.fecha
       and h.turno_id = v_t.turno_id and h.estado in ('planificado', 'cubierto')
     where g.usuario_id <> all(coalesce(v_admin, '{}'));
    if destinatarios is null then
      select array_agg(g.usuario_id) into destinatarios
        from public.fn_tareas_usuarios_con('tareas_gestion') g
       where g.usuario_id <> all(coalesce(v_admin, '{}'));
    end if;
  end if;
  if destinatarios is null then
    para := 'admin';
    destinatarios := v_admin;
  end if;
  select string_agg(coalesce(e.nombre, u.nombre), ', ' order by coalesce(e.nombre, u.nombre)) into nombres
    from public.usuarios u left join public.empleados e on e.usuario_id = u.id
   where u.id = any(destinatarios);
end;
$$;

create or replace function public.fn_tareas_avisar_atrasos()
returns integer language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_para record;
  v_min integer;
  v_n integer := 0;
begin
  if auth.uid() is not null then
    raise exception 'El control de atrasos lo corre solo el sistema.';
  end if;
  -- 1. Avisos de tareas que ya no están abiertas → resueltos.
  update public.tareas_avisos a set
    resuelto_at = now(),
    resolucion = coalesce((select case t.estado::text when 'completada' then 'hecha'
                                    when 'no_se_pudo' then 'no_se_pudo' when 'cancelada' then 'cancelada'
                                    when 'vencida' then 'sin_hacer' else 'otra' end
                             from public.tareas_turno t where t.id = a.tarea_turno_id), 'otra')
  where a.resuelto_at is null
    and not exists (select 1 from public.tareas_turno t
                     where t.id = a.tarea_turno_id and t.estado in ('pendiente', 'en_curso'));

  -- 2. Tareas que pasaron su margen de aviso.
  for r in
    select t.id, t.limite_at
    from public.tareas_turno t
    where t.estado in ('pendiente', 'en_curso')
      and t.tipo_actividad = 'puntual'
      and t.avisar_atraso_min is not null
      and t.aviso_atraso_enviado_at is null
      and t.limite_at is not null
      and now() >= t.limite_at + make_interval(mins => t.avisar_atraso_min)
      and now() < t.limite_at + make_interval(mins => t.avisar_atraso_min) + interval '2 hours'
    order by t.limite_at
    for update of t skip locked
  loop
    select * into v_para from public.fn_tareas_aviso_para(r.id);
    if coalesce(cardinality(v_para.destinatarios), 0) = 0 then
      continue;
    end if;
    v_min := floor(extract(epoch from (now() - r.limite_at)) / 60)::integer;
    insert into public.tareas_avisos (tarea_turno_id, fecha, turno_id, titulo, privada, duenos, duenos_nombres,
      para, destinatarios, destinatarios_nombres, limite_at, minutos_atraso)
    select t.id, t.fecha, t.turno_id, t.titulo, t.privada, d.duenos,
           (select string_agg(e.nombre || coalesce(' ' || e.apellido, ''), ', ') from public.empleados e
             where e.id = any(d.duenos)),
           v_para.para, v_para.destinatarios, v_para.nombres, r.limite_at, v_min
    from public.tareas_turno t
    cross join lateral (select case when t.empleado_id is not null then array[t.empleado_id]
             else coalesce((select array_agg(p.empleado_id order by p.empleado_id)
                              from public.tareas_turno_participantes p where p.tarea_id = t.id), '{}') end as duenos) d
    where t.id = r.id
    on conflict (tarea_turno_id) do nothing;

    update public.tareas_turno set aviso_atraso_enviado_at = now() where id = r.id;
    perform public.fn_tarea_evento('aviso_atraso', r.id, null, null,
      jsonb_build_object('para', v_para.para, 'avisado_a', v_para.nombres, 'minutos', v_min),
      null, 'sistema');
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

revoke execute on function public.fn_tareas_usuarios_con(text) from public, anon, authenticated, service_role;
revoke execute on function public.fn_tareas_aviso_para(uuid) from public, anon, authenticated, service_role;
revoke execute on function public.fn_tareas_avisar_atrasos() from public, anon, authenticated, service_role;

do $$
begin
  if has_function_privilege('authenticated', 'public.fn_tareas_avisar_atrasos()', 'EXECUTE')
     or has_function_privilege('anon', 'public.fn_tareas_avisar_atrasos()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.fn_tareas_usuarios_con(text)', 'EXECUTE') then
    raise exception '294: quedaron funciones ejecutables desde la app.';
  end if;
end $$;

notify pgrst, 'reload schema';
