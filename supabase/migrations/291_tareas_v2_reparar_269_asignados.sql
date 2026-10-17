-- 291 · Tareas v2: reparar la 269 (2 de 3) — a quién le toca cada tarea
-- Repara la 269, que en las dos bases quedó sin aplicar entera (el editor
-- recortó el pegado). Es la misma definición, partida en 3 archivos cortos
-- (290, 291, 292). Se puede correr de nuevo.
-- fn_asignados_tareas_dia(fecha): misma regla de siempre, con "trabaja" =
-- planificado o cubierto. Deja de poder llamarse desde la app.

-- Igual a la vigente (249), con "trabaja" = planificado o cubierto.
create or replace function public.fn_asignados_tareas_dia(p_fecha date)
returns table(plantilla_id uuid, empleado_id integer, notas text)
language sql stable security definer set search_path = public as $$
  with plantillas_hoy as (
    select * from public.fn_plantillas_tareas_dia(p_fecha)
  ),
  trabaja as (
    select h.empleado_id, h.turno_id, e.rol_operativo
    from public.horarios_asignados h
    join public.empleados e on e.id = h.empleado_id and e.activo
    where h.fecha = p_fecha and h.estado in ('planificado', 'cubierto')
  ),
  descansa as (
    select h.empleado_id,
           (select p.pivote_empleado_id
              from public.patrones_cronograma p
              join public.horarios_asignados hp
                on hp.empleado_id = p.pivote_empleado_id and hp.fecha = p_fecha
               and hp.estado in ('planificado', 'cubierto')
             where p.id = h.patron_id and p.pivote_empleado_id <> h.empleado_id) as cubre_id,
           e.nombre || coalesce(' ' || e.apellido, '') as nombre
    from public.horarios_asignados h
    join public.empleados e on e.id = h.empleado_id
    where h.fecha = p_fecha and h.estado in ('franco', 'licencia')
  ),
  puesto_rol as (
    select p.id as plantilla_id, p.turno_id, unnest(p.roles_puesto) as rol
    from plantillas_hoy p where p.alcance = 'puesto'
  ),
  directo as (
    select pr.plantilla_id, pr.rol, t.empleado_id
    from puesto_rol pr
    join trabaja t on t.rol_operativo = pr.rol
                  and (pr.turno_id is null or t.turno_id = pr.turno_id)
  ),
  faltante as (
    select pr.plantilla_id, pr.turno_id, pr.rol
    from puesto_rol pr
    where not exists (select 1 from directo d
                      where d.plantilla_id = pr.plantilla_id and d.rol = pr.rol)
  ),
  cubierto as (
    select distinct on (f.plantilla_id, f.rol) f.plantilla_id, f.rol, t.empleado_id
    from faltante f
    join trabaja t on (f.turno_id is null or t.turno_id = f.turno_id)
    order by f.plantilla_id, f.rol,
      case t.rol_operativo when 'pivote' then 1 when 'encargado' then 2
           when 'responsable_general' then 3 when 'cajero' then 4
           when 'fiambreria' then 5 else 6 end,
      t.empleado_id
  ),
  ausentes as (
    select f.plantilla_id, f.rol,
           string_agg(e.nombre || coalesce(' ' || e.apellido, ''), ', ' order by e.nombre) as nombres
    from faltante f
    join public.empleados e on e.activo and e.rol_operativo = f.rol
    where not exists (select 1 from trabaja t where t.empleado_id = e.id)
      and (f.turno_id is null or exists (
            select 1 from public.horarios_asignados h
            where h.empleado_id = e.id and h.turno_id = f.turno_id
              and h.estado in ('planificado', 'cubierto')
              and h.fecha between p_fecha - 14 and p_fecha + 14))
    group by f.plantilla_id, f.rol
  ),
  sin_turno as (
    select f.plantilla_id, f.rol,
      coalesce(
        (select min(a.empleado_id) from public.tareas_recurrentes_asignados a
           join public.empleados e on e.id = a.empleado_id and e.activo and e.rol_operativo = f.rol
          where a.plantilla_id = f.plantilla_id
            and not exists (select 1 from descansa d where d.empleado_id = a.empleado_id)),
        (select min(a.empleado_id) from public.tareas_recurrentes_asignados a
           join public.empleados e on e.id = a.empleado_id and e.activo
          where a.plantilla_id = f.plantilla_id
            and not exists (select 1 from descansa d where d.empleado_id = a.empleado_id)),
        (select min(e.id) from public.empleados e
          where e.activo and e.rol_operativo = f.rol
            and not exists (select 1 from descansa d where d.empleado_id = e.id)),
        (select min(e.id) from public.empleados e
          where e.activo and e.rol_operativo = 'responsable_general'
            and not exists (select 1 from descansa d where d.empleado_id = e.id))
      ) as empleado_id
    from faltante f
    where not exists (select 1 from cubierto c
                      where c.plantilla_id = f.plantilla_id and c.rol = f.rol)
  ),
  fijos_base as (
    select p.id as plantilla_id, e.id as empleado_id
    from plantillas_hoy p cross join public.empleados e
    where p.alcance = 'todos' and e.activo
    union
    select p.id, a.empleado_id
    from plantillas_hoy p
    join public.tareas_recurrentes_asignados a on a.plantilla_id = p.id
    join public.empleados e on e.id = a.empleado_id and e.activo
    where p.alcance = 'empleados'
    union
    select p.id, p.empleado_id
    from plantillas_hoy p
    join public.empleados e on e.id = p.empleado_id and e.activo
    where p.alcance = 'empleados' and p.empleado_id is not null
      and not exists (select 1 from public.tareas_recurrentes_asignados a where a.plantilla_id = p.id)
  ),
  fijos as (
    select a.plantilla_id,
           coalesce(d.cubre_id, a.empleado_id) as empleado_id,
           case when d.cubre_id is not null then 'Cubre a ' || d.nombre end as notas
    from fijos_base a
    left join descansa d on d.empleado_id = a.empleado_id
    where d.empleado_id is null or d.cubre_id is not null
  ),
  todo as (
    select d.plantilla_id, d.empleado_id, null::text as notas from directo d
    union all
    select c.plantilla_id, c.empleado_id,
           coalesce('Cubre a ' || au.nombres,
                    'Cubre puesto ' || case c.rol
                      when 'direccion' then 'dirección'
                      when 'responsable_general' then 'responsable general'
                      when 'encargado' then 'encargado de turno'
                      when 'pivote' then 'pivote'
                      when 'compras' then 'compras'
                      when 'cajero' then 'caja'
                      when 'fiambreria' then 'fiambrería'
                      else c.rol end)
    from cubierto c
    left join ausentes au on au.plantilla_id = c.plantilla_id and au.rol = c.rol
    union all
    select s.plantilla_id, s.empleado_id, 'Sin cronograma: asignación por defecto'
    from sin_turno s where s.empleado_id is not null
    union all
    select f.plantilla_id, f.empleado_id, f.notas from fijos f
  )
  select distinct on (t.plantilla_id, t.empleado_id) t.plantilla_id, t.empleado_id, t.notas
  from todo t
  order by t.plantilla_id, t.empleado_id, t.notas nulls first;
$$;


revoke execute on function public.fn_asignados_tareas_dia(date) from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_proc where proname = 'fn_asignados_tareas_dia' and prosrc like '%cubierto%')
     or has_function_privilege('authenticated', 'public.fn_asignados_tareas_dia(date)', 'EXECUTE') then
    raise exception '291: fn_asignados_tareas_dia no quedó bien.';
  end if;
end $$;

notify pgrst, 'reload schema';
