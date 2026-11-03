-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Contraste del Tablero del dueño · 5/5 · QUIEBRES Y ALERTAS        ║
-- ║                                                                     ║
-- ║  Recalcula la tarjeta "Quiebres de stock" desde `quiebres_stock`    ║
-- ║  (eventos que abre y cierra el trigger del kardex) y la cruza con   ║
-- ║  lo que dice `productos.stock_actual`. Recalcula las horas sin      ║
-- ║  stock y la venta perdida (que es una ESTIMACIÓN por diseño), los   ║
-- ║  lotes por vencer y el bloque "Requiere intervención", que sale de  ║
-- ║  las alertas abiertas por regla (foto de la última evaluación).     ║
-- ║                                                                     ║
-- ║  Correr en el SQL Editor de PRODUCCIÓN (HEX-V1). No modifica nada.  ║
-- ║  Última línea del archivo: "order by orden;"                        ║
-- ╚════════════════════════════════════════════════════════════════════╝

with params as (
  -- ▼ Período a contrastar (mismo criterio que 01_ventas.sql).
  select date_trunc('month', h.hoy)::date as desde, h.hoy as hasta, h.hoy
  from (select (now() at time zone 'America/Argentina/La_Rioja')::date as hoy) h
),
rango as (
  select (p.desde::timestamp) at time zone 'America/Argentina/La_Rioja' as ini,
         least(((p.hasta + 1)::timestamp) at time zone 'America/Argentina/La_Rioja', now()) as fin
  from params p
),
qa as (
  select q.id, q.producto_id, q.inicio_at, p.stock_actual, p.activo,
         coalesce(p.es_critico, false) as es_critico,
         coalesce(p.controlar_stock, true) as cs,
         (select m.clase_abc from public.metricas_sku_diarias m
          where m.producto_id = q.producto_id order by m.fecha desc limit 1) as clase
  from public.quiebres_stock q
  join public.productos p on p.id = q.producto_id
  where q.fin_at is null
),
act as (
  select count(*) filter (where activo and cs) as activos,
         count(*) filter (where activo and cs and (es_critico or clase = 'A')) as criticos,
         count(*) filter (where activo and cs and stock_actual > 0) as fantasmas
  from qa
),
ceros as (
  select count(*) as n,
         count(*) filter (where exists (select 1 from qa where qa.producto_id = p.id)) as con_evento
  from public.productos p
  where p.activo and coalesce(p.controlar_stock, true) and p.stock_actual <= 0
    and not exists (select 1 from public.producto_componentes x where x.producto_id = p.id)
),
per as (
  select count(*) as eventos,
         round(coalesce(sum(
           extract(epoch from (least(coalesce(q.fin_at, now()), r.fin) - greatest(q.inicio_at, r.ini))) / 3600.0
         ), 0)::numeric, 1) as horas,
         round(coalesce(sum(
           vel.unid_30d / 30.0
           * (extract(epoch from (least(coalesce(q.fin_at, now()), r.fin) - greatest(q.inicio_at, r.ini))) / 86400.0)
           * p.precio_venta
         ), 0)::numeric, 2) as perdida
  from public.quiebres_stock q
  join public.productos p on p.id = q.producto_id
  cross join rango r
  cross join lateral (
    select coalesce(sum(iv.cantidad), 0) as unid_30d
    from public.items_venta iv
    join public.ventas ve on ve.id = iv.venta_id
    where iv.producto_id = q.producto_id and ve.estado = 'completada'
      and ve.fecha >= q.inicio_at - interval '30 days' and ve.fecha < q.inicio_at
  ) vel
  where q.inicio_at < r.fin
    and coalesce(q.fin_at, now()) > r.ini
    and (q.fin_at is not null or (p.activo and coalesce(p.controlar_stock, true)))
),
lotes as (
  select count(*) filter (where l.fecha_vencimiento <= p.hoy + 7) as tablero,
         count(*) filter (where l.fecha_vencimiento < p.hoy) as vencidos,
         count(*) filter (where l.fecha_vencimiento between p.hoy and p.hoy + 7) as por_vencer
  from public.lotes l
  join public.productos pr on pr.id = l.producto_id
  cross join params p
  where pr.activo and l.estado in ('activo', 'vencido') and l.cantidad_actual > 0
),
alertas as (
  select count(*) as n_reglas,
         string_agg(r.nombre || ': ' || x.abiertas::text ||
                    case when x.en_curso > 0 then ' (+' || x.en_curso::text || ' ya con tarea)' else '' end,
                    ' · ' order by r.orden) as lista
  from (
    select a.regla_codigo,
           count(*) filter (where a.estado = 'abierta') as abiertas,
           count(*) filter (where a.estado = 'en_curso') as en_curso
    from public.alertas a
    where a.estado in ('abierta', 'en_curso')
    group by a.regla_codigo
  ) x
  join public.reglas_alerta r on r.codigo = x.regla_codigo
  where r.severidad <> 'informativo' and x.abiertas > 0
),
evalu as (
  select max(fin_at) as ultima from public.alertas_evaluaciones where error is null
),
filas (orden, concepto, valor, detalle) as (
  select 1, 'Período contrastado', null::numeric, p.desde::text || ' a ' || p.hasta::text from params p
  union all
  select 10, 'Tarjeta QUIEBRES · activos ahora', a.activos,
         'eventos abiertos en quiebres_stock de productos activos con control de stock'
  from act a
  union all
  select 11, 'de los cuales críticos', a.criticos,
         'marcados "no puede faltar" o clase A en el último resumen diario (distinto de la alerta "Productos clave sin stock", que además excluye los que vendieron hace 2 días)'
  from act a
  union all
  select 12, 'Productos con control de stock en 0 o menos (stock_actual)', c.n,
         c.con_evento::text || ' con evento abierto · ' || (c.n - c.con_evento)::text ||
         ' sin evento: nunca tuvieron stock cargado o se tocó el stock por fuera del kardex'
  from ceros c
  union all
  select 13, 'CONTROL: quiebres abiertos cuyo producto HOY tiene stock > 0', a.fantasmas, 'tiene que dar 0'
  from act a
  union all
  select 20, 'Horas sin stock en el período (recortadas al período)', pe.horas,
         pe.eventos::text || ' eventos de quiebre tocaron el período'
  from per pe
  union all
  select 21, 'Venta perdida ESTIMADA ($)', pe.perdida,
         'ESTIMACIÓN: venta promedio de los 30 días previos al quiebre × días sin stock × precio actual. No es un dato contable.'
  from per pe
  union all
  select 30, 'Lotes vencidos o por vencer en 7 días (con unidades)', l.tablero,
         l.vencidos::text || ' ya vencidos · ' || l.por_vencer::text || ' vencen entre hoy y 7 días'
  from lotes l
  union all
  select 40, 'Requiere intervención · reglas con alertas abiertas', al.n_reglas,
         coalesce(al.lista, 'ninguna')
  from alertas al
  union all
  select 41, 'Última evaluación de alertas', null::numeric,
         coalesce(to_char(e.ultima at time zone 'America/Argentina/La_Rioja', 'DD/MM/YYYY HH24:MI'), 'nunca') ||
         ' · el bloque es una foto de ese momento, no se recalcula al abrir el tablero'
  from evalu e
)
select orden, concepto, valor, detalle
from filas
order by orden;
