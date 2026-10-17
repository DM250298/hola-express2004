-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  293 · Tareas v2: avisos de atraso (Etapa 5, 1/4)                   ║
-- ║                                                                     ║
-- ║  Tabla tareas_avisos: un aviso por tarea atrasada, a quién se le    ║
-- ║  avisó y cuándo se resolvió. La llena solo el control de atrasos    ║
-- ║  (la 294); nadie la escribe desde la app. La lee cada destinatario  ║
-- ║  (lo suyo) y los administradores (todo). Va a Realtime para que el  ║
-- ║  aviso aparezca al instante en pantalla.                            ║
-- ║                                                                     ║
-- ║  Un aviso no se borra: solo se marca resuelto una vez (cuando la    ║
-- ║  tarea se hace, no se pudo, se cancela o quedó sin hacer).          ║
-- ║                                                                     ║
-- ║  Requiere la 292. Se puede correr de nuevo.                         ║
-- ║  Última línea del archivo: "notify pgrst, 'reload schema';"         ║
-- ╚════════════════════════════════════════════════════════════════════╝

set local lock_timeout = '5s';

do $$
begin
  if to_regprocedure('public.fn_tarea_evento(public.tarea_evento_tipo,uuid,uuid,jsonb,jsonb,text,text,bigint,integer)') is null
     or to_regprocedure('public.fn_personas_turno(date,integer)') is null
     or to_regprocedure('public.fn_trg_registro_inmutable()') is null then
    raise exception '293: faltan la 266 o la 292.';
  end if;
end $$;

create table if not exists public.tareas_avisos (
  id                    bigint generated always as identity primary key,
  created_at            timestamptz not null default now(),
  tarea_turno_id        uuid not null,
  fecha                 date not null,
  turno_id              integer,
  titulo                text not null,
  privada               boolean not null default false,
  duenos                integer[] not null default '{}',
  duenos_nombres        text,
  para                  text not null check (para in ('encargada', 'admin')),
  destinatarios         uuid[] not null,
  destinatarios_nombres text,
  limite_at             timestamptz not null,
  minutos_atraso        integer not null,
  resuelto_at           timestamptz,
  resolucion            text check (resolucion in ('hecha', 'no_se_pudo', 'cancelada', 'sin_hacer', 'otra')),
  check ((resuelto_at is null) = (resolucion is null))
);

create unique index if not exists tareas_avisos_tarea_uq on public.tareas_avisos (tarea_turno_id);
create index if not exists tareas_avisos_vivos_idx on public.tareas_avisos (created_at desc) where resuelto_at is null;
create index if not exists tareas_avisos_fecha_idx on public.tareas_avisos (fecha);

alter table public.tareas_avisos enable row level security;
drop policy if exists tareas_avisos_select on public.tareas_avisos;
create policy tareas_avisos_select on public.tareas_avisos
  for select to authenticated using (
    (select public.fn_tiene_permiso('tareas_admin'))
    or (not privada and (select auth.uid()) = any(destinatarios)));

revoke insert, update, delete, truncate, references, trigger
  on public.tareas_avisos from public, anon, authenticated, service_role;
revoke select on public.tareas_avisos from public, anon;
grant select on public.tareas_avisos to authenticated;

-- Un aviso solo se resuelve una vez, y no cambia nada más.
create or replace function public.fn_trg_tareas_avisos_guarda()
returns trigger language plpgsql as $$
begin
  if tg_op <> 'UPDATE' then
    raise exception 'Los avisos no se borran.';
  end if;
  if old.resuelto_at is not null or new.resuelto_at is null
     or (new.id, new.created_at, new.tarea_turno_id, new.fecha, new.turno_id, new.titulo, new.privada,
         new.duenos, new.duenos_nombres, new.para, new.destinatarios, new.destinatarios_nombres,
         new.limite_at, new.minutos_atraso)
        is distinct from
        (old.id, old.created_at, old.tarea_turno_id, old.fecha, old.turno_id, old.titulo, old.privada,
         old.duenos, old.duenos_nombres, old.para, old.destinatarios, old.destinatarios_nombres,
         old.limite_at, old.minutos_atraso) then
    raise exception 'Un aviso solo se marca resuelto, una vez.';
  end if;
  return new;
end;
$$;
revoke execute on function public.fn_trg_tareas_avisos_guarda() from public, anon, authenticated;

drop trigger if exists trg_tareas_avisos_guarda on public.tareas_avisos;
create trigger trg_tareas_avisos_guarda
  before update or delete on public.tareas_avisos
  for each row execute function public.fn_trg_tareas_avisos_guarda();
drop trigger if exists trg_tareas_avisos_sin_truncate on public.tareas_avisos;
create trigger trg_tareas_avisos_sin_truncate
  before truncate on public.tareas_avisos
  for each statement execute function public.fn_trg_registro_inmutable();
alter table public.tareas_avisos enable always trigger trg_tareas_avisos_guarda;
alter table public.tareas_avisos enable always trigger trg_tareas_avisos_sin_truncate;

-- Realtime: el aviso llega en vivo a quien lo puede ver.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tareas_avisos') then
    alter publication supabase_realtime add table public.tareas_avisos;
  end if;
end $$;

do $$
begin
  if to_regclass('public.tareas_avisos') is null then
    raise exception '293: falta la tabla.';
  end if;
  if (select count(*) from pg_trigger where tgname in ('trg_tareas_avisos_guarda', 'trg_tareas_avisos_sin_truncate')
        and tgenabled = 'A') <> 2 then
    raise exception '293: faltan triggers o no quedaron en ENABLE ALWAYS.';
  end if;
  if has_table_privilege('authenticated', 'public.tareas_avisos', 'INSERT')
     or has_table_privilege('authenticated', 'public.tareas_avisos', 'UPDATE')
     or has_table_privilege('authenticated', 'public.tareas_avisos', 'DELETE')
     or not has_table_privilege('authenticated', 'public.tareas_avisos', 'SELECT') then
    raise exception '293: quedaron mal los permisos.';
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                  and tablename = 'tareas_avisos') then
    raise exception '293: la tabla no quedó en Realtime.';
  end if;
end $$;

notify pgrst, 'reload schema';
