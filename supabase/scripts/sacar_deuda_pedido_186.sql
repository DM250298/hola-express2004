-- Saca del portal de facturas la deuda provisoria del pedido #186 (salta refrescos),
-- que quedó rezagada sin factura y no se puede guardar (el ajuste a cantidad 0
-- intenta crear un lote con cantidad_inicial 0 y choca con lotes_cantidad_inicial_check).
--
-- Correr en el SQL Editor de Supabase (producción: itpgftqnxfscdvuzcvpl).
-- Primero el SELECT para ver qué va a borrar; después el DELETE.
-- Solo borra si la deuda sigue provisoria, sin factura y sin pagos. El stock
-- que entró con la recepción NO se toca.

select id, pedido_id, proveedor_id, monto, monto_pagado, estado, tiene_factura, provisoria, created_at
from public.cuentas_a_pagar
where pedido_id = 186;

delete from public.cuentas_a_pagar
where pedido_id = 186
  and provisoria = true
  and tiene_factura = false
  and coalesce(monto_pagado, 0) = 0
  and estado <> 'pagada'
returning id, monto;
-- Debe devolver 1 fila. Si devuelve 0, la deuda ya tiene factura o pagos: avisame antes de forzar nada.
