-- Vista de cobertura de stock por producto
-- Calcula, para cada producto activo:
--   ventas_14d      → total vendido en los últimos 14 días (cantidad)
--   promedio_diario → promedio diario de ventas (ventas_14d / 14)
--   dias_cobertura  → stock_actual / promedio_diario (NULL si no hubo ventas)
--   serie_14d       → array jsonb de 14 valores (uno por día, antiguo → reciente)
--
-- Se usa para mostrar "días de cobertura" como métrica accionable en la tabla
-- de stock (más útil que el stock_minimo fijo) y un sparkline de tendencia.

drop view if exists public.vista_cobertura_stock;

create view public.vista_cobertura_stock as
with serie as (
  -- 14 días terminados en hoy (inclusive)
  select generate_series(
    (current_date - interval '13 days')::date,
    current_date,
    interval '1 day'
  )::date as dia
),
ventas_por_dia as (
  select
    iv.producto_id,
    (v.fecha at time zone 'America/Argentina/La_Rioja')::date as dia,
    sum(iv.cantidad)::numeric as cantidad
  from public.items_venta iv
  join public.ventas v on v.id = iv.venta_id
  where v.estado = 'completada'
    and v.fecha >= (current_date - interval '13 days')::timestamptz
  group by iv.producto_id, (v.fecha at time zone 'America/Argentina/La_Rioja')::date
),
productos_dias as (
  -- Cross join solo de productos con ventas en el período × serie de fechas,
  -- para que la serie quede completa de 14 valores aun en días sin venta.
  select distinct vd.producto_id, s.dia
  from ventas_por_dia vd
  cross join serie s
),
combinado as (
  select
    pd.producto_id,
    pd.dia,
    coalesce(vd.cantidad, 0)::numeric as cantidad
  from productos_dias pd
  left join ventas_por_dia vd
    on vd.producto_id = pd.producto_id
   and vd.dia = pd.dia
),
agregado as (
  select
    producto_id,
    sum(cantidad)::numeric as ventas_14d,
    round((sum(cantidad) / 14.0)::numeric, 3) as promedio_diario,
    jsonb_agg(cantidad::numeric order by dia) as serie_14d
  from combinado
  group by producto_id
)
select
  p.id as producto_id,
  p.stock_actual,
  coalesce(a.ventas_14d, 0)::numeric as ventas_14d,
  coalesce(a.promedio_diario, 0)::numeric as promedio_diario,
  case
    when coalesce(a.promedio_diario, 0) = 0 then null
    else round((p.stock_actual / a.promedio_diario)::numeric, 1)
  end as dias_cobertura,
  coalesce(
    a.serie_14d,
    '[0,0,0,0,0,0,0,0,0,0,0,0,0,0]'::jsonb
  ) as serie_14d
from public.productos p
left join agregado a on a.producto_id = p.id
where p.activo = true;

comment on view public.vista_cobertura_stock is
  'Cobertura de stock por producto activo. Calcula días de cobertura y serie de ventas últimos 14 días.';

-- Reload PostgREST schema cache para que el cliente vea la vista.
notify pgrst, 'reload schema';
