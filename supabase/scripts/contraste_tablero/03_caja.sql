-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Contraste del Tablero del dueño · 3/5 · CONTRA LA CAJA FÍSICA     ║
-- ║                                                                     ║
-- ║  Las ventas del tablero son lo que el POS registró. Este script     ║
-- ║  las cruza con el mundo físico: los cierres de turno (lo que el     ║
-- ║  cajero CONTÓ contra lo que el sistema esperaba), lo cobrado por    ║
-- ║  medio de pago (para cruzar con el reporte de Mercado Pago y el     ║
-- ║  extracto del banco) y las devoluciones. Si los cierres cuadran y   ║
-- ║  MP coincide, la tarjeta Ventas es real.                            ║
-- ║                                                                     ║
-- ║  Correr en el SQL Editor de PRODUCCIÓN (HEX-V1). No modifica nada.  ║
-- ║  Última línea del archivo: "order by orden;"                        ║
-- ╚════════════════════════════════════════════════════════════════════╝

with params as (
  -- ▼ Período a contrastar (mismo criterio que 01_ventas.sql).
  select date_trunc('month', h.hoy)::date as desde, h.hoy as hasta
  from (select (now() at time zone 'America/Argentina/La_Rioja')::date as hoy) h
),
rango as (
  select (p.desde::timestamp) at time zone 'America/Argentina/La_Rioja' as ini,
         ((p.hasta + 1)::timestamp) at time zone 'America/Argentina/La_Rioja' as fin
  from params p
),
turnos as (
  select t.id, t.estado, t.fecha_apertura, t.fecha_cierre,
         t.monto_apertura, t.monto_cierre_esperado, t.monto_cierre_real, t.diferencia
  from public.caja_turnos t
  cross join rango r
  where coalesce(t.fecha_cierre, t.fecha_apertura) >= r.ini
    and coalesce(t.fecha_cierre, t.fecha_apertura) < r.fin
),
cer as (
  select count(*) as n,
         coalesce(sum(monto_cierre_esperado), 0) as esperado,
         coalesce(sum(monto_cierre_real), 0) as contado,
         coalesce(sum(diferencia), 0) as diferencia,
         coalesce(max(abs(diferencia)), 0) as max_dif,
         count(*) filter (where diferencia is null) as sin_conteo
  from turnos
  where estado = 'cerrado'
),
peores as (
  select string_agg(
           'turno ' || x.id::text || ' (' || to_char(x.fecha_cierre at time zone 'America/Argentina/La_Rioja', 'DD/MM HH24:MI') ||
           '): ' || round(x.diferencia, 2)::text,
           ' · ' order by abs(x.diferencia) desc) as lista
  from (
    select * from turnos
    where estado = 'cerrado' and diferencia is not null
    order by abs(diferencia) desc
    limit 5
  ) x
),
abiertos as (
  select count(*) as n, min(fecha_apertura) as desde
  from public.caja_turnos
  where estado = 'abierto'
),
pagos as (
  select pv.medio_pago, sum(pv.monto) as s, count(distinct pv.venta_id) as n
  from public.pagos_venta pv
  join public.ventas v on v.id = pv.venta_id
  cross join rango r
  where v.estado = 'completada' and v.fecha >= r.ini and v.fecha < r.fin
  group by pv.medio_pago
),
devs as (
  select count(*) as n, coalesce(sum(dv.total_devuelto), 0) as s,
         string_agg(dv.tipo_reembolso::text || ': ' || dv.n::text, ' · ') as por_tipo
  from (
    select d.tipo_reembolso, count(*) as n, sum(d.total_devuelto) as total_devuelto
    from public.devoluciones d
    cross join rango r
    where d.created_at >= r.ini and d.created_at < r.fin
    group by d.tipo_reembolso
  ) dv
),
filas (orden, concepto, valor, detalle) as (
  select 1::bigint, 'Período contrastado', null::numeric, p.desde::text || ' a ' || p.hasta::text from params p
  union all
  select 10, 'Turnos de caja CERRADOS en el período', c.n,
         'esperado por el sistema $ ' || round(c.esperado, 2)::text ||
         ' · contado por los cajeros $ ' || round(c.contado, 2)::text ||
         ' · diferencia acumulada $ ' || round(c.diferencia, 2)::text ||
         case when c.sin_conteo > 0 then ' · ' || c.sin_conteo::text || ' sin conteo cargado' else '' end
  from cer c
  union all
  select 11, 'Mayor diferencia en un solo cierre ($)', round(c.max_dif, 2),
         coalesce('peores 5: ' || p.lista, 'sin cierres con conteo en el período')
  from cer c cross join peores p
  union all
  select 12, 'Turnos ABIERTOS ahora', a.n,
         case when a.n > 0
              then 'las ventas de hoy todavía no se contrastaron con un conteo (abierto desde ' ||
                   to_char(a.desde at time zone 'America/Argentina/La_Rioja', 'DD/MM HH24:MI') || ')'
              else 'ninguno' end
  from abiertos a
  union all
  select 20 + row_number() over (order by pg.s desc), 'Cobrado con ' || pg.medio_pago, round(pg.s, 2),
         pg.n::text || ' ventas · tarjeta/QR: cruzar con el reporte de Mercado Pago; efectivo: con los cierres'
  from pagos pg
  union all
  select 40, 'Total cobrado en el período (suma de pagos)', round(coalesce(sum(pg.s), 0), 2),
         'tiene que coincidir con la tarjeta Ventas del período'
  from pagos pg
  union all
  select 50, 'Devoluciones del período ($ devuelto)', round(d.s, 2),
         d.n::text || ' devoluciones' || coalesce(' · ' || d.por_tipo, '')
  from devs d
)
select orden, concepto, valor, detalle
from filas
order by orden;
