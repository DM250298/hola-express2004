-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 050 · R1.2 Parte 1 — Tabla de costos gateada (no-breaking)║
-- ║                                                                     ║
-- ║  Mueve el precio de costo a una tabla aparte, gateada por RLS, para  ║
-- ║  que un cajero no pueda leerlo ni por API. Esta primera parte es     ║
-- ║  ADITIVA y no rompe nada:                                           ║
-- ║   · crea costos_producto (gateada por permiso 'costos')             ║
-- ║   · la siembra desde productos.precio_costo                         ║
-- ║   · un trigger mantiene costos_producto en sync con la columna      ║
-- ║     vieja durante la transición                                     ║
-- ║                                                                     ║
-- ║  productos.precio_costo SIGUE existiendo (se borra en la Parte 4).  ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- 1. Permiso 'costos' a admin y encargado (el cajero NO lo tiene)
update public.roles
  set permisos = (
    select array(select distinct unnest(permisos || array['costos']))
  )
  where codigo in ('admin', 'encargado');

-- 2. Tabla de costos
create table if not exists public.costos_producto (
  producto_id  integer primary key references public.productos(id) on delete cascade,
  precio_costo numeric(12,2) not null default 0,
  updated_at   timestamptz not null default now()
);

-- 3. Sembrar desde la columna actual
insert into public.costos_producto (producto_id, precio_costo)
  select id, coalesce(precio_costo, 0) from public.productos
  on conflict (producto_id) do nothing;

-- 4. RLS: solo quien tiene permiso 'costos' (admin / encargado)
alter table public.costos_producto enable row level security;
do $$ begin
  create policy "costos_rw" on public.costos_producto
    for all to authenticated
    using (public.fn_tiene_permiso('costos'))
    with check (public.fn_tiene_permiso('costos'));
exception when duplicate_object then null; end $$;

-- 5. Trigger de sincronización (transición): cuando se escribe
--    productos.precio_costo, se refleja en costos_producto.
create or replace function public.fn_sync_costo_producto()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.costos_producto (producto_id, precio_costo, updated_at)
  values (NEW.id, coalesce(NEW.precio_costo, 0), now())
  on conflict (producto_id)
  do update set precio_costo = excluded.precio_costo, updated_at = now();
  return NEW;
end $$;

drop trigger if exists trg_sync_costo on public.productos;
create trigger trg_sync_costo
  after insert or update of precio_costo on public.productos
  for each row execute function public.fn_sync_costo_producto();

notify pgrst, 'reload schema';
