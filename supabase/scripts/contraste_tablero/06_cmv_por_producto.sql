-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Contraste del Tablero del dueño · 6 · CMV PRODUCTO POR PRODUCTO    ║
-- ║                                                                     ║
-- ║  Abre el "costo de lo vendido" que resta la tarjeta Margen: una     ║
-- ║  fila por producto vendido en el período con unidades, bruto (con   ║
-- ║  IVA), neto, IVA, costo unitario congelado al vender (mín–máx si    ║
-- ║  cambió en el período), costo actual, CMV, margen $ y % sobre neto, ║
-- ║  y si alguna línea se valuó con costo estimado (sin costo congelado ║
-- ║  → usa el actual) o costo cero. La primera fila es el total: tiene  ║
-- ║  que coincidir con la tarjeta. Misma regla que la mig 312.          ║
-- ║  Correr en el SQL Editor de PRODUCCIÓN (HEX-V1). No modifica nada.  ║
-- ║  Última línea del archivo: "order by orden, cmv desc;"              ║
-- ╚════════════════════════════════════════════════════════════════════╝

with params as (
  -- ▼ Período a contrastar. Para octubre: date '2026-10-01', date '2026-10-31'.
  select date_trunc('month', h.hoy)::date as desde, h.hoy as hasta
  from (select (now() at time zone 'America/Argentina/La_Rioja')::date as hoy) h
),
rango as (
  select (p.desde::timestamp) at time zone 'America/Argentina/La_Rioja' as ini,
         ((p.hasta + 1)::timestamp) at time zone 'America/Argentina/La_Rioja' as fin
  from params p
),
reg as (
  select c.cond not in ('monotributo', 'monotributista', 'exento') as ri
  from (select lower(btrim(coalesce(
          (select cf.condicion_iva from public.config_fiscal cf where cf.id = 1), ''))) as cond) c
),
vend as (
  select iv.producto_id, iv.cantidad,
    coalesce(iv.subtotal, iv.cantidad * iv.precio_unitario) as bruto,
    coalesce(iv.subtotal, iv.cantidad * iv.precio_unitario)
      / (case when g.ri then 1 + coalesce(iv.iva_venta, p.iva_venta, 21) / 100 else 1 end) as neto,
    coalesce(civ.costo_unitario,
             case when coalesce(p.controlar_stock, true) or cb.es_combo
                  then coalesce(cp.precio_costo, 0) else 0 end)
      * (case when g.ri then 1 else 1 + coalesce(p.iva_compra, 21) / 100 end) as costo_unit,
    (civ.item_venta_id is null and (coalesce(p.controlar_stock, true) or cb.es_combo)) as estimado,
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
  select d.producto_id, d.cantidad, d.subtotal as bruto,
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
por_prod as (
  select v.producto_id,
         sum(v.cantidad) as unidades,
         sum(v.bruto) as bruto,
         sum(v.neto) as neto,
         sum(v.cantidad * v.costo_unit) as costo_vendido,
         min(v.costo_unit) filter (where not v.estimado) as cong_min,
         max(v.costo_unit) filter (where not v.estimado) as cong_max,
         count(*) filter (where v.estimado) as n_est,
         count(*) filter (where v.costo_cero) as n_cero,
         count(*) as n_lineas
  from vend v
  group by v.producto_id
),
por_dev as (
  select d.producto_id, sum(d.cantidad) as unidades, sum(d.bruto) as bruto,
         sum(d.neto) as neto, sum(d.costo) as costo
  from devu d
  group by d.producto_id
),
detalle as (
  select pp.producto_id, p.nombre, c.nombre as categoria,
         pp.unidades - coalesce(pd.unidades, 0) as unidades,
         pp.bruto - coalesce(pd.bruto, 0) as bruto,
         pp.neto - coalesce(pd.neto, 0) as neto,
         (pp.bruto - coalesce(pd.bruto, 0)) - (pp.neto - coalesce(pd.neto, 0)) as iva,
         pp.costo_vendido - coalesce(pd.costo, 0) as cmv,
         pp.cong_min, pp.cong_max, pp.n_est, pp.n_cero, pp.n_lineas,
         coalesce(cp.precio_costo, 0) as costo_actual
  from por_prod pp
  join public.productos p on p.id = pp.producto_id
  left join public.categorias c on c.id = p.categoria_id
  left join public.costos_producto cp on cp.producto_id = pp.producto_id
  left join por_dev pd on pd.producto_id = pp.producto_id
)
select 0 as orden, '— TOTAL DEL PERÍODO —' as producto, null::text as categoria,
       round(sum(unidades), 2) as unidades,
       round(sum(bruto), 2) as bruto_con_iva,
       round(sum(neto), 2) as neto_sin_iva,
       round(sum(iva), 2) as iva,
       round(sum(cmv), 2) as cmv,
       null::text as costo_unit_congelado,
       null::numeric as costo_actual,
       round(sum(neto) - sum(cmv), 2) as margen,
       round((sum(neto) - sum(cmv)) / nullif(sum(neto), 0) * 100, 1) as margen_pct,
       sum(n_est)::text || ' líneas estimadas · ' || sum(n_cero)::text || ' con costo cero · ' ||
         count(*)::text || ' productos' as observacion
from detalle
union all
select 1, d.nombre, d.categoria,
       round(d.unidades, 2), round(d.bruto, 2), round(d.neto, 2), round(d.iva, 2), round(d.cmv, 2),
       case when d.cong_min is null then 'sin costo congelado'
            when d.cong_min = d.cong_max then round(d.cong_min, 2)::text
            else round(d.cong_min, 2)::text || ' – ' || round(d.cong_max, 2)::text end,
       round(d.costo_actual, 2),
       round(d.neto - d.cmv, 2),
       round((d.neto - d.cmv) / nullif(d.neto, 0) * 100, 1),
       concat_ws(' · ',
         case when d.n_est > 0 then d.n_est::text || ' de ' || d.n_lineas::text || ' líneas con costo estimado (actual)' end,
         case when d.n_cero > 0 then d.n_cero::text || ' líneas con costo CERO' end,
         case when d.cong_max is not null and d.costo_actual > d.cong_max
              then 'costo actual más alto que el congelado' end)
from detalle d
order by orden, cmv desc;
