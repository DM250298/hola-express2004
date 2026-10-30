-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Control de pegado · migs 322, 323 y 324 (solo lectura)             ║
-- ║                                                                     ║
-- ║  El SQL Editor recorta pegados largos y las 322/323 son un único    ║
-- ║  CREATE de ~600 líneas: correr esto DESPUÉS de las tres para        ║
-- ║  confirmar que quedaron de verdad. Los dos primeros tienen que dar  ║
-- ║  true, el tercero no devolver filas y el cuarto dar 0.              ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- 1. fn_guardar_factura_compra quedó en la v25 (marca dentro del cuerpo).
select pg_get_functiondef('public.fn_guardar_factura_compra'::regproc) like '%v25 (mig 322)%'
       as factura_v25_ok;

-- 2. fn_registrar_compra_directa quedó con la rama de la 323.
select pg_get_functiondef('public.fn_registrar_compra_directa'::regproc) like '%mig 323: par coherente%'
       as compra_directa_323_ok;

-- 3. T1: ninguna fn_% duplicada (CREATE OR REPLACE con otra firma crea una nueva).
select proname, count(*)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and proname like 'fn_%'
 group by proname having count(*) > 1;

-- 4. Después de la 324 no queda ningún margen desactualizado (debe dar 0).
select count(*) as margenes_desactualizados
  from public.productos p
  join public.costos_producto c on c.producto_id = p.id
 where p.activo
   and p.precio_venta > 0
   and c.precio_costo > 0
   and coalesce(p.tipo, '') <> 'combo'
   and not exists (select 1 from public.producto_componentes pc where pc.producto_id = p.id)
   and abs(public.fn_precio_venta(c.precio_costo, coalesce(p.margen, 0), coalesce(p.iva_venta, 21)) - p.precio_venta) > 0.5
   and public.fn_margen_desde_precio(c.precio_costo, p.precio_venta, coalesce(p.iva_venta, 21))
       is distinct from p.margen;
