-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Contraste del Tablero del dueño · 1/5 · VENTAS (solo lectura)      ║
-- ║                                                                     ║
-- ║  Recalcula desde la tabla `ventas` (sin usar las funciones del      ║
-- ║  tablero) las tarjetas Hoy, Ayer, Últimos 7 días, Mes en curso y    ║
-- ║  Ventas del período, con la misma regla que el tablero: ventas en   ║
-- ║  estado 'completada', por día local de La Rioja, con IVA incluido.  ║
-- ║  Además controla que cada venta cuadre con sus ítems y sus pagos.   ║
-- ║                                                                     ║
-- ║  Correr en el SQL Editor del proyecto de PRODUCCIÓN (HEX-V1).       ║
-- ║  Las fechas del período se cambian en `params`. No modifica nada.   ║
-- ║  Última línea del archivo: "order by orden;"                        ║
-- ╚════════════════════════════════════════════════════════════════════╝

with params as (
  -- ▼ Período a contrastar. Con "Este mes" el tablero usa del 1° a hoy.
  --   Para otro período reemplazá por fechas fijas: date '2026-10-01', date '2026-10-31'.
  select date_trunc('month', h.hoy)::date as desde, h.hoy as hasta, h.hoy
  from (select (now() at time zone 'America/Argentina/La_Rioja')::date as hoy) h
),
periodo as (
  -- Período anterior con la regla de la mig 217: si arranca el 1° se compara
  -- contra el MISMO TRAMO del mes anterior; si no, contra los N días previos.
  select p.*,
         case when extract(day from p.desde) = 1
              then (p.desde - interval '1 month')::date
              else p.desde - (p.hasta - p.desde + 1) end as ant_desde,
         case when extract(day from p.desde) = 1
              then least((p.desde - interval '1 month')::date + (p.hasta - p.desde), p.desde - 1)
              else p.desde - 1 end as ant_hasta,
         date_trunc('month', p.hoy)::date as ini_mes,
         (date_trunc('month', p.hoy) - interval '1 month')::date as ini_mes_ant
  from params p
),
v as (
  select x.id, x.total, x.estado,
         (x.fecha at time zone 'America/Argentina/La_Rioja')::date as dia
  from public.ventas x
),
ok as (select * from v where estado = 'completada'),
agg as (
  select
    coalesce(sum(o.total) filter (where o.dia = p.hoy), 0)                                  as hoy,
    count(*)              filter (where o.dia = p.hoy)                                      as hoy_t,
    coalesce(sum(o.total) filter (where o.dia = p.hoy - 1), 0)                              as ayer,
    coalesce(sum(o.total) filter (where o.dia = p.hoy - 8), 0)                              as ayer_sem,
    coalesce(sum(o.total) filter (where o.dia between p.hoy - 6 and p.hoy), 0)              as sem,
    coalesce(sum(o.total) filter (where o.dia between p.hoy - 13 and p.hoy - 7), 0)         as sem_ant,
    coalesce(sum(o.total) filter (where o.dia between p.ini_mes and p.hoy), 0)              as mes,
    coalesce(sum(o.total) filter (where o.dia between p.ini_mes_ant
                                    and least(p.ini_mes_ant + (p.hoy - p.ini_mes), p.ini_mes - 1)), 0) as mes_ant,
    coalesce(sum(o.total) filter (where o.dia between p.desde and p.hasta), 0)              as per,
    count(*)              filter (where o.dia between p.desde and p.hasta)                  as per_t,
    coalesce(sum(o.total) filter (where o.dia between p.ant_desde and p.ant_hasta), 0)      as per_ant
  from periodo p
  left join ok o on true
  group by p.hoy, p.ini_mes, p.ini_mes_ant, p.desde, p.hasta, p.ant_desde, p.ant_hasta
),
it as (select iv.venta_id, sum(iv.subtotal) as s from public.items_venta iv group by 1),
pg as (select pv.venta_id, sum(pv.monto) as s from public.pagos_venta pv group by 1),
chk as (
  select
    count(*) filter (where abs(o.total - coalesce(it.s, 0)) > 0.01)            as dif_items,
    coalesce(sum(o.total - coalesce(it.s, 0))
             filter (where abs(o.total - coalesce(it.s, 0)) > 0.01), 0)        as dif_items_pesos,
    count(*) filter (where pg.venta_id is null)                                 as sin_pagos,
    count(*) filter (where pg.venta_id is not null and abs(o.total - pg.s) > 0.01) as dif_pagos
  from ok o
  cross join periodo p
  left join it on it.venta_id = o.id
  left join pg on pg.venta_id = o.id
  where o.dia between p.desde and p.hasta
),
anul as (
  select count(*) as n, coalesce(sum(x.total), 0) as s
  from v x cross join periodo p
  where x.estado = 'anulada' and x.dia between p.desde and p.hasta
),
filas (orden, concepto, valor, detalle) as (
  select 1, 'Período contrastado', null::numeric,
         p.desde::text || ' a ' || p.hasta::text || ' (hoy en La Rioja: ' || p.hoy::text || ')'
  from periodo p
  union all
  select 10, 'Tarjeta HOY ($)', round(a.hoy, 2), a.hoy_t::text || ' tickets' from agg a
  union all
  select 11, 'Tarjeta AYER ($)', round(a.ayer, 2),
         'vs mismo día semana pasada (' || round(a.ayer_sem, 2)::text || '): ' ||
         case when a.ayer_sem > 0 then round((a.ayer / a.ayer_sem - 1) * 100, 1)::text || ' %' else 'sin base' end
  from agg a
  union all
  select 12, 'Tarjeta ÚLTIMOS 7 DÍAS ($)', round(a.sem, 2),
         'vs 7 días previos (' || round(a.sem_ant, 2)::text || '): ' ||
         case when a.sem_ant > 0 then round((a.sem / a.sem_ant - 1) * 100, 1)::text || ' %' else 'sin base' end
  from agg a
  union all
  select 13, 'Tarjeta MES EN CURSO ($)', round(a.mes, 2),
         'vs mismo tramo mes pasado (' || round(a.mes_ant, 2)::text || '): ' ||
         case when a.mes_ant > 0 then round((a.mes / a.mes_ant - 1) * 100, 1)::text || ' %' else 'sin base' end
  from agg a
  union all
  select 20, 'Tarjeta VENTAS del período ($)', round(a.per, 2),
         a.per_t::text || ' tickets · ticket promedio ' ||
         case when a.per_t > 0 then round(a.per / a.per_t, 2)::text else '0' end ||
         ' · vs período anterior (' || round(a.per_ant, 2)::text || '): ' ||
         case when a.per_ant > 0 then round((a.per / a.per_ant - 1) * 100, 1)::text || ' %' else 'sin base' end
  from agg a
  union all
  select 30, 'Ventas ANULADAS en el período (no están en el tablero)', round(x.s, 2),
         x.n::text || ' ventas anuladas: el tablero las excluye por completo'
  from anul x
  union all
  select 40, 'CONTROL: ventas cuyo total no coincide con sus ítems', c.dif_items,
         'tiene que dar 0 · diferencia acumulada $ ' || round(c.dif_items_pesos, 2)::text
  from chk c
  union all
  select 41, 'CONTROL: ventas sin ningún pago registrado', c.sin_pagos,
         'tiene que dar 0 (toda venta del POS graba pagos_venta)'
  from chk c
  union all
  select 42, 'CONTROL: ventas cuyos pagos no suman el total', c.dif_pagos,
         'tiene que dar 0'
  from chk c
)
select orden, concepto, valor, detalle
from filas
order by orden;
