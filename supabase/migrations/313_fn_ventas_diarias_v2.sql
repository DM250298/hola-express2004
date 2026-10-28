-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 313 · Margen neto de IVA (3/9): fn_ventas_diarias v2     ║
-- ║                                                                     ║
-- ║  Base: mig 179. Por día del período: ventas (lo cobrado, con IVA),  ║
-- ║  tickets, ingresos brutos por ítem, y ahora también ingresos netos  ║
-- ║  de IVA y de devoluciones, IVA, devoluciones y costo de ventas neto ║
-- ║  de devoluciones. Lee de los helpers de la 312.                     ║
-- ║                                                                     ║
-- ║  Conserva los nombres viejos (ventas, tickets, ingresos,            ║
-- ║  costo_ventas, estimado): fn_tablero_gerencial v2 (217) sigue       ║
-- ║  funcionando hasta que se corra la 318. Helper INTERNO.             ║
-- ║  REQUIERE: mig 312. Ejecutar COMPLETA.                              ║
-- ╚════════════════════════════════════════════════════════════════════╝

drop function if exists public.fn_ventas_diarias(date, date);

create function public.fn_ventas_diarias(p_desde date, p_hasta date)
returns table (
  dia date,
  ventas numeric,
  tickets integer,
  ingresos numeric,
  ingresos_netos numeric,
  iva numeric,
  devoluciones numeric,
  costo_ventas numeric,
  estimado boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with rango as (
    select
      (p_desde::timestamp) at time zone 'America/Argentina/La_Rioja' as ini,
      ((p_hasta + 1)::timestamp) at time zone 'America/Argentina/La_Rioja' as fin
  ),
  cab as (
    select (v.fecha at time zone 'America/Argentina/La_Rioja')::date as d,
           sum(v.total) as ventas,
           count(*)::integer as tickets
    from public.ventas v
    cross join rango r
    where v.estado = 'completada' and v.fecha >= r.ini and v.fecha < r.fin
    group by 1
  ),
  it as (
    select x.dia as d,
           sum(x.bruto) as bruto,
           sum(x.neto) as neto,
           sum(x.costo) as costo,
           bool_or(x.estimado) as est
    from public.fn_items_vendidos_neto(p_desde, p_hasta) x
    group by x.dia
  ),
  dev as (
    select x.dia as d,
           sum(x.bruto) as bruto,
           sum(x.neto) as neto,
           sum(x.costo) as costo
    from public.fn_items_devueltos_neto(p_desde, p_hasta) x
    group by x.dia
  ),
  dias as (
    select c.d from cab c
    union
    select i.d from it i
    union
    select x.d from dev x
  )
  select
    ds.d,
    coalesce(c.ventas, 0),
    coalesce(c.tickets, 0),
    round(coalesce(i.bruto, 0), 2),
    round(coalesce(i.neto, 0) - coalesce(x.neto, 0), 2),
    round((coalesce(i.bruto, 0) - coalesce(x.bruto, 0))
          - (coalesce(i.neto, 0) - coalesce(x.neto, 0)), 2),
    round(coalesce(x.bruto, 0), 2),
    round(coalesce(i.costo, 0) - coalesce(x.costo, 0), 2),
    coalesce(i.est, false)
  from dias ds
  left join cab c on c.d = ds.d
  left join it i on i.d = ds.d
  left join dev x on x.d = ds.d
  order by 1
$$;

revoke execute on function public.fn_ventas_diarias(date, date) from public, anon, authenticated;

notify pgrst, 'reload schema';

-- Verificación (en el SQL Editor, como postgres):
--   select * from public.fn_ventas_diarias(current_date - 7, current_date);
--   Por día: ingresos ≈ ingresos_netos + iva + devoluciones.
