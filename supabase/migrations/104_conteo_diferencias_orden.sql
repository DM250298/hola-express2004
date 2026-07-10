-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 104 · fn_conteo_diferencias con orden estable            ║
-- ║                                                                     ║
-- ║  Con más de 1.000 productos en el snapshot, PostgREST corta la      ║
-- ║  respuesta del RPC en 1.000 filas (max-rows). La pantalla de        ║
-- ║  revisión ahora pagina con .range(), y para que la paginación sea   ║
-- ║  estable (sin filas repetidas ni salteadas entre páginas) la        ║
-- ║  función tiene que devolver un orden determinístico. Único cambio   ║
-- ║  vs la versión de la 098: ORDER BY s.producto_id al final.          ║
-- ║  El cierre (fn_cerrar_sesion_conteo) no se ve afectado: itera la    ║
-- ║  función dentro de la base, sin pasar por PostgREST.                ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

drop function if exists public.fn_conteo_diferencias(integer);
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
  observaciones text[]
)
language plpgsql stable security definer set search_path = public
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
  with movs as (
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
       and exists (select 1 from public.conteo_snapshot s2
                   where s2.sesion_id = p_sesion_id and s2.producto_id = m.producto_id)
     group by m.producto_id
  ),
  contado as (
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
  )
  select
    s.producto_id,
    p.nombre,
    p.codigo_barras,
    s.stock_teorico,
    coalesce(m.ventas, 0),
    coalesce(m.ingresos, 0),
    coalesce(m.delta_total, 0) + coalesce(m.ventas, 0) - coalesce(m.ingresos, 0),
    s.stock_teorico + coalesce(m.delta_total, 0),
    c.total,
    case when c.total is null then null
         else c.total - (s.stock_teorico + coalesce(m.delta_total, 0)) end,
    -- fn_costo devuelve NULL si el producto no tiene fila en costos_producto
    -- (alta al vuelo "pendiente de precio"): coalesce para no envenenar los
    -- totales ni el flag relevante.
    coalesce(public.fn_costo(s.producto_id), 0),
    case when c.total is null then null
         else round((c.total - (s.stock_teorico + coalesce(m.delta_total, 0)))
                    * coalesce(public.fn_costo(s.producto_id), 0), 2) end,
    case when c.total is null then false
         else (
           abs(c.total - (s.stock_teorico + coalesce(m.delta_total, 0)))
             > 0.05 * abs(s.stock_teorico + coalesce(m.delta_total, 0))
           or abs((c.total - (s.stock_teorico + coalesce(m.delta_total, 0)))
                  * coalesce(public.fn_costo(s.producto_id), 0)) > v_ses.umbral_pesos
         ) end,
    coalesce(c.pendiente, false),
    coalesce(c.obs, '{}')
  from public.conteo_snapshot s
  join public.productos p on p.id = s.producto_id
  left join movs m on m.prod_id = s.producto_id
  left join contado c on c.prod_id = s.producto_id
  where s.sesion_id = p_sesion_id
  order by s.producto_id;
end;
$$;

notify pgrst, 'reload schema';
