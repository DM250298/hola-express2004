-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 312 · Margen neto de IVA (2/9): la fórmula, una sola vez ║
-- ║                                                                     ║
-- ║  Dos helpers INTERNOS que devuelven, ítem por ítem, lo vendido y lo ║
-- ║  devuelto del período con bruto, neto de IVA y costo. Todo lo que   ║
-- ║  calcula margen (fn_ventas_diarias, fn_resumen_skus,                ║
-- ║  fn_mapa_nodo_skus) lee de acá: si la regla cambia, se cambia en    ║
-- ║  un solo lugar.                                                     ║
-- ║                                                                     ║
-- ║  Regla (decisión del dueño, 2026-10-28):                            ║
-- ║   · Responsable inscripto: neto = bruto / (1 + alícuota/100) con la ║
-- ║     alícuota congelada en items_venta.iva_venta (mig 311), o la del ║
-- ║     producto si falta; el costo guardado ya es sin IVA.             ║
-- ║   · Monotributista / exento: no discrimina IVA → neto = bruto y el  ║
-- ║     costo se toma CON el IVA de compra (no recupera crédito).       ║
-- ║   · Se descuenta de TODAS las ventas, sin mirar el medio de pago.   ║
-- ║   · Devoluciones: restan bruto, neto y costo el día en que se       ║
-- ║     hicieron (destino stock o merma por igual: el contra-asiento de ║
-- ║     fn_crear_devolucion revierte el CMV en ambos; la merma queda    ║
-- ║     registrada aparte en movimientos_stock).                        ║
-- ║   · Costo: el congelado en la venta (mig 171); si falta, el actual  ║
-- ║     para los que controlan stock o son combo (marca `estimado`),    ║
-- ║     0 para los que no controlan. Igual que hasta hoy.               ║
-- ║                                                                     ║
-- ║  SQL puro sin SET ni SECURITY DEFINER para que el planner pueda     ║
-- ║  inlinearlos (los llaman solo funciones definer). p_productos acota ║
-- ║  el recorrido (lo usa el mapa). REQUIERE: mig 311.                  ║
-- ╚════════════════════════════════════════════════════════════════════╝

drop function if exists public.fn_items_vendidos_neto(date, date, integer[]);

create function public.fn_items_vendidos_neto(
  p_desde date,
  p_hasta date,
  p_productos integer[] default null
)
returns table (
  dia date,
  producto_id integer,
  cantidad numeric,
  bruto numeric,
  neto numeric,
  costo numeric,
  estimado boolean
)
language sql
stable
as $$
  with reg as (
    select public.fn_regimen_iva() = 'responsable_inscripto' as ri
  ),
  rango as (
    select (p_desde::timestamp) at time zone 'America/Argentina/La_Rioja' as ini,
           ((p_hasta + 1)::timestamp) at time zone 'America/Argentina/La_Rioja' as fin
  )
  select
    (v.fecha at time zone 'America/Argentina/La_Rioja')::date as dia,
    iv.producto_id,
    iv.cantidad::numeric as cantidad,
    coalesce(iv.subtotal, iv.cantidad * iv.precio_unitario) as bruto,
    coalesce(iv.subtotal, iv.cantidad * iv.precio_unitario)
      / (case when g.ri then 1 + coalesce(iv.iva_venta, p.iva_venta, 21) / 100 else 1 end) as neto,
    iv.cantidad
      * coalesce(civ.costo_unitario,
                 case when coalesce(p.controlar_stock, true) or cb.es_combo
                      then coalesce(public.fn_costo(iv.producto_id), 0) else 0 end)
      * (case when g.ri then 1 else 1 + coalesce(p.iva_compra, 21) / 100 end) as costo,
    (civ.item_venta_id is null
      and (coalesce(p.controlar_stock, true) or cb.es_combo)) as estimado
  from public.items_venta iv
  join public.ventas v on v.id = iv.venta_id
  join public.productos p on p.id = iv.producto_id
  left join public.costos_item_venta civ on civ.item_venta_id = iv.id
  cross join lateral (
    select exists (
      select 1 from public.producto_componentes x where x.producto_id = iv.producto_id
    ) as es_combo
  ) cb
  cross join rango r
  cross join reg g
  where v.estado = 'completada'
    and v.fecha >= r.ini and v.fecha < r.fin
    and (p_productos is null or iv.producto_id = any (p_productos))
$$;

revoke execute on function public.fn_items_vendidos_neto(date, date, integer[])
  from public, anon, authenticated;

drop function if exists public.fn_items_devueltos_neto(date, date, integer[]);

create function public.fn_items_devueltos_neto(
  p_desde date,
  p_hasta date,
  p_productos integer[] default null
)
returns table (
  dia date,
  producto_id integer,
  cantidad numeric,
  bruto numeric,
  neto numeric,
  costo numeric
)
language sql
stable
as $$
  with reg as (
    select public.fn_regimen_iva() = 'responsable_inscripto' as ri
  ),
  rango as (
    select (p_desde::timestamp) at time zone 'America/Argentina/La_Rioja' as ini,
           ((p_hasta + 1)::timestamp) at time zone 'America/Argentina/La_Rioja' as fin
  )
  select
    (dv.created_at at time zone 'America/Argentina/La_Rioja')::date as dia,
    d.producto_id,
    d.cantidad::numeric as cantidad,
    d.subtotal as bruto,
    d.subtotal
      / (case when g.ri then 1 + coalesce(iv.iva_venta, p.iva_venta, 21) / 100 else 1 end) as neto,
    d.cantidad
      * coalesce(cid.costo_unitario,
                 civ.costo_unitario,
                 case when coalesce(p.controlar_stock, true) or cb.es_combo
                      then coalesce(public.fn_costo(d.producto_id), 0) else 0 end)
      * (case when g.ri then 1 else 1 + coalesce(p.iva_compra, 21) / 100 end) as costo
  from public.items_devolucion d
  join public.devoluciones dv on dv.id = d.devolucion_id
  join public.ventas v on v.id = dv.venta_id and v.estado = 'completada'
  join public.productos p on p.id = d.producto_id
  left join public.items_venta iv on iv.id = d.item_venta_id
  left join public.costos_item_devolucion cid on cid.item_devolucion_id = d.id
  left join public.costos_item_venta civ on civ.item_venta_id = d.item_venta_id
  cross join lateral (
    select exists (
      select 1 from public.producto_componentes x where x.producto_id = d.producto_id
    ) as es_combo
  ) cb
  cross join rango r
  cross join reg g
  where dv.created_at >= r.ini and dv.created_at < r.fin
    and (p_productos is null or d.producto_id = any (p_productos))
$$;

revoke execute on function public.fn_items_devueltos_neto(date, date, integer[])
  from public, anon, authenticated;

notify pgrst, 'reload schema';

-- Verificación (ambas true):
--   select to_regprocedure('public.fn_items_vendidos_neto(date,date,integer[])') is not null;
--   select to_regprocedure('public.fn_items_devueltos_neto(date,date,integer[])') is not null;
