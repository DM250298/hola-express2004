-- 292 · Tareas v2: reparar la 269 (3 de 3) — quién trabaja y a quién le toca
-- Repara la 269, que en las dos bases quedó sin aplicar entera (el editor
-- recortó el pegado). Es la misma definición, partida en 3 archivos cortos
-- (290, 291, 292). Se puede correr de nuevo.
-- fn_personas_turno(fecha, turno) y fn_a_quien_le_toca(fecha, turno, puestos):
-- lecturas para la encargada y los administradores (vista por persona,
-- tareas puntuales "por puesto").

-- ─── Lecturas para la gestión (encargada y administradores) ─────────────
-- Quién trabaja en un turno ese día (sin datos de sueldo ni de contacto).
create or replace function public.fn_personas_turno(p_fecha date, p_turno_id integer)
returns table(empleado_id integer, nombre text, rol_operativo text, estado text, notas text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.fn_tiene_permiso('tareas_gestion') or public.fn_tiene_permiso('tareas_admin')) then
    raise exception 'Sin permiso.';
  end if;
  return query
    select e.id, e.nombre || coalesce(' ' || e.apellido, ''), e.rol_operativo::text,
           h.estado::text, h.notas
    from public.horarios_asignados h
    join public.empleados e on e.id = h.empleado_id and e.activo
    where h.fecha = p_fecha and h.turno_id = p_turno_id
      and h.estado in ('planificado', 'cubierto')
    order by e.nombre;
end;
$$;

-- A quién le tocaría una tarea por puesto ese día (para "Hoy le toca a…").
create or replace function public.fn_a_quien_le_toca(p_fecha date, p_turno_id integer, p_puestos text[])
returns table(empleado_id integer, nombre text, notas text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.fn_tiene_permiso('tareas_gestion') or public.fn_tiene_permiso('tareas_admin')) then
    raise exception 'Sin permiso.';
  end if;
  return query
    with en_turno as (
      select p.empleado_id, p.nombre, p.rol_operativo
      from public.fn_personas_turno(p_fecha, p_turno_id) p
    ),
    directo as (
      select t.empleado_id, t.nombre, null::text as notas from en_turno t
      where t.rol_operativo = any(p_puestos)
    ),
    cubre as (
      select t.empleado_id, t.nombre, 'Cubre el puesto'::text as notas from en_turno t
      where not exists (select 1 from directo)
      order by case t.rol_operativo when 'pivote' then 1 when 'encargado' then 2
                    when 'responsable_general' then 3 when 'cajero' then 4
                    when 'fiambreria' then 5 else 6 end, t.empleado_id
      limit 1
    )
    select * from directo
    union all
    select * from cubre;
end;
$$;

revoke execute on function public.fn_personas_turno(date, integer) from public, anon;
revoke execute on function public.fn_a_quien_le_toca(date, integer, text[]) from public, anon;
grant execute on function public.fn_personas_turno(date, integer) to authenticated;
grant execute on function public.fn_a_quien_le_toca(date, integer, text[]) to authenticated;

do $$
begin
  if to_regprocedure('public.fn_personas_turno(date,integer)') is null
     or to_regprocedure('public.fn_a_quien_le_toca(date,integer,text[])') is null
     or not has_function_privilege('authenticated', 'public.fn_personas_turno(date,integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.fn_personas_turno(date,integer)', 'EXECUTE') then
    raise exception '292: faltan las lecturas o quedaron mal los permisos.';
  end if;
end $$;

notify pgrst, 'reload schema';
