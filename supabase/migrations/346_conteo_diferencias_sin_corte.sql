-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 346 · Conteo físico: la revisión no se corta por tiempo ║
-- ║                                                                    ║
-- ║  Síntoma (2026-11-27, sesión 356): "Revisar diferencias" quedaba   ║
-- ║  cargando y terminaba en error. fn_conteo_diferencias devolvía     ║
-- ║  57014 (statement timeout, 8 s) en la sesión abierta; las sesiones ║
-- ║  cerradas, con el mismo tamaño (4.449 productos), cargaban bien.   ║
-- ║  Tampoco se podía cerrar: fn_cerrar_sesion_conteo llama a esta.    ║
-- ║                                                                    ║
-- ║  Causa probable: conteo_snapshot recibe ~4.500 filas por sesión y  ║
-- ║  las estadísticas todavía no conocen la sesión recién abierta; el  ║
-- ║  planificador cree que tiene 1 fila y recalcula los subtotales     ║
-- ║  (movimientos, contado) una vez por producto.                      ║
-- ║                                                                    ║
-- ║  1. Reemite fn_conteo_diferencias (base 150, MISMA firma y mismos  ║
-- ║     resultados): cada subtotal se calcula una sola vez             ║
-- ║     (materialized), el costo sale de un join a costos_producto en  ║
-- ║     vez de 3 llamadas a fn_costo por fila, y la función no usa     ║
-- ║     nested loops (enable_nestloop = off solo adentro de ella).     ║
-- ║  2. analyze de las tablas del conteo: destraba la sesión de hoy.   ║
-- ║                                                                    ║
-- ║  REQUIERE: 150. Sin cambios de tablas, RLS ni front.               ║
-- ║  Ejecutar COMPLETO. Primero PRUEBA, después PRODUCCIÓN (HEX-V1).   ║
-- ╚════════════════════════════════════════════════════════════════════╝

create or replace function public.fn_conteo_diferencias(p_sesion_id integer)
returns table (
  producto_id integer,
  nombre text,
  codigo_barras text,
  stock_teorico numeric,
  ventas_rango numeric,
  ingresos_rango numeric,
  otros_rango numeric,
  teorico_esperado numeric,
  total_contado numeric,
  diferencia numeric,
  costo_unitario numeric,
  diferencia_pesos numeric,
  relevante boolean,
  reconteo_pendiente boolean,
  observaciones text[],
  venta_por_peso boolean
)
language plpgsql stable security definer
set search_path = public
set enable_nestloop = off
as $$
declare
  v_ses public.conteo_sesiones;
  v_hasta timestamptz;
begin
  if not public.fn_tiene_permiso('conteo_cierre') then
    raise exception 'No tenés permiso para ver las diferencias del conteo.';
  end if;
  select * into v_ses from public.conteo_sesiones cs where cs.id = p_sesion_id;
  if v_ses.id is null then
    raise exception 'La sesión de conteo no existe.';
  end if;
  -- clock_timestamp() (no now()): ts_apertura es clock-based, así que el fin
  -- de ventana también, para que la ventana nunca quede invertida dentro de
  -- una misma transacción (p.ej. el script de tests con rollback).
  v_hasta := coalesce(v_ses.ts_cierre, clock_timestamp());

  return query
  with snap as materialized (
    select s.producto_id as prod_id, s.stock_teorico as teorico
      from public.conteo_snapshot s
     where s.sesion_id = p_sesion_id
  ),
  movs as materialized (
    select m.producto_id as prod_id,
           sum(m.stock_nuevo - m.stock_anterior) as delta_total,
           coalesce(sum(m.stock_anterior - m.stock_nuevo)
             filter (where m.tipo = 'venta'), 0) as ventas,
           coalesce(sum(m.stock_nuevo - m.stock_anterior)
             filter (where m.tipo in ('entrada', 'ingreso_produccion')), 0) as ingresos
      from public.movimientos_stock m
     where m.created_at >= v_ses.ts_apertura
       and m.created_at <= v_hasta
       and not (m.tipo = 'ajuste_conteo' and m.referencia_id = p_sesion_id)
       and m.producto_id in (select sn.prod_id from snap sn)
     group by m.producto_id
  ),
  contado as materialized (
    select d.producto_id as prod_id,
           sum(coalesce(r.cantidad_contada, d.cantidad_contada)) as total,
           bool_or(d.reconteo_pedido and r.id is null) as pendiente,
           array_remove(array_agg(distinct coalesce(r.observacion, d.observacion)), null) as obs
      from public.conteo_detalle d
      join public.conteo_zonas z on z.id = d.zona_id and z.sesion_id = p_sesion_id
      left join public.conteo_detalle r
             on r.zona_id = d.zona_id and r.producto_id = d.producto_id and r.es_reconteo
     where not d.es_reconteo
     group by d.producto_id
  ),
  calc as (
    select sn.prod_id,
           sn.teorico,
           coalesce(m.ventas, 0) as ventas,
           coalesce(m.ingresos, 0) as ingresos,
           coalesce(m.delta_total, 0) as delta,
           c.total,
           coalesce(c.pendiente, false) as pendiente,
           coalesce(c.obs, '{}') as obs,
           -- Sin fila en costos_producto (alta al vuelo "pendiente de precio")
           -- el costo es 0: no envenena los totales ni el flag relevante.
           coalesce(cp.precio_costo, 0) as costo
      from snap sn
      left join movs m on m.prod_id = sn.prod_id
      left join contado c on c.prod_id = sn.prod_id
      left join public.costos_producto cp on cp.producto_id = sn.prod_id
  )
  select
    k.prod_id,
    p.nombre::text,
    p.codigo_barras::text,
    k.teorico,
    k.ventas,
    k.ingresos,
    k.delta + k.ventas - k.ingresos,
    k.teorico + k.delta,
    k.total,
    case when k.total is null then null
         else k.total - (k.teorico + k.delta) end,
    k.costo,
    case when k.total is null then null
         else round((k.total - (k.teorico + k.delta)) * k.costo, 2) end,
    case when k.total is null then false
         else (
           abs(k.total - (k.teorico + k.delta)) > 0.05 * abs(k.teorico + k.delta)
           or abs((k.total - (k.teorico + k.delta)) * k.costo) > v_ses.umbral_pesos
         ) end,
    k.pendiente,
    k.obs,
    p.venta_por_peso
  from calc k
  join public.productos p on p.id = k.prod_id
  order by k.prod_id;
end;
$$;

-- Estadísticas al día: es lo que destraba la sesión abierta hoy.
analyze public.conteo_snapshot;
analyze public.conteo_zonas;
analyze public.conteo_detalle;

notify pgrst, 'reload schema';

-- Verificación: las dos columnas deben dar true y "duplicadas" 0.
select
  pg_get_functiondef('public.fn_conteo_diferencias(integer)'::regprocedure)
    like '%snap as materialized%' as diferencias_v346,
  pg_get_functiondef('public.fn_conteo_diferencias(integer)'::regprocedure)
    like '%enable_nestloop%' as sin_nested_loops,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'fn_conteo_diferencias') - 1 as duplicadas;
