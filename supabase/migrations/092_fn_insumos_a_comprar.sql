-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 092 · Insumos a comprar para las órdenes pendientes       ║
-- ║                                                                     ║
-- ║  Explosión de recetas → sugerencia de compra (conecta Producción    ║
-- ║  con Compras). Toma las órdenes de producción en BORRADOR (las que  ║
-- ║  todavía no consumieron insumos), explota cada receta a sus         ║
-- ║  ingredientes HOJA (insumos sin receta activa = comprables; los     ║
-- ║  semi-elaborados se excluyen porque tienen su propia orden de       ║
-- ║  reposición), suma por insumo, netea contra el stock actual y       ║
-- ║  agrupa por proveedor. Misma matemática que                         ║
-- ║  fn_iniciar_orden_produccion (factor = planificada / rendimiento,   ║
-- ║  convierte a la unidad de stock y aplica merma), así no hay doble   ║
-- ║  conteo y es consistente con cómo se descuenta el stock.            ║
-- ║                                                                     ║
-- ║  Prerequisitos: módulo Producción (075-084). Solo lectura.          ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

create or replace function public.fn_insumos_a_comprar()
returns table (
  insumo_id        integer,
  insumo_nombre    text,
  codigo_barras    text,
  unidad           text,
  proveedor_id     integer,
  proveedor_nombre text,
  requerido        numeric,
  stock_actual     numeric,
  a_comprar        numeric,
  precio_costo     numeric,
  costo_estimado   numeric
)
language sql stable security definer set search_path = public as $$
  with demanda as (
    select
      ri.insumo_id,
      sum(
        public.fn_convertir_unidad(
          ri.cantidad
            * (op.cantidad_planificada / r.rendimiento)
            * (1 + ri.merma_pct / 100.0),
          ri.unidad,
          pi.unidad
        )
      ) as requerido
    from public.ordenes_produccion op
    join public.recetas r            on r.id = op.receta_id
    join public.receta_ingredientes ri on ri.receta_id = r.id
    join public.productos pi          on pi.id = ri.insumo_id
    where op.estado = 'borrador'
      and r.rendimiento > 0
      -- solo ingredientes HOJA (sin receta activa propia): los semi-elaborados
      -- se reponen por su propia orden, no se recursan acá (evita doble conteo).
      and not exists (
        select 1 from public.recetas r2
        where r2.producto_id = ri.insumo_id and r2.activa = true
      )
    group by ri.insumo_id
  )
  select
    d.insumo_id,
    p.nombre                                                as insumo_nombre,
    p.codigo_barras,
    p.unidad,
    p.proveedor_id,
    prov.nombre                                             as proveedor_nombre,
    d.requerido,
    coalesce(p.stock_actual, 0)                             as stock_actual,
    greatest(d.requerido - coalesce(p.stock_actual, 0), 0)  as a_comprar,
    public.fn_costo(d.insumo_id)                            as precio_costo,
    greatest(d.requerido - coalesce(p.stock_actual, 0), 0)
      * public.fn_costo(d.insumo_id)                        as costo_estimado
  from demanda d
  join public.productos p        on p.id = d.insumo_id
  left join public.proveedores prov on prov.id = p.proveedor_id
  where d.requerido > 0
  order by prov.nombre nulls last, p.nombre;
$$;

grant execute on function public.fn_insumos_a_comprar() to authenticated;

notify pgrst, 'reload schema';
