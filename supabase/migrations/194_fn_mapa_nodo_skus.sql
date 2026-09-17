-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 194 · Fase E (2/2): del nodo al producto                 ║
-- ║                                                                     ║
-- ║  fn_mapa_nodo_skus(p_ubicacion_id, p_desde, p_hasta): los productos ║
-- ║  que viven en ese nodo Y en todo lo que cuelga de él, con sus       ║
-- ║  números del período y sus alertas vivas. Último escalón del        ║
-- ║  drill-down: empresa → sector → góndola → módulo → estante → SKU.   ║
-- ║                                                                     ║
-- ║  OJO — por qué NO usa fn_resumen_skus: esa función calcula los      ║
-- ║  4000 productos activos (y recorre TODO movimientos_stock) antes    ║
-- ║  de que se pueda filtrar por ubicación. Para abrir un estante de    ║
-- ║  10 productos eso se pasa del statement_timeout de Supabase (8 s).  ║
-- ║  Acá se arranca por los productos del nodo y todo se calcula solo   ║
-- ║  para ellos. La clase ABC sale del snapshot diario (mig 173), que   ║
-- ║  ya la tiene calculada contra todo el catálogo.                     ║
-- ║                                                                     ║
-- ║  Gates: exige 'inventario'; sin 'costos', margen y stock a costo    ║
-- ║  vuelven NULL. ORDER BY determinístico para traerTodo().            ║
-- ║                                                                     ║
-- ║  Después: types/database.ts (Functions: fn_mapa_nodo_skus).         ║
-- ║  REQUIERE: migs 170, 171, 173 y 183. Ejecutar UNA sola vez.         ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- Las alertas se cruzan por producto en el mapa y en el panel del nodo.
create index if not exists alertas_producto_vivas_idx
  on public.alertas (producto_id) where estado <> 'resuelta';

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
  alertas_atencion integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_costos boolean := public.fn_tiene_permiso('costos');
  v_dias integer := greatest(p_hasta - p_desde + 1, 1);
begin
  if not public.fn_tiene_permiso('inventario') then
    raise exception 'No tenés permiso para ver el mapa del local.';
  end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde then
    raise exception 'Período inválido.';
  end if;

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
    select
      iv.producto_id as pid,
      sum(iv.cantidad) as unidades,
      sum(coalesce(iv.subtotal, iv.cantidad * iv.precio_unitario)) as ingresos,
      -- Costo congelado de la venta (mig 171); si falta, el costo actual.
      sum(iv.cantidad * coalesce(
        civ.costo_unitario,
        case when coalesce(p.controlar_stock, true)
                  or exists (select 1 from public.producto_componentes pc
                             where pc.producto_id = iv.producto_id)
             then coalesce(public.fn_costo(iv.producto_id), 0) else 0 end
      )) as costo_ventas
    from public.items_venta iv
    join public.ventas v on v.id = iv.venta_id
    join public.productos p on p.id = iv.producto_id
    left join public.costos_item_venta civ on civ.item_venta_id = iv.id
    cross join rango r
    where iv.producto_id in (select pn.pid from productos_nodo pn)
      and v.estado = 'completada'
      and v.fecha >= r.ini and v.fecha < r.fin
    group by iv.producto_id
  ),
  kardex as (
    select ms.producto_id as pid, max(ms.created_at) as ultima_venta
    from public.movimientos_stock ms
    where ms.tipo = 'venta'
      and ms.producto_id in (select pn.pid from productos_nodo pn)
    group by ms.producto_id
  ),
  quiebres as (
    select q.producto_id as pid, count(*)::integer as cantidad
    from public.quiebres_stock q
    cross join rango r
    where q.producto_id in (select pn.pid from productos_nodo pn)
      and q.inicio_at < r.fin and coalesce(q.fin_at, now()) >= r.ini
    group by q.producto_id
  ),
  clase as (
    -- Clase ABC del último día con snapshot dentro del período.
    select distinct on (m.producto_id) m.producto_id as pid, m.clase_abc
    from public.metricas_sku_diarias m
    where m.producto_id in (select pn.pid from productos_nodo pn)
      and m.fecha between p_desde and p_hasta
    order by m.producto_id, m.fecha desc
  ),
  alertas_prod as (
    select a.producto_id as pid,
           count(*) filter (where a.severidad = 'critico')::integer as criticas,
           count(*) filter (where a.severidad = 'atencion')::integer as atencion
    from public.alertas a
    where a.estado <> 'resuelta'
      and a.producto_id in (select pn.pid from productos_nodo pn)
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
    case when v_costos
         then round(coalesce(ve.ingresos, 0) - coalesce(ve.costo_ventas, 0), 2) end,
    case when v_costos and coalesce(ve.ingresos, 0) > 0
         then round(((ve.ingresos - coalesce(ve.costo_ventas, 0)) / ve.ingresos * 100)::numeric, 1)
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
    coalesce(ap.atencion, 0)
  from productos_nodo pn
  join public.productos p on p.id = pn.pid
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

-- Verificación (debe dar true). Se prueba desde la app: en el SQL Editor no
-- hay usuario y la función rechaza ("No tenés permiso").
select to_regprocedure('public.fn_mapa_nodo_skus(integer,date,date)') is not null as creada;
