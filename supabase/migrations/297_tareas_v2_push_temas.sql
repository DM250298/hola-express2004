-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  297 · Tareas v2: avisos de atraso al celular (Etapa 6 B, 1/2)      ║
-- ║                                                                     ║
-- ║  · push_subscriptions.temas: qué avisos recibe cada dispositivo     ║
-- ║    ('produccion', 'tareas'). Las suscripciones que ya existen       ║
-- ║    quedan con 'produccion' (lo único que había hasta hoy).          ║
-- ║  · tareas_avisos_push: qué avisos de atraso ya se mandaron al       ║
-- ║    celular (uno por aviso). Solo la escribe el servidor             ║
-- ║    (service_role); la app no la lee ni la toca.                     ║
-- ║                                                                     ║
-- ║  Requiere la 293. Se puede correr de nuevo.                         ║
-- ║  Última línea del archivo: "notify pgrst, 'reload schema';"         ║
-- ╚════════════════════════════════════════════════════════════════════╝

set local lock_timeout = '5s';

do $$
begin
  if to_regclass('public.tareas_avisos') is null or to_regclass('public.push_subscriptions') is null then
    raise exception '297: faltan la 293 o la 094.';
  end if;
end $$;

alter table public.push_subscriptions
  add column if not exists temas text[] not null default '{produccion}';

do $$ begin
  alter table public.push_subscriptions
    add constraint push_subscriptions_temas_chk
    check (temas <@ array['produccion', 'tareas']::text[]);
exception when duplicate_object then null; end $$;

create index if not exists idx_push_subs_temas on public.push_subscriptions using gin (temas);

create table if not exists public.tareas_avisos_push (
  aviso_id   bigint primary key,
  enviado_at timestamptz not null default now(),
  enviados   integer not null default 0,
  fallidos   integer not null default 0
);

alter table public.tareas_avisos_push enable row level security;
revoke all on public.tareas_avisos_push from public, anon, authenticated;
grant select, insert on public.tareas_avisos_push to service_role;

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'push_subscriptions' and column_name = 'temas') then
    raise exception '297: falta la columna temas.';
  end if;
  if has_table_privilege('authenticated', 'public.tareas_avisos_push', 'SELECT')
     or has_table_privilege('anon', 'public.tareas_avisos_push', 'SELECT') then
    raise exception '297: la app puede leer tareas_avisos_push.';
  end if;
end $$;

notify pgrst, 'reload schema';
