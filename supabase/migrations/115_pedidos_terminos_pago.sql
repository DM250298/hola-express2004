-- 115_pedidos_terminos_pago.sql
-- Términos de pago por orden de compra.
--
-- Hasta ahora la condición de pago sólo vivía en el proveedor
-- (`proveedores.condicion_pago`) y de ahí salía la fecha de vencimiento de la
-- cuenta a pagar al recibir. El usuario necesita elegir los términos por
-- ORDEN (Pago inmediato / 7 / 15 / 21 / 30 / 45 días), porque un mismo
-- proveedor puede negociar distintos plazos según la compra.
--
-- Se guarda el texto tal cual (igual que `condicion_pago`), así
-- `parsearDiasCondicionPago()` extrae los días: "30 días" → 30,
-- "Pago inmediato" → 0. La recepción prefiere estos términos y cae a la
-- condición del proveedor si la orden no los tiene.

alter table public.pedidos
  add column if not exists terminos_pago text;

comment on column public.pedidos.terminos_pago is
  'Términos de pago elegidos para esta orden (ej: "30 días", "Pago inmediato"). '
  'Si es NULL, la recepción usa la condición de pago del proveedor.';

notify pgrst, 'reload schema';
