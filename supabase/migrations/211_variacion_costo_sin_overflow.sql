-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 211 · historial_costos.variacion_pct sin overflow        ║
-- ║                                                                     ║
-- ║  Bug de producción: "No se pudo guardar la factura: numeric field   ║
-- ║  overflow" (Pedido #225, carnaza x kg). fn_guardar_factura_compra   ║
-- ║  (168) registra la variación de costo en historial_costos:          ║
-- ║    round((costo_nuevo - costo_ant) / costo_ant * 100, 2)            ║
-- ║  y la columna es numeric(8,2) → tope 999.999,99 %. Si el costo      ║
-- ║  anterior era diminuto (un costo por gramo, un $1 de prueba), la    ║
-- ║  variación lo supera y aborta TODA la factura.                      ║
-- ║                                                                     ║
-- ║  Se agranda a numeric(14,2). Ninguna vista ni función depende del   ║
-- ║  tipo de la columna.                                                ║
-- ║                                                                     ║
-- ║  Diagnóstico (costo actual e historial del producto de la factura): ║
-- ║    select p.id, p.nombre, p.venta_por_peso, c.precio_costo          ║
-- ║      from public.productos p                                        ║
-- ║      left join public.costos_producto c on c.producto_id = p.id     ║
-- ║     where p.nombre ilike '%carnaza%';                               ║
-- ║    select * from public.historial_costos                            ║
-- ║     where producto_id = <id> order by created_at desc limit 10;     ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO.                                   ║
-- ╚════════════════════════════════════════════════════════════════════╝

alter table public.historial_costos
  alter column variacion_pct type numeric(14,2);

-- Verificación: debe decir numeric, 14, 2.
--   select data_type, numeric_precision, numeric_scale
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'historial_costos'
--      and column_name = 'variacion_pct';

notify pgrst, 'reload schema';
