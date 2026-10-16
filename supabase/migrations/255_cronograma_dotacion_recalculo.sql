-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 255 · Cronograma: dotación requerida + recálculo de      ║
-- ║  asistencia al editar el plan                                       ║
-- ║                                                                     ║
-- ║  1. `dotacion_requerida`: mínimo de personas por turno y día de la  ║
-- ║     semana (null = todos los días). La pestaña Cronograma compara   ║
-- ║     la gente planificada contra este mínimo. Sin filas → la UI dice ║
-- ║     "Dotación requerida sin configurar" (no inventa mínimos).       ║
-- ║  2. `fn_recalcular_asistencia_empleado(emp, fecha)`: wrapper gateado ║
-- ║     por `rrhh` sobre fn_recalcular_asistencia (revocada al público  ║
-- ║     en la 088). Lo llama el editor de celda cuando se cambia el     ║
-- ║     plan de un día ya cerrado: hoy, pasar a franco un día marcado   ║
-- ║     "ausente" deja la fila vieja hasta el próximo fichaje. Recalcula ║
-- ║     D y D+1 (la cola de la noche de D recorta la ventana de D+1).   ║
-- ║  REQUIERE: migs 087, 088. Primero PRUEBA, después PRODUCCIÓN.       ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─── 1. Dotación requerida ───────────────────────────────────────────
create table if not exists public.dotacion_requerida (
  id          serial primary key,
  turno_id    integer not null references public.turnos_plantilla(id) on delete cascade,
  -- 0 = domingo … 6 = sábado (mismo criterio que extract(dow)); null = todos los días.
  dia_semana  smallint check (dia_semana between 0 and 6),
  minimo      integer not null check (minimo >= 0),
  updated_at  timestamptz not null default now()
);
comment on table public.dotacion_requerida is
  'Mínimo de personas planificadas por turno (y opcionalmente por día de la semana). Lo lee Personal › Cronograma.';

-- Un UNIQUE común trata cada NULL como distinto: el "todos los días" se duplicaría.
create unique index if not exists dotacion_requerida_turno_dia_uq
  on public.dotacion_requerida (turno_id, coalesce(dia_semana, -1));

alter table public.dotacion_requerida enable row level security;
drop policy if exists "dotacion_select" on public.dotacion_requerida;
drop policy if exists "dotacion_write"  on public.dotacion_requerida;
create policy "dotacion_select" on public.dotacion_requerida
  for select to authenticated
  using (
    (select public.fn_tiene_permiso('rrhh'))
    or (select public.fn_tiene_permiso('tareas_gestion'))
  );
create policy "dotacion_write" on public.dotacion_requerida
  for all to authenticated
  using ((select public.fn_tiene_permiso('rrhh')))
  with check ((select public.fn_tiene_permiso('rrhh')));

-- ─── 2. Recálculo de asistencia de un empleado (editor de celda) ─────
create or replace function public.fn_recalcular_asistencia_empleado(
  p_empleado_id integer,
  p_fecha date
) returns void
language plpgsql security definer set search_path = public as $$
begin
  -- Mismo guard que fn_cerrar_dia_asistencia: service_role pasa, un
  -- autenticado necesita 'rrhh' (fn_recalcular está revocada al público).
  if auth.uid() is not null and not public.fn_tiene_permiso('rrhh') then
    raise exception 'Sin permiso.';
  end if;
  if p_empleado_id is null or p_fecha is null then
    raise exception 'Empleado y fecha son obligatorios.';
  end if;
  perform public.fn_recalcular_asistencia(p_empleado_id, p_fecha);
  -- D+1 depende de D: si D era (o deja de ser) noche, la ventana de D+1 cambia.
  perform public.fn_recalcular_asistencia(p_empleado_id, p_fecha + 1);
end $$;

revoke execute on function public.fn_recalcular_asistencia_empleado(integer, date) from public, anon;
grant execute on function public.fn_recalcular_asistencia_empleado(integer, date) to authenticated, service_role;

notify pgrst, 'reload schema';

-- Chequeo T1 (debe dar 0 filas):
-- select proname, count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public' and proname like 'fn_%' group by proname having count(*) > 1;
