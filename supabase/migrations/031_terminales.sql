-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 031 · FASE 6 — Terminales de cobro (Mercado Pago Point)  ║
-- ║                                                                     ║
-- ║  Registro de las terminales del local. Cada terminal se vincula a   ║
-- ║  un dispositivo de Mercado Pago Point (device_id) y a la cuenta de  ║
-- ║  tesorería donde cae el dinero de las ventas con tarjeta.           ║
-- ║                                                                     ║
-- ║  La integración en vivo (mandar el cobro al dispositivo) la maneja  ║
-- ║  el servidor con el Access Token de Mercado Pago.                   ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

create table if not exists public.terminales (
  id serial primary key,
  nombre text not null,
  proveedor text not null default 'mercadopago_point',
  device_id text,
  cuenta_id integer references public.cuentas(id),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.terminales enable row level security;

do $$ begin
  create policy "todo" on public.terminales
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

-- Permiso 'terminales' para el rol admin
do $$ begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'roles'
  ) then
    update public.roles
    set permisos = array_append(permisos, 'terminales'),
        updated_at = now()
    where codigo = 'admin'
      and not ('terminales' = any(permisos));
  end if;
end $$;

notify pgrst, 'reload schema';
