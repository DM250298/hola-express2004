-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 131 · items_pedido.cantidad_facturada (three-way match)   ║
-- ║                                                                     ║
-- ║  Objetivo del circuito nuevo: la RECEPCIÓN sigue moviendo el stock   ║
-- ║  (se vende al toque, se controla cantidad + vencimiento). La FACTURA ║
-- ║  pasa a ser el punto de RECONCILIACIÓN: al cargarla/editarla ajusta  ║
-- ║  el stock por la DIFERENCIA contra lo recibido, sin revertir la      ║
-- ║  recepción y sin doble carga.                                        ║
-- ║                                                                     ║
-- ║  Esta columna es el marcador que hace ese ajuste IDEMPOTENTE:        ║
-- ║  guarda cuánto confirmó la factura de cada renglón. La 132 mueve     ║
-- ║  stock por (cantidad_facturada_nueva − lo ya reflejado), así         ║
-- ║  re-guardar/editar una factura NO duplica el stock.                  ║
-- ║  Bonus: completa el three-way match  pedida → recibida → facturada.  ║
-- ║                                                                     ║
-- ║  Correr ANTES de la 132. Ejecutar UNA sola vez, COMPLETO, en el      ║
-- ║  SQL Editor de Supabase.                                            ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─── 1) Columna ──────────────────────────────────────────────────────
alter table public.items_pedido
  add column if not exists cantidad_facturada numeric(12,3);

comment on column public.items_pedido.cantidad_facturada is
  'Cantidad confirmada por la factura de compra (three-way match: pedida→recibida→facturada). NULL = la cuenta todavía no tiene factura. La usa fn_guardar_factura_compra como marcador para ajustar el stock por delta de forma idempotente (re-guardar/editar no duplica).';

-- ─── 2) Backfill de facturas históricas ─────────────────────────────
--   Las cuentas que YA tienen factura se dan por reconciliadas al valor
--   RECIBIDO, que es lo que el stock refleja hoy (la factura vieja nunca
--   movió stock). Así, reabrir y re-guardar una factura histórica arranca
--   con delta 0 y NO mueve stock por sorpresa.
--   (La UI debe precargar la cantidad desde coalesce(cantidad_facturada,
--   cantidad_recibida) para que ese re-guardado sea efectivamente delta 0.)
update public.items_pedido ip
   set cantidad_facturada = ip.cantidad_recibida
  from public.cuentas_a_pagar c
 where ip.cuenta_a_pagar_id = c.id
   and c.tiene_factura = true
   and ip.cantidad_facturada is null;

notify pgrst, 'reload schema';
