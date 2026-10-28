-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 319 · Margen neto de IVA (9/9): fn_mapa_nodo_skus v2     ║
-- ║                                                                     ║
-- ║  Base: mig 194. El drill-down del mapa (nodo → productos) mostraba  ║
-- ║  el margen bruto con IVA; ahora usa los helpers de la 312 acotados  ║
-- ║  a los productos del nodo: margen neto de IVA y de devoluciones,    ║
-- ║  margen % sobre ventas netas, y una columna nueva AL FINAL:         ║
-- ║  ingresos_netos. Así un mismo producto muestra el mismo margen en   ║
-- ║  /mapa, /tablero e Inventario › Análisis.                           ║
-- ║  Después: types/database.ts (MapaSkuRow). REQUIERE: mig 312.        ║
-- ╚════════════════════════════════════════════════════════════════════╝

drop function if exists public.fn_mapa_nodo_skus(integer, date, date);

create function public.fn_mapa_nodo_skus(
  p_ubicacion_id integer,
  p_desde date,
  p_hasta date
)
returns table (
  producto_id integer,
  nombre text,
  codigo_barras text,
  venta_por_peso boolean,
  ubicacion_id integer,
  ubicacion_nombre text,
  stock_actual numeric,
  unidades_vendidas numeric,
  ingresos numeric,
  margen_pesos numeric,
  margen_pct numeric,
  stock_valorizado numeric,
  dias_cobertura numeric,
  dias_sin_venta integer,
  clase_abc text,
  quiebres_periodo integer,
  alertas_criticas integer,
  alertas_atencion integer,
  ingresos_netos numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_costos boolean := public.fn_tiene_permiso('costos');
  v_dias integer := greatest(p_hasta - p_desde + 1, 1);
  v_pids integer[];
begin
  if not public.fn_tiene_permiso('inventario') then
    raise exception 'No tenés permiso para ver el mapa del local.';
  end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde then
    raise exception 'Período inválido.';
  end if;

  -- Productos del nodo y de todo lo que cuelga de él (acotan los helpers).
  with recursive rama as (
    select u.id from public.ubicaciones u where u.id = p_ubicacion_id
    union all
    select h.id from public.ubicaciones h join rama ra on h.parent_id = ra.id
  )
  select coalesce(array_agg(distinct pu.producto_id), '{}')
    into v_pids
    from public.producto_ubicacion pu
    join rama ra on ra.id = pu.ubicacion_id
   where pu.es_principal;

  return query
  with recursive rama as (
    select u.id, u.nombre from public.ubicaciones u where u.id = p_ubicacion_id
    union all
    select h.id, h.nombre
    from public.ubicaciones h
    join rama ra on h.parent_id = ra.id
  ),
  productos_nodo as (
    select pu.producto_id as pid, ra.id as ubic_id, ra.nombre as ubic_nombre
    from public.producto_ubicacion pu
    join rama ra on ra.id = pu.ubicacion_id
    where pu.es_principal
  ),
  rango as (
    select
      (p_desde::timestamp) at time zone 'America/Argentina/La_Rioja' as ini,
      ((p_hasta + 1)::timestamp) at time zone 'America/Argentina/La_Rioja' as fin
  ),
  vendido as (
    select x.producto_id as pid,
           sum(x.cantidad) as unidades,
           sum(x.bruto) as ingresos,
           sum(x.neto) as neto,
           sum(x.costo) as costo_ventas
    from public.fn_items_vendidos_neto(p_desde, p_hasta, v_pids) x
    group by x.producto_id
  ),
  devuelto as (
    select x.producto_id as pid,
           sum(x.neto) as neto,
           sum(x.costo) as costo
    from public.fn_items_devueltos_neto(p_desde, p_hasta, v_pids) x
    group by x.producto_id
  ),
  neto as (
    select pn.pid,
           coalesce(ve.neto, 0) - coalesce(dv.neto, 0) as ingresos_netos,
           coalesce(ve.costo_ventas, 0) - coalesce(dv.costo, 0) as costo
    from productos_nodo pn
    left join vendido ve on ve.pid = pn.pid
    left join devuelto dv on dv.pid = pn.pid
  ),
  kardex as (
    select ms.producto_id as pid, max(ms.created_at) as ultima_venta
    from public.movimientos_stock ms
    where ms.tipo = 'venta'
      and ms.producto_id = any (v_pids)
    group by ms.producto_id
  ),
  quiebres as (
    select q.producto_id as pid, count(*)::integer as cantidad
    from public.quiebres_stock q
    cross join rango r
    where q.producto_id = any (v_pids)
      and q.inicio_at < r.fin and coalesce(q.fin_at, now()) >= r.ini
    group by q.producto_id
  ),
  clase as (
    select distinct on (m.producto_id) m.producto_id as pid, m.clase_abc
    from public.metricas_sku_diarias m
    where m.producto_id = any (v_pids)
      and m.fecha between p_desde and p_hasta
    order by m.producto_id, m.fecha desc
  ),
  alertas_prod as (
    select a.producto_id as pid,
           count(*) filter (where a.severidad = 'critico')::integer as criticas,
           count(*) filter (where a.severidad = 'atencion')::integer as atencion
    from public.alertas a
    where a.estado <> 'resuelta'
      and a.producto_id = any (v_pids)
    group by a.producto_id
  )
  select
    p.id,
    p.nombre::text,
    p.codigo_barras::text,
    coalesce(p.venta_por_peso, false),
    pn.ubic_id,
    pn.ubic_nombre::text,
    p.stock_actual,
    coalesce(ve.unidades, 0),
    round(coalesce(ve.ingresos, 0), 2),
    case when v_costos then round(n.ingresos_netos - n.costo, 2) end,
    case when v_costos and n.ingresos_netos > 0
         then round(((n.ingresos_netos - n.costo) / n.ingresos_netos * 100)::numeric, 1)
         end,
    case when v_costos
         then round(p.stock_actual * coalesce(public.fn_costo(p.id), 0), 2) end,
    case when coalesce(ve.unidades, 0) > 0 and p.stock_actual > 0
         then round((p.stock_actual * v_dias / ve.unidades)::numeric, 1) end,
    case when k.ultima_venta is not null
         then greatest(floor(extract(epoch from now() - k.ultima_venta) / 86400)::integer, 0)
         end,
    cl.clase_abc::text,
    coalesce(q.cantidad, 0),
    coalesce(ap.criticas, 0),
    coalesce(ap.atencion, 0),
    round(n.ingresos_netos, 2)
  from productos_nodo pn
  join public.productos p on p.id = pn.pid
  join neto n on n.pid = pn.pid
  left join vendido ve on ve.pid = p.id
  left join kardex k on k.pid = p.id
  left join quiebres q on q.pid = p.id
  left join clase cl on cl.pid = p.id
  left join alertas_prod ap on ap.pid = p.id
  where p.activo
  order by coalesce(ap.criticas, 0) desc, coalesce(ve.ingresos, 0) desc, p.id;
end;
$$;

revoke execute on function public.fn_mapa_nodo_skus(integer, date, date) from public, anon;
grant execute on function public.fn_mapa_nodo_skus(integer, date, date) to authenticated;

notify pgrst, 'reload schema';
