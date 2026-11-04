-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 326 · PLU de balanza en productos                         ║
-- ║                                                                     ║
-- ║  Pedido del dueño (2026-11-04): cobrar los productos pesables       ║
-- ║  escaneando la etiqueta que imprime la balanza. La etiqueta es un   ║
-- ║  EAN-13 de uso interno: "20" + PLU (5 dígitos) + gramos (5 dígitos) ║
-- ║  + dígito verificador. Ej: 2000001002704 = PLU 1, 0,270 kg. El      ║
-- ║  código NO trae el precio: el POS cobra el precio_venta (por kg)    ║
-- ║  del sistema; la balanza tiene que tener los mismos precios.        ║
-- ║                                                                     ║
-- ║  · productos.plu_balanza integer null: el número de PLU que tiene   ║
-- ║    el producto cargado en la balanza. Único (índice parcial), entre ║
-- ║    1 y 99999. Solo tiene sentido con venta_por_peso = true (lo      ║
-- ║    cuida la ficha; la base no lo exige para no romper el import).   ║
-- ║  · Sin cambios de RLS: el cajero ya lee productos; escribe quien    ║
-- ║    tiene 'configuracion'.                                           ║
-- ║  · Sin cambios de RPC: fn_crear_venta v14 (218) ya acepta cantidad  ║
-- ║    decimal y calcula subtotal = precio × cantidad.                  ║
-- ║                                                                     ║
-- ║  Correrla ANTES de deployar el front: al escanear una etiqueta el   ║
-- ║  POS filtra por esta columna (la ficha solo la manda si hay valor). ║
-- ║  Test: supabase/tests/test_plu_balanza.sql (rollback).              ║
-- ╚════════════════════════════════════════════════════════════════════╝

alter table public.productos
  add column if not exists plu_balanza integer;

alter table public.productos
  drop constraint if exists productos_plu_balanza_rango;
alter table public.productos
  add constraint productos_plu_balanza_rango
  check (plu_balanza is null or plu_balanza between 1 and 99999);

-- Único entre los productos que tienen PLU; los NULL no chocan.
create unique index if not exists productos_plu_balanza_key
  on public.productos (plu_balanza)
  where plu_balanza is not null;

comment on column public.productos.plu_balanza is
  'PLU del producto en la balanza (mig 326). La etiqueta es EAN-13 "20" + PLU (5 dígitos) + gramos (5 dígitos) + verificador; el POS resuelve el producto por este número y carga los kg. Solo productos con venta_por_peso. NULL = no está en la balanza. Único.';

notify pgrst, 'reload schema';

-- ── VERIFICACIÓN 1: la columna existe ────────────────────────────────
-- select column_name, data_type, is_nullable
--   from information_schema.columns
--  where table_schema = 'public' and table_name = 'productos'
--    and column_name = 'plu_balanza';

-- ── VERIFICACIÓN 2: índice único parcial y check ─────────────────────
-- select indexname, indexdef from pg_indexes
--  where schemaname = 'public' and indexname = 'productos_plu_balanza_key';
-- select conname, pg_get_constraintdef(oid) from pg_constraint
--  where conname = 'productos_plu_balanza_rango';
