-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 040 — Venta por peso (kg) en productos
-- ─────────────────────────────────────────────────────────────────────────────
-- Agrega una bandera por producto para indicar que se vende por kilogramo
-- en lugar de por unidad. En el POS, al agregar un producto con
-- venta_por_peso = true, se solicita ingresar el peso (en gramos) antes de
-- añadirlo al carrito.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS venta_por_peso BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN productos.venta_por_peso IS
  'true = se vende por peso (kg); false = se vende por unidad (default).
   precio_venta representa el precio por 1 kg cuando este campo es true.
   La cantidad en items_venta se guarda en kg (ej: 0.350 para 350 g).';
