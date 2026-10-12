-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 249 · fn_plantillas_tareas_dia + fn_asignados_tareas_dia ║
-- ║                                                                     ║
-- ║  Resolución de "quién hace cada tarea recurrente" en una fecha:     ║
-- ║   · fn_plantillas_tareas_dia(fecha): plantillas activas que caen    ║
-- ║     ese día (misma regla de recurrencia/vigencia de la mig 244).    ║
-- ║   · fn_asignados_tareas_dia(fecha): (plantilla, empleado, notas).   ║
-- ║     - alcance 'puesto' (mig 248), por cada rol de roles_puesto:     ║
-- ║         a) todos los PLANIFICADOS en el turno de la plantilla con   ║
-- ║            ese rol_operativo (notas null);                          ║
-- ║         b) si el rol no tiene a nadie en el turno: UNA persona del  ║
-- ║            turno, por prioridad pivote → encargado → resp. general  ║
-- ║            → cajero → fiambrería → resto; notas 'Cubre a <quienes   ║
-- ║            del rol no trabajan hoy>' o 'Cubre puesto <rol>';        ║
-- ║         c) si NADIE está planificado en el turno: asignado fijo de  ║
-- ║            la plantilla → activo con ese rol → resp. general, que   ║
-- ║            no descanse; notas 'Sin cronograma: asignación por        ║
-- ║            defecto'. Así la tarea nunca queda sin dueño.            ║
-- ║     - alcance 'empleados' / 'todos': regla v3 (franco/licencia se   ║
-- ║       omite; si lo cubre el pivote del patrón, va al pivote).       ║
-- ║  Las usa fn_materializar_tareas_turno v4 (mig 250).                 ║
-- ║  REQUIERE: migs 158, 229, 236, 248. Primero PRUEBA, después PROD.   ║
-- ╚════════════════════════════════════════════════════════════════════╝

create or replace function public.fn_plantillas_tareas_dia(p_fecha date)
returns setof public.tareas_recurrentes
language sql stable security definer set search_path = public as $$
  select r.*
  from public.tareas_recurrentes r
  where r.activa
    and (r.vigencia_desde is null or p_fecha >= r.vigencia_desde)
    and (r.vigencia_hasta is null or p_fecha <= r.vigencia_hasta)
    and (
      (r.tipo_recurrencia = 'dias_semana'
         and extract(dow from p_fecha)::integer = any(r.dias_semana))
      or (r.tipo_recurrencia = 'dia_mes' and r.dia_mes is not null and (
            extract(day from p_fecha)::integer = r.dia_mes
            or (p_fecha = (date_trunc('month', p_fecha) + interval '1 month - 1 day')::date
                and r.dia_mes > extract(day from p_fecha)::integer)))
      or (r.tipo_recurrencia = 'cada_n_dias' and r.cada_n_dias is not null and (
            p_fecha >= coalesce(r.fecha_base, (timezone('America/Argentina/Buenos_Aires', r.created_at))::date)
            and (p_fecha - coalesce(r.fecha_base, (timezone('America/Argentina/Buenos_Aires', r.created_at))::date))
                % r.cada_n_dias = 0))
    );
$$;
revoke execute on function public.fn_plantillas_tareas_dia(date) from public, anon;
grant execute on function public.fn_plantillas_tareas_dia(date) to authenticated, service_role;

create or replace function public.fn_asignados_tareas_dia(p_fecha date)
returns table (plantilla_id uuid, empleado_id integer, notas text)
language sql stable security definer set search_path = public as $$
  with plantillas_hoy as (
    select * from public.fn_plantillas_tareas_dia(p_fecha)
  ),
  trabaja as (
    select h.empleado_id, h.turno_id, e.rol_operativo
    from public.horarios_asignados h
    join public.empleados e on e.id = h.empleado_id and e.activo
    where h.fecha = p_fecha and h.estado = 'planificado'
  ),
  descansa as (
    select h.empleado_id,
           (select p.pivote_empleado_id
              from public.patrones_cronograma p
              join public.horarios_asignados hp
                on hp.empleado_id = p.pivote_empleado_id and hp.fecha = p_fecha
               and hp.estado = 'planificado'
             where p.id = h.patron_id and p.pivote_empleado_id <> h.empleado_id) as cubre_id,
           e.nombre || coalesce(' ' || e.apellido, '') as nombre
    from public.horarios_asignados h
    join public.empleados e on e.id = h.empleado_id
    where h.fecha = p_fecha and h.estado in ('franco', 'licencia')
  ),
  -- ── Alcance 'puesto' ──
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
      -- del rol, los que hacen ese turno (planificados en él ±14 días)
      and (f.turno_id is null or exists (
            select 1 from public.horarios_asignados h
            where h.empleado_id = e.id and h.turno_id = f.turno_id
              and h.estado = 'planificado'
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
  -- ── Alcance 'empleados' / 'todos' (regla v3, mig 244) ──
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
revoke execute on function public.fn_asignados_tareas_dia(date) from public, anon;
grant execute on function public.fn_asignados_tareas_dia(date) to authenticated, service_role;

notify pgrst, 'reload schema';

-- Verificación (quién recibe cada tarea hoy):
--   select r.titulo, e.nombre, o.notas
--   from public.fn_asignados_tareas_dia(current_date) o
--   join public.tareas_recurrentes r on r.id = o.plantilla_id
--   join public.empleados e on e.id = o.empleado_id
--   order by r.turno_id, r.titulo, e.nombre;
