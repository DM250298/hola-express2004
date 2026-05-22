-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 013: costo de compra e impuestos en productos            ║
-- ║                                                                     ║
-- ║  Agrega al producto el IVA por defecto de compra y venta, el        ║
-- ║  margen de ganancia y los costos adicionales (flete, etc.).         ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez en el SQL Editor de Supabase.                ║
-- ╚════════════════════════════════════════════════════════════════════╝

alter table public.productos
  add column if not exists iva_compra numeric(6,2) not null default 21;

alter table public.productos
  add column if not exists iva_venta numeric(6,2) not null default 21;

alter table public.productos
  add column if not exists margen numeric(8,2) not null default 0;

alter table public.productos
  add column if not exists costos_adicionales jsonb not null default '[]'::jsonb;

notify pgrst, 'reload schema';
