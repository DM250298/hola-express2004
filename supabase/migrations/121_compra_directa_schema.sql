-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 121 · PEDIDO 2 — Base de la factura de compra directa    ║
-- ║                                                                     ║
-- ║  Relaja los acoplamientos que impedían una factura suelta/pagada al ║
-- ║  instante (sin orden de compra):                                    ║
-- ║   · cuentas_a_pagar.pedido_id → nullable (una compra directa no      ║
-- ║     tiene OC previa).                                                ║
-- ║   · items_factura_compra.producto_id → nullable + descripcion (para ║
-- ║     líneas de gasto sin producto; el Libro IVA discrimina igual).   ║
-- ║   · facturas_compra.es_directa (listable) + egreso_id (para poder    ║
-- ║     anular el pago).                                                 ║
-- ║                                                                     ║
-- ║  Correr UNA vez, COMPLETO, en el SQL Editor de Supabase.           ║
-- ╚════════════════════════════════════════════════════════════════════╝

alter table public.cuentas_a_pagar alter column pedido_id drop not null;

alter table public.items_factura_compra alter column producto_id drop not null;
alter table public.items_factura_compra add column if not exists descripcion text;

alter table public.facturas_compra add column if not exists es_directa boolean not null default false;
alter table public.facturas_compra add column if not exists egreso_id integer;

notify pgrst, 'reload schema';
