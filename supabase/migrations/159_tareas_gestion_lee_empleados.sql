-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 159 · tareas_gestion puede LEER empleados y turnos        ║
-- ║                                                                     ║
-- ║  Bug post-158: un rol con 'tareas_gestion' pero sin 'rrhh' entra a   ║
-- ║  /rrhh/tareas pero en el selector "Asignada a" solo se ve a sí       ║
-- ║  mismo, y el selector de turno queda vacío. Causa: RLS de            ║
-- ║  `empleados` (085: rrhh OR legajo propio) y `turnos_plantilla`       ║
-- ║  (087: fn__rls_gate for all con rrhh).                               ║
-- ║                                                                     ║
-- ║  Fix: la LECTURA de ambas tablas acepta también 'tareas_gestion'.    ║
-- ║  La escritura (alta/edición de legajos y turnos) sigue siendo solo   ║
-- ║  de 'rrhh'. Sin montos: el sueldo vive en empleado_sueldo (no se     ║
-- ║  toca). Policies nuevas con patrón InitPlan (select fn_...).         ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─── 1. empleados: lectura con rrhh O tareas_gestion (o legajo propio) ───
drop policy if exists "empleados_select" on public.empleados;
create policy "empleados_select" on public.empleados for select to authenticated
  using (
    (select public.fn_tiene_permiso('rrhh'))
    or (select public.fn_tiene_permiso('tareas_gestion'))
    or usuario_id = auth.uid()
  );

-- ─── 2. turnos_plantilla: lectura ampliada, escritura sigue rrhh ─────────
-- La 087 la gateó con fn__rls_gate (una sola policy "for all" con rrhh).
-- Se dropean TODAS las policies y se recrean separando select de write
-- (dejar la vieja "for all" duplicaría el OR permissive y ensuciaría).
do $$ declare v_pol text; begin
  for v_pol in select policyname from pg_policies
    where schemaname = 'public' and tablename = 'turnos_plantilla'
  loop execute format('drop policy %I on public.turnos_plantilla', v_pol); end loop;
end $$;
alter table public.turnos_plantilla enable row level security;
create policy "turnos_plantilla_select" on public.turnos_plantilla
  for select to authenticated
  using (
    (select public.fn_tiene_permiso('rrhh'))
    or (select public.fn_tiene_permiso('tareas_gestion'))
  );
create policy "turnos_plantilla_write" on public.turnos_plantilla
  for all to authenticated
  using ((select public.fn_tiene_permiso('rrhh')))
  with check ((select public.fn_tiene_permiso('rrhh')));

notify pgrst, 'reload schema';

-- ─── Smoke tests (correr a mano después) ─────────────────────────────────
-- 1) Policies de empleados (deben ser 4: select/insert/update/delete):
--    select policyname, cmd from pg_policies
--    where schemaname='public' and tablename='empleados';
-- 2) Policies de turnos_plantilla (deben ser 2: select + write):
--    select policyname, cmd from pg_policies
--    where schemaname='public' and tablename='turnos_plantilla';
-- 3) Logueado como Sonia (o con su JWT): select count(*) from empleados;
--    → debe devolver TODOS los legajos, no 1.
