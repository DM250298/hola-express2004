-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 180 · Tablero del dueño (2/3): métricas por dimensión    ║
-- ║                                                                     ║
-- ║  fn_metricas_agrupadas(p_dimension, p_desde, p_hasta): agrupa la    ║
-- ║  tabla-madre fn_resumen_skus (mig 178) por categoria | marca |      ║
-- ║  proveedor | gondola | clase_abc. Es la pieza que hace de la        ║
-- ║  góndola UNA dimensión más y no el centro del sistema: sumar una    ║
-- ║  dimensión nueva nunca pide una tabla nueva.                        ║
-- ║                                                                     ║
-- ║  Devuelve MARGEN COMERCIAL (ingresos − costo de lo vendido) y       ║
-- ║  capital invertido (stock valorizado). NO es rentabilidad: no se    ║
-- ║  prorratean costos compartidos (alquiler, sueldos).                 ║
-- ║                                                                     ║
-- ║  Stock y "sin movimiento" cuentan solo productos STOCKEABLES        ║
-- ║  (controlar_stock y no combo): el stock de un combo es virtual y el ║
-- ║  de un producto sin control no se mantiene.                         ║
-- ║                                                                     ║
-- ║  Dimensión inválida → 0 filas. Gate de costos heredado de           ║
-- ║  fn_resumen_skus: sin permiso 'costos' las columnas vienen NULL.    ║
-- ║                                                                     ║
-- ║  REQUIERE: mig 178. Ejecutar UNA sola vez, COMPLETO.                ║
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
  costo_estimado boolean
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
    case when a.ing > 0 and a.mar is not null
         then round((a.mar / a.ing * 100)::numeric, 1) end,
    case when a.mar is not null
         then round((a.mar / nullif(sum(a.mar) over (), 0) * 100)::numeric, 1) end,
    round(a.stock_val, 2),
    case when coalesce(a.cos, 0) > 0 and a.stock_val is not null
         then round((a.stock_val / (a.cos / greatest(p_hasta - p_desde + 1, 1)))::numeric, 1) end,
    a.n_quiebres,
    round(a.perdida, 2),
    a.est
  from agg a
  order by a.ing desc nulls last, a.grupo
$$;

revoke execute on function public.fn_metricas_agrupadas(text, date, date) from public, anon;
grant execute on function public.fn_metricas_agrupadas(text, date, date) to authenticated;

notify pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────────
-- Verificación:
--   select clave, skus, ingresos, participacion_ingresos
--   from public.fn_metricas_agrupadas('categoria', current_date - 30, current_date)
--   limit 10;
--   → Σ participacion_ingresos ≈ 100. (Margen NULL en el SQL Editor: ahí
--     no hay usuario logueado; se ve en la app como admin.)
-- ─────────────────────────────────────────────────────────────────────
