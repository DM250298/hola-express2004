-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  283 · Tareas v2: Cumplimiento cuenta solo lo que corresponde       ║
-- ║  (Etapa 1 · bloque G)                                                ║
-- ║                                                                     ║
-- ║  fn_cumplimiento_tareas(desde, hasta, empleado) v3, misma firma y    ║
-- ║  mismas claves (la pantalla de hoy sigue andando), más dos nuevas:   ║
-- ║   · no cuentan: canceladas, recordatorios ("todo el turno"),         ║
-- ║     bloques, ni las privadas (salvo para un administrador);          ║
-- ║   · "no se pudo" no cuenta en contra: va aparte (no_se_pudo);        ║
-- ║   · hechas_por_otro: completadas por alguien que no era el dueño     ║
-- ║     (la encargada "en nombre de").                                   ║
-- ║  Ahora la ven la encargada y los administradores (tareas_admin).     ║
-- ║                                                                     ║
-- ║  Base: definición de producción (2026-10-16). Requiere la 282.       ║
-- ║  Se puede correr de nuevo.                                           ║
-- ║  Última línea del archivo: "notify pgrst, 'reload schema';"          ║
-- ╚════════════════════════════════════════════════════════════════════╝

create or replace function public.fn_cumplimiento_tareas(
  p_desde date, p_hasta date, p_empleado_id integer default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_result jsonb; v_admin boolean := public.fn_tiene_permiso('tareas_admin');
begin
  if not (v_admin or public.fn_tiene_permiso('tareas_gestion')) then
    raise exception 'Sin permiso para ver el cumplimiento de tareas.';
  end if;
  if p_hasta < p_desde then raise exception 'Rango de fechas inválido.'; end if;
  if p_hasta - p_desde > 366 then raise exception 'El rango no puede superar un año.'; end if;

  with base as (
    select tt.* from public.tareas_turno tt
    where tt.fecha between p_desde and p_hasta
      and tt.estado <> 'cancelada'
      and tt.tipo_actividad = 'puntual'
      and (v_admin or not tt.privada)
  )
  select jsonb_build_object(
    'por_empleado', coalesce((
      select jsonb_agg(jsonb_build_object(
               'empleado_id', y.empleado_id, 'nombre', y.nombre, 'apellido', y.apellido,
               'asignadas', y.asignadas, 'completadas', y.completadas,
               'vencidas', y.vencidas, 'pendientes', y.pendientes,
               'rechazos', y.rechazos, 'no_se_pudo', y.no_se_pudo, 'hechas_por_otro', y.por_otro,
               'pct', case when y.asignadas = 0 then null
                           else round(y.completadas::numeric / y.asignadas * 100, 1) end
             ) order by y.nombre, y.apellido)
      from (
        select e.id as empleado_id, e.nombre, e.apellido,
               count(*) filter (where x.estado <> 'no_se_pudo')::int as asignadas,
               count(*) filter (where x.estado = 'completada')::int as completadas,
               count(*) filter (where x.estado = 'vencida')::int    as vencidas,
               count(*) filter (where x.estado in ('pendiente','en_curso'))::int as pendientes,
               count(*) filter (where x.estado = 'no_se_pudo')::int as no_se_pudo,
               count(*) filter (where x.por_otro)::int as por_otro,
               coalesce(sum(x.rechazos), 0)::int as rechazos
        from (
          -- individuales del rango
          select b.empleado_id, b.estado::text as estado, b.rechazos_count as rechazos,
                 (b.estado = 'completada' and b.completada_por is distinct from b.empleado_id) as por_otro
          from base b where b.empleado_id is not null
          union all
          -- grupales completadas → 1/1 para quien la hizo
          select b.completada_por, 'completada', b.rechazos_count, false
          from base b
          where b.empleado_id is null and b.estado = 'completada' and b.completada_por is not null
        ) x
        join public.empleados e on e.id = x.empleado_id
        where p_empleado_id is null or x.empleado_id = p_empleado_id
        group by e.id, e.nombre, e.apellido
      ) y
    ), '[]'::jsonb),

    'por_tarea', coalesce((
      select jsonb_agg(jsonb_build_object(
               'plantilla_id', z.plantilla_id, 'titulo', z.titulo, 'modo', z.modo,
               'total', z.total, 'completadas', z.completadas,
               'vencidas', z.vencidas, 'pendientes', z.pendientes,
               'rechazos', z.rechazos, 'no_se_pudo', z.no_se_pudo,
               'pct', case when z.total = 0 then null
                           else round(z.completadas::numeric / z.total * 100, 1) end
             ) order by z.titulo)
      from (
        select b.plantilla_id, b.titulo, b.modo::text as modo,
               count(*) filter (where b.estado <> 'no_se_pudo')::int as total,
               count(*) filter (where b.estado = 'completada')::int as completadas,
               count(*) filter (where b.estado = 'vencida')::int    as vencidas,
               count(*) filter (where b.estado in ('pendiente','en_curso'))::int as pendientes,
               count(*) filter (where b.estado = 'no_se_pudo')::int as no_se_pudo,
               coalesce(sum(b.rechazos_count), 0)::int as rechazos
        from base b
        where p_empleado_id is null
           or b.empleado_id = p_empleado_id
           or b.completada_por = p_empleado_id
           or exists (select 1 from public.tareas_turno_participantes p
                      where p.tarea_id = b.id and p.empleado_id = p_empleado_id)
        group by b.plantilla_id, b.titulo, b.modo
      ) z
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end $$;

revoke execute on function public.fn_cumplimiento_tareas(date, date, integer) from public, anon;
grant execute on function public.fn_cumplimiento_tareas(date, date, integer) to authenticated;

do $$
begin
  if not exists (select 1 from pg_proc where proname = 'fn_cumplimiento_tareas' and prosrc like '%no_se_pudo%') then
    raise exception '283: fn_cumplimiento_tareas no quedó en la versión 3.';
  end if;
end $$;

notify pgrst, 'reload schema';
