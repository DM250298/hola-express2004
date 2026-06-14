-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 094 · Suscripciones Web Push                              ║
-- ║                                                                     ║
-- ║  Guarda la PushSubscription (endpoint + claves) de cada dispositivo ║
-- ║  que activó los avisos de producción. El cron diario                ║
-- ║  (/api/cron/aviso-produccion) lee esta tabla con service role y le  ║
-- ║  manda un Web Push a cada una. El usuario gestiona SOLO las suyas.  ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

create table if not exists public.push_subscriptions (
  id          bigserial primary key,
  usuario_id  uuid not null references public.usuarios(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_push_subs_usuario
  on public.push_subscriptions(usuario_id);

-- RLS: cada usuario gestiona únicamente sus propias suscripciones.
-- El cron usa service role (bypassa RLS) para leer todas y enviar.
alter table public.push_subscriptions enable row level security;

drop policy if exists "push_own" on public.push_subscriptions;
create policy "push_own" on public.push_subscriptions
  for all to authenticated
  using (usuario_id = auth.uid())
  with check (usuario_id = auth.uid());

notify pgrst, 'reload schema';
