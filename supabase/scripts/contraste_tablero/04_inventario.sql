-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Contraste del Tablero del dueño · 4/5 · INVENTARIO A COSTO        ║
-- ║                                                                     ║
-- ║  Recalcula desde `productos` + `costos_producto` (sin usar          ║
-- ║  fn_resumen_skus) la tarjeta "Inventario a costo" y el              ║
-- ║  "Inmovilizado +45 días", con la misma regla del tablero: productos ║
-- ║  activos, con control de stock, que no son combos, con stock > 0,   ║
-- ║  valuados a stock_actual × costo ACTUAL. Y muestra lo que esa       ║
-- ║  cifra NO puede ver: stock con costo cero, stock negativo, y cuándo ║
-- ║  fue el último conteo físico. Los 10 de mayor valor son los que     ║
-- ║  conviene contar en la góndola para validar el número.              ║
-- ║                                                                     ║
-- ║  Correr en el SQL Editor de PRODUCCIÓN (HEX-V1). No modifica nada.  ║
-- ║  No depende del período. Última línea: "order by orden;"            ║
-- ╚════════════════════════════════════════════════════════════════════╝

with base as (
  select p.id, p.nombre, p.stock_actual,
         coalesce(cp.precio_costo, 0) as costo,
         coalesce(p.controlar_stock, true)
           and not exists (select 1 from public.producto_componentes x where x.producto_id = p.id) as stockeable,
         coalesce(
           case when k.ultima_venta is not null
                then greatest(floor(extract(epoch from now() - k.ultima_venta) / 86400)::integer, 0) end,
           floor(extract(epoch from now() - k.ultima_compra) / 86400)::integer,
           9999) as dias_quieto
  from public.productos p
  left join public.costos_producto cp on cp.producto_id = p.id
  left join (
    select ms.producto_id,
           max(ms.created_at) filter (where ms.tipo = 'venta') as ultima_venta,
           max(ms.created_at) filter (where ms.tipo = 'entrada') as ultima_compra
    from public.movimientos_stock ms
    where ms.tipo in ('venta', 'entrada')
    group by ms.producto_id
  ) k on k.producto_id = p.id
  where p.activo
),
agg as (
  select
    count(*) filter (where stockeable and stock_actual > 0) as n_con_stock,
    coalesce(sum(stock_actual * costo) filter (where stockeable and stock_actual > 0), 0) as valorizado,
    coalesce(sum(stock_actual * costo)
             filter (where stockeable and stock_actual > 0 and dias_quieto > 45), 0) as inmovilizado,
    count(*) filter (where stockeable and stock_actual > 0 and dias_quieto > 45) as n_inmov,
    count(*) filter (where stockeable and stock_actual > 0 and costo = 0) as n_costo_cero,
    coalesce(sum(stock_actual) filter (where stockeable and stock_actual > 0 and costo = 0), 0) as u_costo_cero,
    count(*) filter (where stockeable and stock_actual < 0) as n_neg,
    coalesce(sum(-stock_actual * costo) filter (where stockeable and stock_actual < 0), 0) as neg_valor,
    count(*) filter (where not stockeable) as n_fuera
  from base
),
top as (
  select string_agg(
           x.nombre || ': ' || x.stock_actual::text || ' u × $ ' || round(x.costo, 2)::text ||
           ' = $ ' || round(x.stock_actual * x.costo, 2)::text,
           ' · ' order by x.stock_actual * x.costo desc) as lista
  from (
    select * from base
    where stockeable and stock_actual > 0
    order by stock_actual * costo desc
    limit 10
  ) x
),
conteo as (
  select max(ms.created_at) as ultimo,
         count(distinct ms.producto_id) filter (where ms.created_at >= now() - interval '30 days') as n_30
  from public.movimientos_stock ms
  where ms.tipo = 'ajuste_conteo'
),
filas (orden, concepto, valor, detalle) as (
  select 10, 'Tarjeta INVENTARIO A COSTO ($)', round(a.valorizado, 2),
         a.n_con_stock::text || ' productos con stock · stock_actual × costo actual · fuera del cálculo: ' ||
         a.n_fuera::text || ' sin control de stock o combos'
  from agg a
  union all
  select 11, 'Inmovilizado +45 días sin vender ($)', round(a.inmovilizado, 2),
         a.n_inmov::text || ' productos (días desde la última venta en el kardex; sin ventas, desde la última entrada)'
  from agg a
  union all
  select 20, 'AVISO: productos con stock y costo CERO', a.n_costo_cero,
         a.u_costo_cero::text || ' unidades que valen $ 0 en la tarjeta: el inventario real es MAYOR'
  from agg a
  union all
  select 21, 'AVISO: productos con stock NEGATIVO', a.n_neg,
         'excluidos de la tarjeta · a costo valdrían $ ' || round(a.neg_valor, 2)::text ||
         ' · el stock del sistema está mal: contar y ajustar'
  from agg a
  union all
  select 30, 'Último ajuste por conteo físico', null::numeric,
         coalesce(to_char(c.ultimo at time zone 'America/Argentina/La_Rioja', 'DD/MM/YYYY HH24:MI'), 'nunca') ||
         ' · ' || c.n_30::text || ' productos ajustados por conteo en los últimos 30 días'
  from conteo c
  union all
  select 40, 'Los 10 que más pesan en la tarjeta (contarlos en góndola)', null::numeric,
         coalesce(t.lista, 'sin productos con stock')
  from top t
)
select orden, concepto, valor, detalle
from filas
order by orden;
