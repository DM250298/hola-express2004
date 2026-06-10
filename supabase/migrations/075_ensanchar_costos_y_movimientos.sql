-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 075 · Ensanchar precio_costo y saldos de movimientos     ║
-- ║                                                                     ║
-- ║  Prerequisito del módulo Producción (Fase 0).                       ║
-- ║                                                                     ║
-- ║  P1) costos_producto.precio_costo numeric(12,2) → numeric(12,4):    ║
-- ║      el costeo multinivel de recetas (semi-elaborados anidados)     ║
-- ║      trunca a centavos con 2 decimales y propaga el error aguas     ║
-- ║      arriba. fn_costo / fn_set_costo ya operan en numeric → NO se   ║
-- ║      reescriben, toleran el ensanche.                               ║
-- ║                                                                     ║
-- ║  P2) movimientos_stock.stock_anterior/stock_nuevo integer →         ║
-- ║      numeric(12,3): ARREGLA UN BUG LATENTE. Desde la 062 la columna ║
-- ║      cantidad es numeric y fn_crear_venta v7 inserta numeric en     ║
-- ║      estos saldos que seguían integer → Postgres redondea el saldo  ║
-- ║      del historial en CADA venta por peso (stock_actual queda bien, ║
-- ║      el movimiento no). Ensancharlos lo corrige.                    ║
-- ║                                                                     ║
-- ║  Ninguna vista referencia estas columnas (vista_cobertura_stock     ║
-- ║  usa stock_actual e items_venta.cantidad) → sin drop/recreate de    ║
-- ║  vistas. Ensanchar es no-destructivo: types/database.ts no cambia   ║
-- ║  (numeric e integer mapean ambos a number).                        ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────────────────────
-- P1 · costo a 4 decimales (precisión del costeo multinivel de recetas)
-- ─────────────────────────────────────────────────────────────────────
alter table public.costos_producto alter column precio_costo type numeric(12,4);

-- ─────────────────────────────────────────────────────────────────────
-- P2 · saldos del historial a numeric (arregla redondeo en venta por peso)
-- ─────────────────────────────────────────────────────────────────────
alter table public.movimientos_stock alter column stock_anterior type numeric(12,3);
alter table public.movimientos_stock alter column stock_nuevo    type numeric(12,3);

notify pgrst, 'reload schema';
