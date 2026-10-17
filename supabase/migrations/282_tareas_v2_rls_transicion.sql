-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  282 · Tareas v2: reglas de acceso nuevas (transición)              ║
-- ║  (Etapa 1 · bloque G)                                                ║
-- ║                                                                     ║
-- ║  Las privadas solo las ven y tocan los administradores               ║
-- ║  (tareas_admin), también frente a quien tiene rrhh. El resto queda   ║
-- ║  como hoy, para que la app actual siga andando:                      ║
-- ║   · agenda (tareas_turno y participantes): leen gestión, rrhh, el    ║
-- ║     dueño y los participantes; escribe la encargada directo (se      ║
-- ║     cierra en la 285, cuando la app nueva escriba solo por función). ║
-- ║   · rutina (tareas_recurrentes y asignados): gestión.                ║
-- ║  Se borran TODAS las reglas anteriores de esas 4 tablas antes de     ║
-- ║  crear las nuevas (si quedara una vieja abierta, dejaría pasar).     ║
-- ║                                                                     ║
-- ║  Requiere la 281. Se puede correr de nuevo.                          ║
-- ║  Última línea del archivo: "notify pgrst, 'reload schema';"          ║
-- ╚════════════════════════════════════════════════════════════════════╝

set local lock_timeout = '5s';

-- Ids de las tareas privadas (sin pasar por la RLS de tareas_turno).
create or replace function public.fn_tareas_privadas_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select t.id from public.tareas_turno t where t.privada
$$;
create or replace function public.fn_rutina_privadas_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select r.id from public.tareas_recurrentes r where r.privada
$$;
revoke execute on function public.fn_tareas_privadas_ids() from public, anon;
revoke execute on function public.fn_rutina_privadas_ids() from public, anon;
grant execute on function public.fn_tareas_privadas_ids() to authenticated;
grant execute on function public.fn_rutina_privadas_ids() to authenticated;

do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies
            where schemaname = 'public'
              and tablename in ('tareas_turno', 'tareas_turno_participantes',
                                'tareas_recurrentes', 'tareas_recurrentes_asignados') loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

alter table public.tareas_turno enable row level security;
alter table public.tareas_turno_participantes enable row level security;
alter table public.tareas_recurrentes enable row level security;
alter table public.tareas_recurrentes_asignados enable row level security;

-- ─── Agenda ─────────────────────────────────────────────────────────────
create policy tareas_turno_select on public.tareas_turno for select to authenticated using (
  (select public.fn_tiene_permiso('tareas_admin'))
  or (not privada and (
        (select public.fn_tiene_permiso('tareas_gestion'))
     or (select public.fn_tiene_permiso('rrhh'))
     or empleado_id = (select public.fn_mi_empleado_id())
     or id in (select public.fn_mis_tareas_participadas()))));
create policy tareas_turno_insert on public.tareas_turno for insert to authenticated with check (
  (select public.fn_tiene_permiso('tareas_admin'))
  or (not privada and (select public.fn_tiene_permiso('tareas_gestion'))));
create policy tareas_turno_update on public.tareas_turno for update to authenticated
  using ((select public.fn_tiene_permiso('tareas_admin'))
         or (not privada and (select public.fn_tiene_permiso('tareas_gestion'))))
  with check ((select public.fn_tiene_permiso('tareas_admin'))
              or (not privada and (select public.fn_tiene_permiso('tareas_gestion'))));
create policy tareas_turno_delete on public.tareas_turno for delete to authenticated using (
  (select public.fn_tiene_permiso('tareas_admin'))
  or (not privada and (select public.fn_tiene_permiso('tareas_gestion'))));

create policy tareas_turno_part_select on public.tareas_turno_participantes for select to authenticated using (
  (select public.fn_tiene_permiso('tareas_admin'))
  or (tarea_id not in (select public.fn_tareas_privadas_ids()) and (
        (select public.fn_tiene_permiso('tareas_gestion'))
     or (select public.fn_tiene_permiso('rrhh'))
     or empleado_id = (select public.fn_mi_empleado_id())
     or tarea_id in (select public.fn_mis_tareas_participadas()))));
create policy tareas_turno_part_write on public.tareas_turno_participantes for all to authenticated
  using ((select public.fn_tiene_permiso('tareas_admin'))
         or (tarea_id not in (select public.fn_tareas_privadas_ids())
             and (select public.fn_tiene_permiso('tareas_gestion'))))
  with check ((select public.fn_tiene_permiso('tareas_admin'))
              or (tarea_id not in (select public.fn_tareas_privadas_ids())
                  and (select public.fn_tiene_permiso('tareas_gestion'))));

-- ─── Rutina ─────────────────────────────────────────────────────────────
create policy tareas_rec_select on public.tareas_recurrentes for select to authenticated using (
  (select public.fn_tiene_permiso('tareas_admin'))
  or (not privada and (select public.fn_tiene_permiso('tareas_gestion'))));
create policy tareas_rec_write on public.tareas_recurrentes for all to authenticated
  using ((select public.fn_tiene_permiso('tareas_admin'))
         or (not privada and (select public.fn_tiene_permiso('tareas_gestion'))))
  with check ((select public.fn_tiene_permiso('tareas_admin'))
              or (not privada and (select public.fn_tiene_permiso('tareas_gestion'))));

create policy tareas_rec_asig_rw on public.tareas_recurrentes_asignados for all to authenticated
  using ((select public.fn_tiene_permiso('tareas_admin'))
         or (plantilla_id not in (select public.fn_rutina_privadas_ids())
             and (select public.fn_tiene_permiso('tareas_gestion'))))
  with check ((select public.fn_tiene_permiso('tareas_admin'))
              or (plantilla_id not in (select public.fn_rutina_privadas_ids())
                  and (select public.fn_tiene_permiso('tareas_gestion'))));

do $$
begin
  if (select count(*) from pg_policies where schemaname = 'public'
        and tablename in ('tareas_turno', 'tareas_turno_participantes',
                          'tareas_recurrentes', 'tareas_recurrentes_asignados')) <> 9 then
    raise exception '282: las reglas no quedaron como se esperaba (tienen que ser 9).';
  end if;
  if to_regprocedure('public.fn_mi_empleado_id()') is null
     or to_regprocedure('public.fn_mis_tareas_participadas()') is null then
    raise exception '282: faltan fn_mi_empleado_id o fn_mis_tareas_participadas.';
  end if;
end $$;

notify pgrst, 'reload schema';
