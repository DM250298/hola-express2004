-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Solo lectura · productos cuyo margen guardado NO es el real        ║
-- ║                                                                     ║
-- ║  Lista lo que la mig 324 va a corregir: productos activos (combos   ║
-- ║  afuera) con precio y costo cuyo margen guardado no reproduce el    ║
-- ║  precio vigente (tolerancia $0,50, la misma de la ficha) y cuyo     ║
-- ║  margen real difiere del guardado. Correrla ANTES de la 324 para    ║
-- ║  ver qué cambia; DESPUÉS tiene que devolver 0 filas.                ║
-- ║  No modifica nada. Requiere 109 y 125.                              ║
-- ╚════════════════════════════════════════════════════════════════════╝

select p.id,
       p.nombre,
       p.precio_venta                                    as precio_vigente,
       c.precio_costo                                    as costo_actual,
       p.margen                                          as margen_guardado,
       public.fn_margen_desde_precio(c.precio_costo, p.precio_venta, coalesce(p.iva_venta, 21))
                                                         as margen_real,
       public.fn_precio_venta(c.precio_costo, coalesce(p.margen, 0), coalesce(p.iva_venta, 21))
                                                         as precio_que_daria_el_margen_guardado
  from public.productos p
  join public.costos_producto c on c.producto_id = p.id
 where p.activo
   and p.precio_venta > 0
   and c.precio_costo > 0
   and coalesce(p.tipo, '') <> 'combo'
   and not exists (select 1 from public.producto_componentes pc where pc.producto_id = p.id)
   and abs(public.fn_precio_venta(c.precio_costo, coalesce(p.margen, 0), coalesce(p.iva_venta, 21)) - p.precio_venta) > 0.5
   and public.fn_margen_desde_precio(c.precio_costo, p.precio_venta, coalesce(p.iva_venta, 21))
       is distinct from p.margen
 order by p.nombre;

-- El caso que disparó el arreglo (oct-2026): después de la 324, margen ≈ 60,69.
select p.id, p.nombre, p.precio_venta, p.margen, public.fn_costo(p.id) as costo
  from public.productos p
 where p.nombre ilike '%trix%';
