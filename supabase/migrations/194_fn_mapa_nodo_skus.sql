-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 194 · Fase E (2/2): del nodo al producto                 ║
-- ║                                                                     ║
-- ║  fn_mapa_nodo_skus(p_ubicacion_id, p_desde, p_hasta): los productos ║
-- ║  que viven en ese nodo Y en todos los que cuelgan de él, con sus    ║
-- ║  números del período y sus alertas vivas. Es el último escalón del  ║
-- ║  drill-down: empresa → sector → góndola → módulo → estante → SKU.   ║
-- ║                                                                     ║
-- ║  Toma la ubicación PRINCIPAL (la de venta), que es a la que se      ║
-- ║  atribuye el análisis por góndola.                                  ║
-- ║                                                                     ║
-- ║  Gates: exige 'inventario'; sin 'costos', margen y stock a costo    ║
-- ║  vuelven NULL. ORDER BY determinístico para traerTodo().            ║
-- ║                                                                     ║
-- ║  Después: types/database.ts (Functions: fn_mapa_nodo_skus).         ║
-- ║  REQUIERE: migs 170, 178 y 183. Ejecutar UNA sola vez, COMPLETO.    ║
-- ╚════════════════════════════════════════════════════════════════════╝

drop function if exists public.fn_mapa_nodo_skus(integer, date, date);

create function public.fn_mapa_nodo_skus(
  p_ubicacion_id integer,
  p_desde date,
  p_hasta date
)
returns table (
  producto_id integer,
  nombre text,
  codigo_barras text,
  venta_por_peso boolean,
  ubicacion_id integer,
  ubicacion_nombre text,
  stock_actual numeric,
  unidades_vendidas numeric,
  ingresos numeric,
  margen_pesos numeric,
  margen_pct numeric,
  stock_valorizado numeric,
  dias_cobertura numeric,
  dias_sin_venta integer,
  clase_abc text,
  quiebres_periodo integer,
  alertas_criticas integer,
  alertas_atencion integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.fn_tiene_permiso('inventario') then
    raise exception 'No tenés permiso para ver el mapa del local.';
  end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde then
    raise exception 'Período inválido.';
  end if;

  return query
  with recursive rama as (
    select u.id, u.nombre from public.ubicaciones u where u.id = p_ubicacion_id
    union all
    select h.id, h.nombre
    from public.ubicaciones h
    join rama ra on h.parent_id = ra.id
  ),
  productos_nodo as (
    select pu.producto_id, ra.id as ubicacion_id, ra.nombre as ubicacion_nombre
    from public.producto_ubicacion pu
    join rama ra on ra.id = pu.ubicacion_id
    where pu.es_principal
  ),
  alertas_prod as (
    select a.producto_id,
           count(*) filter (where a.severidad = 'critico')::integer as criticas,
           count(*) filter (where a.severidad = 'atencion')::integer as atencion
    from public.alertas a
    where a.estado <> 'resuelta' and a.producto_id is not null
    group by a.producto_id
  )
  select
    rs.producto_id,
    rs.nombre,
    rs.codigo_barras,
    rs.venta_por_peso,
    pn.ubicacion_id,
    pn.ubicacion_nombre,
    rs.stock_actual,
    rs.unidades_vendidas,
    rs.ingresos,
    rs.margen_pesos,
    rs.margen_pct,
    rs.stock_valorizado,
    rs.dias_cobertura,
    rs.dias_sin_venta,
    rs.clase_abc,
    rs.quiebres_periodo,
    coalesce(ap.criticas, 0),
    coalesce(ap.atencion, 0)
  from public.fn_resumen_skus(p_desde, p_hasta) rs
  join productos_nodo pn on pn.producto_id = rs.producto_id
  left join alertas_prod ap on ap.producto_id = rs.producto_id
  order by coalesce(ap.criticas, 0) desc, rs.ingresos desc, rs.producto_id;
end;
$$;

revoke execute on function public.fn_mapa_nodo_skus(integer, date, date) from public, anon;
grant execute on function public.fn_mapa_nodo_skus(integer, date, date) to authenticated;

notify pgrst, 'reload schema';

-- Verificación (debe dar true). Se prueba desde la app: en el SQL Editor no
-- hay usuario y la función rechaza ("No tenés permiso").
select to_regprocedure('public.fn_mapa_nodo_skus(integer,date,date)') is not null as creada;
