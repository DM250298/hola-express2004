-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  299 · Tareas v2: avisos de urgentes y de inicio (Etapa 7, 1/2)     ║
-- ║                                                                     ║
-- ║  · Temas nuevos por dispositivo: 'mis_tareas' (tareas urgentes) e   ║
-- ║    'inicio_tareas' (cuando empieza cada tarea, opcional).           ║
-- ║  · notificaciones_push: cola de avisos al celular, uno por (tipo,   ║
-- ║    tarea, persona). Solo la escribe el sistema; la manda la app.    ║
-- ║  · fn_notificaciones_generar(): solo el sistema, cada minuto (300). ║
-- ║     - Urgente: tarea puntual de prioridad alta, abierta, del turno  ║
-- ║       en curso (no las de la rutina, ni privadas). A cada dueño     ║
-- ║       con usuario; si se reasigna, también al nuevo.                ║
-- ║     - Inicio: tarea con horario, pendiente, que empezó hace menos   ║
-- ║       de 10 minutos (no recordatorios, bloques ni privadas).        ║
-- ║                                                                     ║
-- ║  Requiere la 297. Se puede correr de nuevo. Termina en "notify".    ║
-- ╚════════════════════════════════════════════════════════════════════╝

set local lock_timeout = '5s';

do $$
begin
  if to_regclass('public.tareas_avisos_push') is null then
    raise exception '299: falta la 297.';
  end if;
end $$;

alter table public.push_subscriptions drop constraint if exists push_subscriptions_temas_chk;
alter table public.push_subscriptions add constraint push_subscriptions_temas_chk
  check (temas <@ array['produccion', 'tareas', 'mis_tareas', 'inicio_tareas']::text[]);

create table if not exists public.notificaciones_push (
  id             bigint generated always as identity primary key,
  created_at     timestamptz not null default now(),
  tipo           text not null check (tipo in ('tarea_urgente', 'tarea_inicio')),
  tema           text not null check (tema in ('mis_tareas', 'inicio_tareas')),
  usuario_id     uuid not null,
  tarea_turno_id uuid not null,
  titulo         text not null,
  cuerpo         text not null,
  url            text not null default '/movil/tareas',
  enviado_at     timestamptz,
  enviados       integer,
  fallidos       integer,
  unique (tipo, tarea_turno_id, usuario_id)
);
create index if not exists notificaciones_push_pendientes_idx
  on public.notificaciones_push (created_at) where enviado_at is null;

alter table public.notificaciones_push enable row level security;
revoke all on public.notificaciones_push from public, anon, authenticated;

create or replace function public.fn_notificaciones_generar()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_urg integer;
  v_ini integer;
begin
  if auth.uid() is not null then
    raise exception 'Las notificaciones las genera solo el sistema.';
  end if;

  -- Tareas abiertas del turno en curso, una fila por dueño con usuario.
  drop table if exists pg_temp._notif_abiertas;
  create temp table _notif_abiertas on commit drop as
    select t.id, t.titulo, t.origen, t.prioridad, t.estado, t.hora, t.created_at,
           t.inicio_at, t.fin_at, t.limite_at, e.usuario_id
    from public.tareas_turno t
    cross join lateral unnest(case when t.empleado_id is not null then array[t.empleado_id]
              else coalesce((select array_agg(p.empleado_id) from public.tareas_turno_participantes p
                              where p.tarea_id = t.id), '{}') end) d(emp)
    join public.empleados e on e.id = d.emp and e.activo and e.usuario_id is not null
    where t.estado in ('pendiente', 'en_curso') and not t.privada and t.tipo_actividad = 'puntual'
      and t.fecha between public.fn_tareas_hoy() - 1 and public.fn_tareas_hoy()
      and public.fn_tarea_fin_turno(t.fecha, t.turno_id) > now();

  insert into public.notificaciones_push (tipo, tema, usuario_id, tarea_turno_id, titulo, cuerpo)
  select 'tarea_urgente', 'mis_tareas', a.usuario_id, a.id, 'Tarea urgente',
         a.titulo || ' (hasta ' || to_char(a.limite_at at time zone 'America/Argentina/La_Rioja', 'HH24:MI') || ')'
  from _notif_abiertas a
  where a.origen = 'puntual' and a.prioridad = 'alta' and a.created_at > now() - interval '12 hours'
  on conflict (tipo, tarea_turno_id, usuario_id) do nothing;
  get diagnostics v_urg = row_count;

  insert into public.notificaciones_push (tipo, tema, usuario_id, tarea_turno_id, titulo, cuerpo)
  select 'tarea_inicio', 'inicio_tareas', a.usuario_id, a.id, 'Ahora: ' || a.titulo,
         to_char(a.inicio_at at time zone 'America/Argentina/La_Rioja', 'HH24:MI') || ' a '
           || to_char(a.fin_at at time zone 'America/Argentina/La_Rioja', 'HH24:MI')
  from _notif_abiertas a
  where a.estado = 'pendiente' and a.hora is not null
    and a.inicio_at <= now() and a.inicio_at > now() - interval '10 minutes'
  on conflict (tipo, tarea_turno_id, usuario_id) do nothing;
  get diagnostics v_ini = row_count;

  return v_urg + v_ini;
end;
$$;
revoke execute on function public.fn_notificaciones_generar() from public, anon, authenticated, service_role;

do $$
begin
  if has_table_privilege('authenticated', 'public.notificaciones_push', 'SELECT')
     or has_table_privilege('anon', 'public.notificaciones_push', 'INSERT') then
    raise exception '299: la app puede leer o escribir la cola.';
  end if;
  if has_function_privilege('authenticated', 'public.fn_notificaciones_generar()', 'EXECUTE') then
    raise exception '299: fn_notificaciones_generar quedó ejecutable desde la app.';
  end if;
end $$;

notify pgrst, 'reload schema';
