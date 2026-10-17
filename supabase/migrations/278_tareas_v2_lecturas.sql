-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  278 · Tareas v2: historial, notas del turno anterior y "mi turno"  ║
-- ║  (Etapa 1 · bloque E) — solo lecturas                                ║
-- ║                                                                     ║
-- ║   · fn_tarea_historial(tarea): admin todo; encargada sin privadas;   ║
-- ║     empleado, lo que fue suyo.                                       ║
-- ║   · fn_rutina_historial(plantilla): encargada o admin (privadas,     ║
-- ║     solo admin).                                                     ║
-- ║   · fn_notas_proximo_turno(fecha, turno): las notas que dejó el      ║
-- ║     turno anterior (para el pase de turno). Encargada, admin o       ║
-- ║     empleados (mi_panel); privadas solo admin.                       ║
-- ║   · fn_mi_turno(fecha): para el celular, con quién trabajo ese día   ║
-- ║     (nombres y puesto, sin abrir la tabla de empleados).             ║
-- ║                                                                     ║
-- ║  Requiere la 277. Se puede correr de nuevo.                          ║
-- ║  Última línea del archivo: "notify pgrst, 'reload schema';"          ║
-- ╚════════════════════════════════════════════════════════════════════╝

do $$
begin
  if to_regprocedure('public.fn_tarea_nota(uuid,text)') is null then
    raise exception '278: falta la 277.';
  end if;
end $$;

create or replace function public.fn_tarea_historial(p_tarea_id uuid)
returns table(id bigint, created_at timestamptz, tipo text, actor_nombre text, en_nombre_de text,
              antes jsonb, despues jsonb, motivo text, origen text)
language plpgsql stable security definer set search_path = public as $$
declare v_admin boolean := public.fn_tiene_permiso('tareas_admin');
        v_gestion boolean := public.fn_tiene_permiso('tareas_gestion');
        v_emp integer; v_mia boolean;
begin
  select e.id into v_emp from public.empleados e where e.usuario_id = auth.uid();
  if not (v_admin or v_gestion) then
    if v_emp is null or not public.fn_tiene_permiso('mi_panel') then raise exception 'Sin permiso.'; end if;
    v_mia := exists (select 1 from public.tareas_turno t where t.id = p_tarea_id and not t.privada
                       and (t.empleado_id = v_emp or exists (select 1 from public.tareas_turno_participantes p
                              where p.tarea_id = t.id and p.empleado_id = v_emp)));
  end if;
  return query
    select ev.id, ev.created_at, ev.tipo::text, ev.actor_nombre,
           (select string_agg(e.nombre || coalesce(' ' || e.apellido, ''), ', ')
              from public.empleados e where e.id = any(ev.en_nombre_de)),
           ev.antes, ev.despues, ev.motivo, ev.origen
    from public.tareas_eventos ev
    where ev.tarea_turno_id = p_tarea_id
      and (v_admin or not ev.privada)
      and (v_admin or v_gestion or v_mia or v_emp = any(ev.duenos))
    order by ev.created_at, ev.id;
end $$;

create or replace function public.fn_rutina_historial(p_plantilla_id uuid)
returns table(id bigint, created_at timestamptz, tipo text, actor_nombre text,
              antes jsonb, despues jsonb, motivo text, origen text)
language plpgsql stable security definer set search_path = public as $$
declare v_admin boolean := public.fn_tiene_permiso('tareas_admin');
begin
  if not (v_admin or public.fn_tiene_permiso('tareas_gestion')) then raise exception 'Sin permiso.'; end if;
  if not v_admin and exists (select 1 from public.tareas_recurrentes r where r.id = p_plantilla_id and r.privada) then
    raise exception 'Sin permiso.';
  end if;
  return query
    select ev.id, ev.created_at, ev.tipo::text, ev.actor_nombre, ev.antes, ev.despues, ev.motivo, ev.origen
    from public.tareas_eventos ev
    where ev.tarea_recurrente_id = p_plantilla_id and ev.entidad <> 'agenda'
      and (v_admin or not ev.privada)
    order by ev.created_at, ev.id;
end $$;

create or replace function public.fn_notas_proximo_turno(p_fecha date, p_turno_id integer)
returns table(tarea_id uuid, fecha date, turno_id integer, titulo text, nota text,
              estado text, quien text)
language plpgsql stable security definer set search_path = public as $$
declare v_admin boolean := public.fn_tiene_permiso('tareas_admin');
        v_prev integer; v_fecha date := p_fecha;
begin
  if not (v_admin or public.fn_tiene_permiso('tareas_gestion') or public.fn_tiene_permiso('mi_panel')) then
    raise exception 'Sin permiso.';
  end if;
  with ordenados as (
    select tp.id, row_number() over (order by tp.hora_inicio) as n, count(*) over () as total
    from public.turnos_plantilla tp where tp.activo or tp.id = p_turno_id
  )
  select o.id, case when a.n = 1 then p_fecha - 1 else p_fecha end into v_prev, v_fecha
  from ordenados o, (select n from ordenados where id = p_turno_id) a
  where o.n = case when a.n = 1 then o.total else a.n - 1 end and o.id <> p_turno_id;
  if v_prev is null then return; end if;
  return query
    select t.id, t.fecha, t.turno_id, t.titulo, t.nota_proximo_turno, t.estado::text,
           coalesce((select e.nombre || coalesce(' ' || e.apellido, '') from public.empleados e
                      where e.id = coalesce(t.completada_por, t.empleado_id)),
                    (select u.nombre from public.usuarios u where u.id = t.completada_por_usuario))
    from public.tareas_turno t
    where t.fecha = v_fecha and t.turno_id = v_prev and t.nota_proximo_turno is not null
      and (v_admin or not t.privada)
    order by t.hora nulls last, t.titulo;
end $$;

create or replace function public.fn_mi_turno(p_fecha date)
returns table(turno_id integer, turno text, empleado_id integer, nombre text, rol_operativo text, soy_yo boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_emp integer;
begin
  select e.id into v_emp from public.empleados e where e.usuario_id = auth.uid() and e.activo;
  if v_emp is null then raise exception 'Tu usuario no tiene un legajo vinculado.'; end if;
  if p_fecha is null or abs(p_fecha - public.fn_tareas_hoy()) > 14 then
    raise exception 'Fecha fuera de rango.';
  end if;
  return query
    select h.turno_id, tp.nombre::text, e.id, e.nombre || coalesce(' ' || e.apellido, ''),
           e.rol_operativo::text, e.id = v_emp
    from public.horarios_asignados h
    join public.turnos_plantilla tp on tp.id = h.turno_id
    join public.empleados e on e.id = h.empleado_id and e.activo
    where h.fecha = p_fecha and h.estado in ('planificado', 'cubierto')
      and h.turno_id in (select h2.turno_id from public.horarios_asignados h2
                          where h2.fecha = p_fecha and h2.empleado_id = v_emp
                            and h2.estado in ('planificado', 'cubierto'))
    order by tp.hora_inicio, e.id <> v_emp, e.nombre;
end $$;

revoke execute on function public.fn_tarea_historial(uuid) from public, anon;
revoke execute on function public.fn_rutina_historial(uuid) from public, anon;
revoke execute on function public.fn_notas_proximo_turno(date, integer) from public, anon;
revoke execute on function public.fn_mi_turno(date) from public, anon;
grant execute on function public.fn_tarea_historial(uuid) to authenticated;
grant execute on function public.fn_rutina_historial(uuid) to authenticated;
grant execute on function public.fn_notas_proximo_turno(date, integer) to authenticated;
grant execute on function public.fn_mi_turno(date) to authenticated;

do $$
begin
  if (select count(*) from pg_proc where proname in ('fn_tarea_historial', 'fn_rutina_historial',
        'fn_notas_proximo_turno', 'fn_mi_turno')) <> 4 then
    raise exception '278: faltan funciones (o hay duplicadas).';
  end if;
end $$;

notify pgrst, 'reload schema';
