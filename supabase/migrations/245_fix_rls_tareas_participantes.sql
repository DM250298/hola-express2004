-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 245 · Fix RLS recursiva en tareas_turno_participantes    ║
-- ║                                                                     ║
-- ║  La policy de select de tareas_turno_participantes (mig 158) se     ║
-- ║  consultaba a sí misma ("tarea_id in (select ... from              ║
-- ║  tareas_turno_participantes ...)") y la de tareas_turno embebía esa ║
-- ║  tabla. En cuanto existe una tarea grupal, Postgres corta con       ║
-- ║  42P17 "infinite recursion detected in policy" y el tablero del     ║
-- ║  día, Mis tareas y el badge móvil devuelven 500.                    ║
-- ║                                                                     ║
-- ║  Arreglo: helper security definer fn_mis_tareas_participadas() que  ║
-- ║  lee la tabla puente SIN pasar por RLS, y las dos policies lo usan. ║
-- ║  El alcance queda igual: gestión y rrhh ven todo; el empleado ve    ║
-- ║  sus individuales y las grupales donde participa.                   ║
-- ║  REQUIERE: mig 158. Primero PRUEBA, después PRODUCCIÓN.             ║
-- ╚════════════════════════════════════════════════════════════════════╝

create or replace function public.fn_mis_tareas_participadas()
returns setof uuid
language sql stable security definer set search_path = public
as $$
  select p.tarea_id
  from public.tareas_turno_participantes p
  join public.empleados e on e.id = p.empleado_id
  where e.usuario_id = auth.uid();
$$;

revoke execute on function public.fn_mis_tareas_participadas() from public, anon;
grant execute on function public.fn_mis_tareas_participadas() to authenticated;

drop policy if exists "tareas_turno_select" on public.tareas_turno;
create policy "tareas_turno_select" on public.tareas_turno for select to authenticated
  using (
    (select public.fn_tiene_permiso('tareas_gestion'))
    or (select public.fn_tiene_permiso('rrhh'))
    or empleado_id = (select public.fn_mi_empleado_id())
    or id in (select public.fn_mis_tareas_participadas())
  );

drop policy if exists "tareas_turno_part_select" on public.tareas_turno_participantes;
create policy "tareas_turno_part_select" on public.tareas_turno_participantes
  for select to authenticated
  using (
    (select public.fn_tiene_permiso('tareas_gestion'))
    or (select public.fn_tiene_permiso('rrhh'))
    or empleado_id = (select public.fn_mi_empleado_id())
    or tarea_id in (select public.fn_mis_tareas_participadas())
  );

notify pgrst, 'reload schema';

-- Verificación (como cualquier usuario logueado; antes daba 42P17):
--   select t.id, t.titulo, p.empleado_id
--   from public.tareas_turno t
--   left join public.tareas_turno_participantes p on p.tarea_id = t.id
--   where t.fecha = current_date limit 5;
