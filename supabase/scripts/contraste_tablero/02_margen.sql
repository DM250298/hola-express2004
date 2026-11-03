-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Contraste del Tablero del dueño · 2/5 · MARGEN NETO DE IVA        ║
-- ║                                                                     ║
-- ║  Recalcula ítem por ítem, sin usar fn_items_vendidos_neto ni        ║
-- ║  fn_ventas_diarias, la tarjeta "Margen comercial neto de IVA" y los ║
-- ║  "días de inventario". Misma regla que la mig 312: neto = bruto /   ║
-- ║  (1 + IVA del ítem), costo congelado en la venta (si falta, el      ║
-- ║  actual), las devoluciones del período restan. Las filas AVISO      ║
-- ║  muestran cuánto del margen es estimado.                            ║
-- ║  Correr en el SQL Editor de PRODUCCIÓN (HEX-V1). No modifica nada.  ║
-- ║  Última línea del archivo: "order by orden;"                        ║
-- ╚════════════════════════════════════════════════════════════════════╝

with params as (
  -- ▼ Período a contrastar (mismo criterio que 01_ventas.sql).
  select date_trunc('month', h.hoy)::date as desde, h.hoy as hasta
  from (select (now() at time zone 'America/Argentina/La_Rioja')::date as hoy) h
),
rango as (
  select (p.desde::timestamp) at time zone 'America/Argentina/La_Rioja' as ini,
         ((p.hasta + 1)::timestamp) at time zone 'America/Argentina/La_Rioja' as fin,
         greatest(p.hasta - p.desde + 1, 1) as dias
  from params p
),
reg as (
  select c.cond, c.cond not in ('monotributo', 'monotributista', 'exento') as ri
  from (select lower(btrim(coalesce(
          (select cf.condicion_iva from public.config_fiscal cf where cf.id = 1), ''))) as cond) c
),
vend as (
  select
    coalesce(iv.subtotal, iv.cantidad * iv.precio_unitario) as bruto,
    coalesce(iv.subtotal, iv.cantidad * iv.precio_unitario)
      / (case when g.ri then 1 + coalesce(iv.iva_venta, p.iva_venta, 21) / 100 else 1 end) as neto,
    iv.cantidad
      * coalesce(civ.costo_unitario,
                 case when coalesce(p.controlar_stock, true) or cb.es_combo
                      then coalesce(cp.precio_costo, 0) else 0 end)
      * (case when g.ri then 1 else 1 + coalesce(p.iva_compra, 21) / 100 end) as costo,
    (civ.item_venta_id is null and (coalesce(p.controlar_stock, true) or cb.es_combo)) as estimado,
    (iv.iva_venta is null) as sin_iva,
    (coalesce(civ.costo_unitario, cp.precio_costo, 0) = 0
       and (coalesce(p.controlar_stock, true) or cb.es_combo)) as costo_cero
  from public.items_venta iv
  join public.ventas v on v.id = iv.venta_id
  join public.productos p on p.id = iv.producto_id
  left join public.costos_item_venta civ on civ.item_venta_id = iv.id
  left join public.costos_producto cp on cp.producto_id = iv.producto_id
  cross join lateral (
    select exists (select 1 from public.producto_componentes x where x.producto_id = iv.producto_id) as es_combo
  ) cb
  cross join rango r
  cross join reg g
  where v.estado = 'completada' and v.fecha >= r.ini and v.fecha < r.fin
),
devu as (
  select
    d.subtotal as bruto,
    d.subtotal / (case when g.ri then 1 + coalesce(iv.iva_venta, p.iva_venta, 21) / 100 else 1 end) as neto,
    d.cantidad
      * coalesce(cid.costo_unitario, civ.costo_unitario,
                 case when coalesce(p.controlar_stock, true) or cb.es_combo
                      then coalesce(cp.precio_costo, 0) else 0 end)
      * (case when g.ri then 1 else 1 + coalesce(p.iva_compra, 21) / 100 end) as costo
  from public.items_devolucion d
  join public.devoluciones dv on dv.id = d.devolucion_id
  join public.ventas v on v.id = dv.venta_id and v.estado = 'completada'
  join public.productos p on p.id = d.producto_id
  left join public.items_venta iv on iv.id = d.item_venta_id
  left join public.costos_item_devolucion cid on cid.item_devolucion_id = d.id
  left join public.costos_item_venta civ on civ.item_venta_id = d.item_venta_id
  left join public.costos_producto cp on cp.producto_id = d.producto_id
  cross join lateral (
    select exists (select 1 from public.producto_componentes x where x.producto_id = d.producto_id) as es_combo
  ) cb
  cross join rango r
  cross join reg g
  where dv.created_at >= r.ini and dv.created_at < r.fin
),
tv as (
  select coalesce(sum(bruto), 0) as bruto, coalesce(sum(neto), 0) as neto, coalesce(sum(costo), 0) as costo,
         count(*) as n_items,
         count(*) filter (where estimado) as n_est,
         coalesce(sum(bruto) filter (where estimado), 0) as bruto_est,
         count(*) filter (where sin_iva) as n_sin_iva,
         count(*) filter (where costo_cero) as n_costo_cero,
         coalesce(sum(bruto) filter (where costo_cero), 0) as bruto_costo_cero
  from vend
),
td as (
  select coalesce(sum(bruto), 0) as bruto, coalesce(sum(neto), 0) as neto,
         coalesce(sum(costo), 0) as costo, count(*) as n
  from devu
),
tot as (
  select tv.*, td.bruto as dev_bruto, td.n as dev_n,
         tv.neto - td.neto as ventas_netas,
         (tv.bruto - td.bruto) - (tv.neto - td.neto) as iva,
         tv.costo - td.costo as cmv
  from tv cross join td
),
inv as (
  select coalesce(sum(p.stock_actual * coalesce(cp.precio_costo, 0)), 0) as valorizado
  from public.productos p
  left join public.costos_producto cp on cp.producto_id = p.id
  where p.activo and coalesce(p.controlar_stock, true) and p.stock_actual > 0
    and not exists (select 1 from public.producto_componentes x where x.producto_id = p.id)
),
filas (orden, concepto, valor, detalle) as (
  select 1, 'Período contrastado', null::numeric, p.desde::text || ' a ' || p.hasta::text from params p
  union all
  select 2, 'Régimen de IVA (config_fiscal)', null,
         case when g.ri then 'responsable inscripto: se descuenta el IVA de cada ítem vendido'
              else g.cond || ': no se descuenta IVA y el costo va con el IVA de compra' end from reg g
  union all
  select 10, 'Ingresos brutos por ítem ($, con IVA)', round(t.bruto, 2),
         t.n_items::text || ' ítems · debería coincidir con la tarjeta Ventas (salvo redondeo de tickets)' from tot t
  union all
  select 11, 'Devoluciones del período ($ bruto)', round(t.dev_bruto, 2),
         t.dev_n::text || ' ítems devueltos: restan del margen, NO de la tarjeta Ventas' from tot t
  union all
  select 12, 'Tarjeta MARGEN · Ventas netas ($)', round(t.ventas_netas, 2),
         'ítems sin IVA menos devoluciones sin IVA' from tot t
  union all
  select 13, 'Tarjeta MARGEN · IVA ($)', round(t.iva, 2),
         'control: ventas netas + IVA + devoluciones brutas = ingresos brutos' from tot t
  union all
  select 14, 'Costo de lo vendido ($, neto de devoluciones)', round(t.cmv, 2),
         'costo congelado en cada venta; si falta, el costo actual del producto' from tot t
  union all
  select 15, 'Tarjeta MARGEN COMERCIAL NETO DE IVA ($)', round(t.ventas_netas - t.cmv, 2),
         case when t.ventas_netas > 0
              then round((t.ventas_netas - t.cmv) / t.ventas_netas * 100, 1)::text || ' % sobre ventas netas'
              else 'sin ventas netas' end from tot t
  union all
  select 16, 'Tarjeta INVENTARIO · días de inventario',
         case when t.cmv > 0 then round(i.valorizado / (t.cmv / r.dias), 1) end,
         'stock a costo ' || round(i.valorizado, 2)::text || ' / costo diario ' ||
         round(t.cmv / r.dias, 2)::text || ' (' || r.dias::text || ' días del período)'
  from tot t cross join inv i cross join rango r
  union all
  select 30, 'AVISO: ítems con costo ESTIMADO (sin costo congelado)', t.n_est,
         '$ ' || round(t.bruto_est, 2)::text || ' brutos · si es > 0 el tablero dice "* parcialmente estimado"' from tot t
  union all
  select 31, 'AVISO: ítems vendidos con costo CERO', t.n_costo_cero,
         '$ ' || round(t.bruto_costo_cero, 2)::text || ' brutos · inflan el margen: cargar el costo de esos productos' from tot t
  union all
  select 32, 'AVISO: ítems sin alícuota de IVA congelada', t.n_sin_iva,
         'ventas anteriores a la mig 311: toman el IVA actual del producto' from tot t
)
select orden, concepto, valor, detalle
from filas
order by orden;
