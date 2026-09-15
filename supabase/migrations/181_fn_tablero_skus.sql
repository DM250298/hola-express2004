-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 181 · Tablero del dueño (3/4): bloque por producto       ║
-- ║                                                                     ║
-- ║  fn_tablero_skus(p_desde, p_hasta) → jsonb con la parte del         ║
-- ║  tablero que sale de fn_resumen_skus (mig 178), evaluada UNA vez:   ║
-- ║   · inventario: valorizado a costo, días de inventario, capital     ║
-- ║     inmovilizado (+45 días sin vender).                             ║
-- ║   · top 10 productos por margen y cuántos explican el 80 %.         ║
-- ║   · góndolas por margen.                                            ║
-- ║   · situaciones que piden intervención, agrupadas por categoría.    ║
-- ║                                                                     ║
-- ║  Helper INTERNO de fn_tablero_gerencial (mig 182): sin grant a      ║
-- ║  authenticated. Separado en su propia migración para que cada       ║
-- ║  archivo sea corto de pegar en el SQL Editor.                       ║
-- ║                                                                     ║
-- ║  Stock, inmovilizado y "sin stock" cuentan solo productos           ║
-- ║  STOCKEABLES (controlar_stock y no combo).                          ║
-- ║                                                                     ║
-- ║  REQUIERE: mig 178. Ejecutar UNA sola vez, COMPLETO.                ║
-- ╚════════════════════════════════════════════════════════════════════╝

drop function if exists public.fn_tablero_skus(date, date);

create function public.fn_tablero_skus(p_desde date, p_hasta date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_costos boolean := public.fn_tiene_permiso('costos');
  v_dias integer := greatest(p_hasta - p_desde + 1, 1);
  v_resultado jsonb;
begin
  with r as materialized (
    select
      rs.*,
      coalesce(p.controlar_stock, true)
        and not exists (
          select 1 from public.producto_componentes pc where pc.producto_id = rs.producto_id
        ) as stockeable,
      -- Días quieto: desde la última venta; si nunca vendió, desde la última
      -- compra (un producto recién recibido no está inmovilizado).
      coalesce(
        rs.dias_sin_venta,
        floor(extract(epoch from now() - rs.ultima_compra) / 86400)::integer,
        9999
      ) as dias_quieto
    from public.fn_resumen_skus(p_desde, p_hasta) rs
    join public.productos p on p.id = rs.producto_id
  ),
  inv as (
    select
      sum(r.stock_valorizado) filter (where r.stockeable and r.stock_actual > 0) as valorizado,
      sum(r.stock_valorizado) filter (
        where r.stockeable and r.stock_actual > 0 and r.dias_quieto > 45
      ) as inmovilizado,
      count(*) filter (
        where r.stockeable and r.stock_actual > 0 and r.dias_quieto > 45
      )::integer as skus_inmov,
      sum(r.costo_ventas) as costo_periodo
    from r
  ),
  ranking_base as (
    select r.producto_id, r.nombre, r.ingresos, r.margen_pesos, r.margen_pct,
           case when v_costos then r.margen_pesos else r.ingresos end as valor
    from r
    where (case when v_costos then r.margen_pesos else r.ingresos end) > 0
  ),
  ranking as (
    select rb.*,
           sum(rb.valor) over (order by rb.valor desc, rb.producto_id) as acum,
           row_number() over (order by rb.valor desc, rb.producto_id) as pos
    from ranking_base rb
  ),
  tot as (
    select coalesce(sum(rb.valor), 0) as total, count(*)::integer as cantidad
    from ranking_base rb
  ),
  gond as (
    select
      r.gondola as nombre_gondola,
      count(*)::integer as n_skus,
      sum(r.ingresos) as ing,
      sum(r.margen_pesos) as mar,
      sum(r.stock_valorizado) filter (where r.stockeable and r.stock_actual > 0) as stock_val,
      sum(r.quiebres_periodo)::integer as n_quiebres,
      count(*) filter (
        where r.stockeable and r.stock_actual > 0
          and r.unidades_vendidas = 0 and r.unidades_via_combo = 0
      )::integer as sin_mov
    from r
    where r.gondola is not null
    group by r.gondola
  ),
  crit as (
    select coalesce(r.categoria, 'Sin categoría') as cat, count(*)::integer as cant
    from r
    where r.stockeable and r.stock_actual <= 0 and (r.es_critico or r.clase_abc = 'A')
    group by 1
  ),
  pq as (
    select coalesce(r.categoria, 'Sin categoría') as cat, count(*)::integer as cant
    from r
    where r.stockeable and r.stock_actual > 0 and r.clase_abc = 'A' and r.dias_cobertura < 3
    group by 1
  )
  select jsonb_build_object(
    'inventario', jsonb_build_object(
      'valorizado', case when v_costos then round(coalesce(inv.valorizado, 0), 2) end,
      'inmovilizado', case when v_costos then round(coalesce(inv.inmovilizado, 0), 2) end,
      'skus_inmovilizados', inv.skus_inmov,
      'dias_inventario', case when v_costos and coalesce(inv.costo_periodo, 0) > 0
        then round((coalesce(inv.valorizado, 0) / (inv.costo_periodo / v_dias))::numeric, 1) end
    ),
    'top_skus', coalesce((
      select jsonb_agg(jsonb_build_object(
               'producto_id', rk.producto_id,
               'nombre', rk.nombre,
               'valor', round(rk.valor, 2),
               'ingresos', rk.ingresos,
               'margen_pesos', rk.margen_pesos,
               'margen_pct', rk.margen_pct,
               'participacion', round((rk.valor / nullif(tt.total, 0) * 100)::numeric, 1)
             ) order by rk.pos)
      from ranking rk cross join tot tt
      where rk.pos <= 10
    ), '[]'::jsonb),
    'concentracion', (
      select jsonb_build_object(
               'skus_80', count(*) filter (where rk.acum - rk.valor < 0.8 * tt.total),
               'skus_total', coalesce(max(tt.cantidad), 0),
               'criterio', case when v_costos then 'margen' else 'ingresos' end)
      from ranking rk cross join tot tt
    ),
    'gondolas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'nombre', g.nombre_gondola,
               'skus', g.n_skus,
               'ingresos', round(coalesce(g.ing, 0), 2),
               'margen', case when v_costos then round(g.mar, 2) end,
               'margen_pct', case when v_costos and g.ing > 0
                                  then round((g.mar / g.ing * 100)::numeric, 1) end,
               'stock_valorizado', case when v_costos then round(coalesce(g.stock_val, 0), 2) end,
               'quiebres', g.n_quiebres,
               'sin_movimiento', g.sin_mov
             ) order by (case when v_costos then g.mar else g.ing end) desc nulls last,
                        g.nombre_gondola)
      from gond g
    ), '[]'::jsonb),
    'situaciones', jsonb_build_object(
      'criticos_sin_stock', jsonb_build_object(
        'cantidad', coalesce((select sum(c.cant) from crit c), 0),
        'por_categoria', coalesce((
          select jsonb_agg(jsonb_build_object('categoria', c3.cat, 'cantidad', c3.cant)
                           order by c3.cant desc, c3.cat)
          from (select c.cat, c.cant from crit c order by c.cant desc, c.cat limit 3) c3
        ), '[]'::jsonb)
      ),
      'a_por_quebrar', jsonb_build_object(
        'cantidad', coalesce((select sum(q.cant) from pq q), 0),
        'por_categoria', coalesce((
          select jsonb_agg(jsonb_build_object('categoria', q3.cat, 'cantidad', q3.cant)
                           order by q3.cant desc, q3.cat)
          from (select q.cat, q.cant from pq q order by q.cant desc, q.cat limit 3) q3
        ), '[]'::jsonb)
      ),
      'margen_negativo', jsonb_build_object(
        'cantidad', case when v_costos
                         then (select count(*) from r where r.ingresos > 0 and r.margen_pesos < 0)
                    end
      )
    )
  )
  into v_resultado
  from inv;

  return v_resultado;
end;
$$;

revoke execute on function public.fn_tablero_skus(date, date) from public, anon, authenticated;

notify pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────────
-- Verificación: se prueba junto con la mig 182, desde la app (/tablero).
-- Chequeo rápido de que existe:
--   select to_regprocedure('public.fn_tablero_skus(date,date)') is not null;
-- ─────────────────────────────────────────────────────────────────────
