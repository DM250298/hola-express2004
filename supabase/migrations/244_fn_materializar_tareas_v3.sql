-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 244 · fn_materializar_tareas_turno v3 (respeta francos)  ║
-- ║                                                                     ║
-- ║  Base: v2 de la mig 158, íntegra. Cambios:                          ║
-- ║   · Un asignado con franco o licencia ese día en horarios_asignados ║
-- ║     NO recibe la instancia individual ni entra como participante de ║
-- ║     la grupal.                                                      ║
-- ║   · Si ese franco lo generó un patrón (horarios.patron_id) con      ║
-- ║     pivote, y el pivote tiene horario planificado ese día, la       ║
-- ║     tarea pasa al pivote (individual: instancia a su nombre con     ║
-- ║     nota "Cubre a X"; grupal: entra como participante). Así el      ║
-- ║     comodín hereda el checklist del puesto que cubre (Manual §4.5). ║
-- ║   · Francos cargados a mano (sin patrón) solo excluyen.             ║
-- ║  Misma firma → create or replace, sin sobrecargas.                  ║
-- ║  REQUIERE: migs 158 y 236. Primero PRUEBA, después PRODUCCIÓN.      ║
-- ╚════════════════════════════════════════════════════════════════════╝

create or replace function public.fn_materializar_tareas_turno(p_fecha date)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_n integer := 0;
  v_m integer;
  v_dow integer := extract(dow from p_fecha)::integer;
  v_dia integer := extract(day from p_fecha)::integer;
  v_fin_mes date := (date_trunc('month', p_fecha) + interval '1 month - 1 day')::date;
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

  -- Quién descansa hoy y quién lo cubre (null si nadie).
  create temp table if not exists tmp_cobertura_hoy (
    empleado_id integer primary key, cubre_id integer, nombre text
  ) on commit drop;
  truncate tmp_cobertura_hoy;
  insert into tmp_cobertura_hoy (empleado_id, cubre_id, nombre)
  select h.empleado_id,
         (select p.pivote_empleado_id
            from public.patrones_cronograma p
            join public.horarios_asignados hp
              on hp.empleado_id = p.pivote_empleado_id and hp.fecha = p_fecha
             and hp.estado = 'planificado'
           where p.id = h.patron_id and p.pivote_empleado_id <> h.empleado_id),
         e.nombre || coalesce(' ' || e.apellido, '')
  from public.horarios_asignados h
  join public.empleados e on e.id = h.empleado_id
  where h.fecha = p_fecha and h.estado in ('franco', 'licencia');

  -- 6.a Individuales: una instancia por (plantilla del día × asignado activo),
  -- redirigida al pivote cuando el asignado descansa y alguien lo cubre.
  with plantillas_hoy as (
    select r.*
    from public.tareas_recurrentes r
    where r.activa
      and (r.vigencia_desde is null or p_fecha >= r.vigencia_desde)
      and (r.vigencia_hasta is null or p_fecha <= r.vigencia_hasta)
      and (
        (r.tipo_recurrencia = 'dias_semana' and v_dow = any(r.dias_semana))
        or (r.tipo_recurrencia = 'dia_mes' and r.dia_mes is not null and (
              v_dia = r.dia_mes or (p_fecha = v_fin_mes and r.dia_mes > v_dia)))
        or (r.tipo_recurrencia = 'cada_n_dias' and r.cada_n_dias is not null and (
              p_fecha >= coalesce(r.fecha_base, (timezone('America/Argentina/Buenos_Aires', r.created_at))::date)
              and (p_fecha - coalesce(r.fecha_base, (timezone('America/Argentina/Buenos_Aires', r.created_at))::date))
                  % r.cada_n_dias = 0))
      )
  ),
  asignados_base as (
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
  asignados as (
    -- descansa y nadie cubre → se omite; descansa y cubre el pivote → pivote
    select distinct a.plantilla_id,
           coalesce(c.cubre_id, a.empleado_id) as empleado_id,
           case when c.cubre_id is not null then 'Cubre a ' || c.nombre end as notas
    from asignados_base a
    left join tmp_cobertura_hoy c on c.empleado_id = a.empleado_id
    where c.empleado_id is null or c.cubre_id is not null
  )
  insert into public.tareas_turno (
    plantilla_id, titulo, descripcion, empleado_id, turno_id, fecha,
    prioridad, requiere_evidencia, estado, modo, usuario_id, notas
  )
  select p.id, p.titulo, p.descripcion, a.empleado_id, p.turno_id, p_fecha,
         p.prioridad, p.requiere_evidencia, 'pendiente', 'individual', p.usuario_id, a.notas
  from plantillas_hoy p
  join asignados a on a.plantilla_id = p.id
  where p.modo = 'individual'
  on conflict (plantilla_id, fecha, empleado_id)
    where plantilla_id is not null and empleado_id is not null do nothing;
  get diagnostics v_m = row_count;
  v_n := v_n + v_m;

  -- 6.b Grupales: UNA instancia por plantilla del día (empleado_id NULL).
  with plantillas_hoy as (
    select r.*
    from public.tareas_recurrentes r
    where r.activa
      and (r.vigencia_desde is null or p_fecha >= r.vigencia_desde)
      and (r.vigencia_hasta is null or p_fecha <= r.vigencia_hasta)
      and (
        (r.tipo_recurrencia = 'dias_semana' and v_dow = any(r.dias_semana))
        or (r.tipo_recurrencia = 'dia_mes' and r.dia_mes is not null and (
              v_dia = r.dia_mes or (p_fecha = v_fin_mes and r.dia_mes > v_dia)))
        or (r.tipo_recurrencia = 'cada_n_dias' and r.cada_n_dias is not null and (
              p_fecha >= coalesce(r.fecha_base, (timezone('America/Argentina/Buenos_Aires', r.created_at))::date)
              and (p_fecha - coalesce(r.fecha_base, (timezone('America/Argentina/Buenos_Aires', r.created_at))::date))
                  % r.cada_n_dias = 0))
      )
  )
  insert into public.tareas_turno (
    plantilla_id, titulo, descripcion, empleado_id, turno_id, fecha,
    prioridad, requiere_evidencia, estado, modo, usuario_id
  )
  select p.id, p.titulo, p.descripcion, null, p.turno_id, p_fecha,
         p.prioridad, p.requiere_evidencia, 'pendiente', 'grupal', p.usuario_id
  from plantillas_hoy p
  where p.modo = 'grupal'
  on conflict (plantilla_id, fecha)
    where plantilla_id is not null and empleado_id is null do nothing;
  get diagnostics v_m = row_count;
  v_n := v_n + v_m;

  -- 6.c Participantes de las grupales del día: sin los que descansan, con el
  -- pivote que los cubre.
  with plantillas_hoy as (
    select r.*
    from public.tareas_recurrentes r
    where r.activa and r.modo = 'grupal'
      and (r.vigencia_desde is null or p_fecha >= r.vigencia_desde)
      and (r.vigencia_hasta is null or p_fecha <= r.vigencia_hasta)
  ),
  asignados_base as (
    select p.id as plantilla_id, e.id as empleado_id
    from plantillas_hoy p cross join public.empleados e
    where p.alcance = 'todos' and e.activo
    union
    select p.id, a.empleado_id
    from plantillas_hoy p
    join public.tareas_recurrentes_asignados a on a.plantilla_id = p.id
    join public.empleados e on e.id = a.empleado_id and e.activo
    where p.alcance = 'empleados'
  ),
  asignados as (
    select distinct a.plantilla_id, coalesce(c.cubre_id, a.empleado_id) as empleado_id
    from asignados_base a
    left join tmp_cobertura_hoy c on c.empleado_id = a.empleado_id
    where c.empleado_id is null or c.cubre_id is not null
  )
  insert into public.tareas_turno_participantes (tarea_id, empleado_id)
  select t.id, a.empleado_id
  from asignados a
  join public.tareas_turno t
    on t.plantilla_id = a.plantilla_id and t.fecha = p_fecha and t.empleado_id is null
  on conflict do nothing;

  return v_n;
end $$;
grant execute on function public.fn_materializar_tareas_turno(date) to authenticated, service_role;

notify pgrst, 'reload schema';

-- Chequeo T1 (debe dar 0 filas):
-- select proname, count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
-- where n.nspname='public' and proname like 'fn_%' group by proname having count(*)>1;
