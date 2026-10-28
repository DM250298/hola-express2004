-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 314 · Margen neto de IVA (4/9): fn_resumen_skus v3       ║
-- ║                                                                     ║
-- ║  Base: mig 206 íntegra (mismas 30 columnas, mismo orden). Cambios:  ║
-- ║   · lo vendido y lo devuelto salen de los helpers de la 312;        ║
-- ║   · costo_ventas, margen_pesos y margen_pct pasan a NETO de IVA y   ║
-- ║     de devoluciones (margen % sobre ventas netas);                  ║
-- ║   · tres columnas nuevas AL FINAL, sin gate de costos:              ║
-- ║     ingresos_netos, iva_ventas, devoluciones.                       ║
-- ║  ingresos sigue siendo el bruto vendido (sin restar devoluciones):  ║
-- ║  lo usan el Pareto ABC, la participación y las tarjetas de ventas.  ║
-- ║  Quien hace rs.* (180, 181, 193) no se rompe; la 186 toma columnas  ║
-- ║  explícitas. REQUIERE: mig 312. Ejecutar COMPLETA.                  ║
-- ╚════════════════════════════════════════════════════════════════════╝

drop function if exists public.fn_resumen_skus(date, date);

create function public.fn_resumen_skus(p_desde date, p_hasta date)
returns table (
  producto_id integer,
  nombre text,
  codigo_barras text,
  venta_por_peso boolean,
  activo boolean,
  es_critico boolean,
  marca text,
  categoria text,
  proveedor text,
  gondola text,
  stock_actual numeric,
  stock_minimo numeric,
  unidades_vendidas numeric,
  unidades_via_combo numeric,
  ingresos numeric,
  venta_diaria numeric,
  dias_cobertura numeric,
  ultima_venta timestamptz,
  ultima_compra timestamptz,
  dias_sin_venta integer,
  clase_abc text,
  quiebres_periodo integer,
  venta_perdida_pesos numeric,
  precio_venta numeric,
  costo_actual numeric,
  costo_ventas numeric,
  margen_pesos numeric,
  margen_pct numeric,
  stock_valorizado numeric,
  costo_estimado boolean,
  ingresos_netos numeric,
  iva_ventas numeric,
  devoluciones numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with permiso as (
    select public.fn_tiene_permiso('costos') as ok
  ),
  rango as (
    select
      (p_desde::timestamp) at time zone 'America/Argentina/La_Rioja' as ini,
      ((p_hasta + 1)::timestamp) at time zone 'America/Argentina/La_Rioja' as fin,
      greatest(p_hasta - p_desde + 1, 1) as dias
  ),
  dia as (
    select x.producto_id, x.cantidad, x.bruto, x.neto, x.costo, x.estimado
    from public.fn_items_vendidos_neto(p_desde, p_hasta) x
  ),
  directo as (
    select
      d.producto_id,
      sum(d.cantidad) as unidades,
      sum(d.bruto) as ingresos,
      sum(d.neto) as neto,
      sum(d.costo) as costo_ventas,
      bool_or(d.estimado) as estimado
    from dia d
    group by d.producto_id
  ),
  dev as (
    select x.producto_id,
           sum(x.bruto) as bruto,
           sum(x.neto) as neto,
           sum(x.costo) as costo
    from public.fn_items_devueltos_neto(p_desde, p_hasta) x
    group by x.producto_id
  ),
  via_combo as (
    select pc.componente_id as producto_id,
           sum(d.cantidad * pc.cantidad) as unidades
    from dia d
    join public.producto_componentes pc on pc.producto_id = d.producto_id
    group by pc.componente_id
  ),
  abc as (
    -- Pareto de ingresos BRUTOS del período (misma fórmula que ranking / mig 152).
    select t.producto_id,
           case when t.acum <= 0.80 then 'A'
                when t.acum <= 0.95 then 'B'
                else 'C' end as clase
    from (
      select d2.producto_id,
             sum(d2.ingresos) over (order by d2.ingresos desc, d2.producto_id)
               / nullif(sum(d2.ingresos) over (), 0) as acum
      from (select directo.producto_id, directo.ingresos from directo where directo.ingresos > 0) d2
    ) t
  ),
  kardex as (
    select ms.producto_id,
           max(ms.created_at) filter (where ms.tipo = 'venta') as ultima_venta,
           max(ms.created_at) filter (where ms.tipo = 'entrada') as ultima_compra
    from public.movimientos_stock ms
    where ms.tipo in ('venta', 'entrada')
    group by ms.producto_id
  ),
  quiebres as (
    select q.producto_id,
           count(*)::integer as cantidad,
           sum(coalesce(q.venta_perdida_pesos, 0)) as perdida
    from public.quiebres_stock q
    cross join rango r
    where q.inicio_at < r.fin and coalesce(q.fin_at, now()) >= r.ini
    group by q.producto_id
  ),
  gondola as (
    select pu.producto_id, g.nombre as gondola
    from public.producto_ubicacion pu
    join lateral (
      with recursive cadena as (
        select u.id, u.parent_id, u.tipo, u.nombre
        from public.ubicaciones u where u.id = pu.ubicacion_id
        union all
        select u2.id, u2.parent_id, u2.tipo, u2.nombre
        from public.ubicaciones u2
        join cadena c on c.parent_id = u2.id
      )
      select cadena.nombre from cadena where cadena.tipo = 'gondola' limit 1
    ) g on true
    where pu.es_principal
  )
  select
    p.id as producto_id,
    p.nombre::text,
    p.codigo_barras::text,
    coalesce(p.venta_por_peso, false),
    p.activo,
    coalesce(p.es_critico, false),
    coalesce(m.nombre, nullif(btrim(coalesce(p.marca, '')), ''))::text as marca,
    c.nombre::text as categoria,
    pr.nombre::text as proveedor,
    g.gondola::text,
    p.stock_actual,
    p.stock_minimo,
    coalesce(d.unidades, 0) as unidades_vendidas,
    coalesce(vc.unidades, 0) as unidades_via_combo,
    round(coalesce(d.ingresos, 0), 2) as ingresos,
    round((coalesce(d.unidades, 0) / r.dias)::numeric, 3) as venta_diaria,
    case when coalesce(d.unidades, 0) > 0 and p.stock_actual > 0
         then round((p.stock_actual * r.dias / d.unidades)::numeric, 1)
         else null end as dias_cobertura,
    k.ultima_venta,
    k.ultima_compra,
    case when k.ultima_venta is not null
         then greatest(floor(extract(epoch from now() - k.ultima_venta) / 86400)::integer, 0)
         else null end as dias_sin_venta,
    a.clase::text as clase_abc,
    coalesce(q.cantidad, 0) as quiebres_periodo,
    round(coalesce(q.perdida, 0), 2) as venta_perdida_pesos,
    p.precio_venta,
    case when pm.ok then coalesce(public.fn_costo(p.id), 0) else null end as costo_actual,
    -- Netos: ventas sin IVA y sin devoluciones; costo sin lo devuelto.
    case when pm.ok
         then round(coalesce(d.costo_ventas, 0) - coalesce(dv.costo, 0), 2)
         else null end as costo_ventas,
    case when pm.ok
         then round((coalesce(d.neto, 0) - coalesce(dv.neto, 0))
                    - (coalesce(d.costo_ventas, 0) - coalesce(dv.costo, 0)), 2)
         else null end as margen_pesos,
    case when pm.ok and (coalesce(d.neto, 0) - coalesce(dv.neto, 0)) > 0
         then round((((coalesce(d.neto, 0) - coalesce(dv.neto, 0))
                      - (coalesce(d.costo_ventas, 0) - coalesce(dv.costo, 0)))
                     / (coalesce(d.neto, 0) - coalesce(dv.neto, 0)) * 100)::numeric, 1)
         else null end as margen_pct,
    case when pm.ok
         then round(p.stock_actual * coalesce(public.fn_costo(p.id), 0), 2)
         else null end as stock_valorizado,
    coalesce(d.estimado, false) as costo_estimado,
    round(coalesce(d.neto, 0) - coalesce(dv.neto, 0), 2) as ingresos_netos,
    round((coalesce(d.ingresos, 0) - coalesce(dv.bruto, 0))
          - (coalesce(d.neto, 0) - coalesce(dv.neto, 0)), 2) as iva_ventas,
    round(coalesce(dv.bruto, 0), 2) as devoluciones
  from public.productos p
  cross join permiso pm
  cross join rango r
  left join public.marcas m on m.id = p.marca_id
  left join public.categorias c on c.id = p.categoria_id
  left join public.proveedores pr on pr.id = p.proveedor_id
  left join directo d on d.producto_id = p.id
  left join dev dv on dv.producto_id = p.id
  left join via_combo vc on vc.producto_id = p.id
  left join abc a on a.producto_id = p.id
  left join kardex k on k.producto_id = p.id
  left join quiebres q on q.producto_id = p.id
  left join gondola g on g.producto_id = p.id
  where p.activo
  order by coalesce(d.ingresos, 0) desc, p.id
$$;

revoke execute on function public.fn_resumen_skus(date, date) from public, anon;
grant execute on function public.fn_resumen_skus(date, date) to authenticated;

notify pgrst, 'reload schema';
