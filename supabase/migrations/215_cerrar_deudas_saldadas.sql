-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 215 · Cerrar deudas saldadas que quedaron "pendientes"   ║
-- ║                                                                     ║
-- ║  Reclamo: en Cuentas a pagar aparecen deudas con saldo $0,00 como   ║
-- ║  VENCIDAS (ej. "salta refrescos"). La v13 y anteriores de           ║
-- ║  fn_guardar_factura_compra podían bajar el total de la factura por  ║
-- ║  debajo de lo ya pagado sin re-derivar el estado: la fila quedaba   ║
-- ║  'pendiente' con saldo 0, y nadie la cerró después.                 ║
-- ║                                                                     ║
-- ║  Se marcan 'pagada' las deudas CON importe cuyo aplicado            ║
-- ║  (monto_pagado − Σ sobrantes, la misma regla que fn_pagar_cuenta)   ║
-- ║  cubre el total con la tolerancia de $1 que ya se condona al pagar. ║
-- ║  fecha_pago = la del último pago registrado (o hoy si no hay).      ║
-- ║  Las deudas SIN importe (recepción sin costo, esperando la factura) ║
-- ║  NO se tocan: la UI ya no las muestra vencidas.                     ║
-- ║                                                                     ║
-- ║  PREVIEW (correr ANTES, no modifica nada): ver al final.            ║
-- ║  Ejecutar UNA sola vez, COMPLETO.                                   ║
-- ╚════════════════════════════════════════════════════════════════════╝

with aplicado as (
  select c.id,
         c.monto,
         c.monto_pagado - coalesce((select sum(p.sobrante) from public.pagos_cuenta p
                                     where p.cuenta_a_pagar_id = c.id), 0) as aplicado,
         (select max(p.fecha) from public.pagos_cuenta p where p.cuenta_a_pagar_id = c.id) as ultimo_pago
    from public.cuentas_a_pagar c
   where c.estado <> 'pagada'
     and c.monto > 0
)
update public.cuentas_a_pagar c
   set estado = 'pagada'::public.estado_cuenta_pagar,
       fecha_pago = coalesce(c.fecha_pago, a.ultimo_pago,
                             (now() at time zone 'America/Argentina/La_Rioja')::date)
  from aplicado a
 where a.id = c.id
   and a.aplicado >= a.monto - 1;

-- ─── Preview (correr ANTES) ─────────────────────────────────────────
--   select c.id, pr.nombre as proveedor, c.monto, c.monto_pagado, c.estado, c.fecha_vencimiento
--     from public.cuentas_a_pagar c
--     left join public.proveedores pr on pr.id = c.proveedor_id
--    where c.estado <> 'pagada' and c.monto > 0
--      and c.monto_pagado - coalesce((select sum(p.sobrante) from public.pagos_cuenta p
--                                      where p.cuenta_a_pagar_id = c.id), 0) >= c.monto - 1
--    order by c.fecha_vencimiento;
--
-- Verificación (debe dar 0 filas): el mismo select después de correrla.

notify pgrst, 'reload schema';
