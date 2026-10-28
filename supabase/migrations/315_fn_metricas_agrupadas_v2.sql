-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 315 · Margen neto de IVA (5/9): fn_metricas_agrupadas v2 ║
-- ║                                                                     ║
-- ║  Base: mig 180. Agrupa fn_resumen_skus v3 (314) por categoría,      ║
-- ║  marca, proveedor, góndola o clase ABC. margen_pesos ya viene neto; ║
-- ║  margen_pct pasa a calcularse sobre las ventas netas. Tres columnas ║
-- ║  nuevas AL FINAL: ingresos_netos, iva_ventas, devoluciones.         ║
-- ║  ingresos y participacion_ingresos siguen sobre el bruto vendido.   ║
-- ║  REQUIERE: mig 314. Ejecutar COMPLETA.                              ║
-- ╚════════════════════════════════════════════════════════════════════╝

drop function if exists public.fn_metricas_agrupadas(text, date, date);

create function public.fn_metricas_agrupadas(
  p_dimension text,
  p_desde date,
  p_hasta date
)
returns table (
  clave text,
  skus integer,
  skus_con_venta integer,
  skus_sin_movimiento integer,
  ingresos numeric,
  participacion_ingresos numeric,
  costo_ventas numeric,
  margen_pesos numeric,
  margen_pct numeric,
  participacion_margen numeric,
  stock_valorizado numeric,
  dias_inventario numeric,
  quiebres integer,
  venta_perdida_pesos numeric,
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
  with r as (
    select
      rs.*,
      coalesce(p.controlar_stock, true)
        and not exists (
          select 1 from public.producto_componentes pc where pc.producto_id = rs.producto_id
        ) as stockeable
    from public.fn_resumen_skus(p_desde, p_hasta) rs
    join public.productos p on p.id = rs.producto_id
    where p_dimension in ('categoria', 'marca', 'proveedor', 'gondola', 'clase_abc')
  ),
  d as (
    select
      case p_dimension
        when 'categoria' then coalesce(r.categoria, 'Sin categoría')
        when 'marca'     then coalesce(r.marca, 'Sin marca')
        when 'proveedor' then coalesce(r.proveedor, 'Sin proveedor')
        when 'gondola'   then coalesce(r.gondola, 'Sin ubicar')
        when 'clase_abc' then coalesce(r.clase_abc, 'Sin ventas')
      end as grupo,
      r.*
    from r
  ),
  agg as (
    select
      d.grupo,
      count(*)::integer as n_skus,
      count(*) filter (where d.ingresos > 0)::integer as n_con_venta,
      count(*) filter (
        where d.stockeable and d.stock_actual > 0
          and d.unidades_vendidas = 0 and d.unidades_via_combo = 0
      )::integer as n_sin_mov,
      sum(d.ingresos) as ing,
      sum(d.ingresos_netos) as ing_neto,
      sum(d.iva_ventas) as iva,
      sum(d.devoluciones) as dev,
      sum(d.costo_ventas) as cos,
      sum(d.margen_pesos) as mar,
      sum(d.stock_valorizado) filter (where d.stockeable and d.stock_actual > 0) as stock_val,
      sum(d.quiebres_periodo)::integer as n_quiebres,
      sum(d.venta_perdida_pesos) as perdida,
      coalesce(bool_or(d.costo_estimado and d.ingresos > 0), false) as est
    from d
    group by d.grupo
  )
  select
    a.grupo,
    a.n_skus,
    a.n_con_venta,
    a.n_sin_mov,
    round(a.ing, 2),
    round((a.ing / nullif(sum(a.ing) over (), 0) * 100)::numeric, 1),
    round(a.cos, 2),
    round(a.mar, 2),
    case when a.ing_neto > 0 and a.mar is not null
         then round((a.mar / a.ing_neto * 100)::numeric, 1) end,
    case when a.mar is not null
         then round((a.mar / nullif(sum(a.mar) over (), 0) * 100)::numeric, 1) end,
    round(a.stock_val, 2),
    case when coalesce(a.cos, 0) > 0 and a.stock_val is not null
         then round((a.stock_val / (a.cos / greatest(p_hasta - p_desde + 1, 1)))::numeric, 1) end,
    a.n_quiebres,
    round(a.perdida, 2),
    a.est,
    round(a.ing_neto, 2),
    round(a.iva, 2),
    round(a.dev, 2)
  from agg a
  order by a.ing desc nulls last, a.grupo
$$;

revoke execute on function public.fn_metricas_agrupadas(text, date, date) from public, anon;
grant execute on function public.fn_metricas_agrupadas(text, date, date) to authenticated;

notify pgrst, 'reload schema';
