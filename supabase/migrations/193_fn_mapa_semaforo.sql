-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 193 · Fase E (1/2): el mapa con números y semáforo       ║
-- ║                                                                     ║
-- ║  fn_mapa_semaforo(p_desde, p_hasta) → jsonb con UN nodo por         ║
-- ║  ubicación, con lo suyo y lo de todos sus descendientes (rollup):   ║
-- ║   · skus ubicados, ventas, margen, stock a costo, días de           ║
-- ║     inventario, quiebres del período, sin stock, sin movimiento.    ║
-- ║   · alertas vivas de sus productos, por severidad → semáforo:       ║
-- ║     rojo = alguna crítica · amarillo = alguna de atención ·         ║
-- ║     verde = sin alertas · gris = todavía sin productos ubicados.    ║
-- ║                                                                     ║
-- ║  La góndola es una DIMENSIÓN, no una tabla de métricas: todo se     ║
-- ║  calcula al vuelo desde fn_resumen_skus (mig 178) + la ubicación    ║
-- ║  PRINCIPAL de cada producto (mig 170).                              ║
-- ║                                                                     ║
-- ║  Gates: exige 'inventario'. Sin 'costos', margen, stock a costo y   ║
-- ║  días de inventario vuelven NULL (nunca 0). El conteo de alertas    ║
-- ║  no revela costos, así que no pide el permiso 'alertas'.            ║
-- ║                                                                     ║
-- ║  Después: types/database.ts (Functions: fn_mapa_semaforo).          ║
-- ║  REQUIERE: migs 170, 178 y 183. Ejecutar UNA sola vez, COMPLETO.    ║
-- ╚════════════════════════════════════════════════════════════════════╝

drop function if exists public.fn_mapa_semaforo(date, date);

create function public.fn_mapa_semaforo(p_desde date, p_hasta date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_costos boolean := public.fn_tiene_permiso('costos');
  v_dias integer := greatest(p_hasta - p_desde + 1, 1);
begin
  if not public.fn_tiene_permiso('inventario') then
    raise exception 'No tenés permiso para ver el mapa del local.';
  end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde then
    raise exception 'Período inválido.';
  end if;
  if p_hasta - p_desde > 400 then
    raise exception 'Período demasiado largo (máximo 400 días).';
  end if;

  return (
    -- RECURSIVE por el CTE `rama` (el rollup del árbol) más abajo.
    with recursive r as materialized (
      select
        rs.*,
        pu.ubicacion_id,
        coalesce(p.controlar_stock, true)
          and not exists (
            select 1 from public.producto_componentes pc where pc.producto_id = rs.producto_id
          ) as stockeable
      from public.fn_resumen_skus(p_desde, p_hasta) rs
      join public.productos p on p.id = rs.producto_id
      join public.producto_ubicacion pu
        on pu.producto_id = rs.producto_id and pu.es_principal
    ),
    -- Alertas vivas de cada producto ubicado, por severidad.
    al as (
      select r.ubicacion_id,
             count(*) filter (where a.severidad = 'critico')::integer as criticas,
             count(*) filter (where a.severidad = 'atencion')::integer as atencion
      from public.alertas a
      join r on r.producto_id = a.producto_id
      where a.estado <> 'resuelta'
      group by r.ubicacion_id
    ),
    -- Lo que aporta cada nodo por sí mismo.
    directo as (
      select
        r.ubicacion_id,
        count(*)::integer as skus,
        sum(r.ingresos) as ingresos,
        sum(r.margen_pesos) as margen,
        sum(r.costo_ventas) as costo_ventas,
        sum(r.stock_valorizado) filter (where r.stockeable and r.stock_actual > 0) as stock_val,
        sum(r.quiebres_periodo)::integer as quiebres,
        count(*) filter (where r.stockeable and r.stock_actual <= 0)::integer as sin_stock,
        count(*) filter (
          where r.stockeable and r.stock_actual > 0
            and r.unidades_vendidas = 0 and r.unidades_via_combo = 0
        )::integer as sin_movimiento,
        coalesce(max(a.criticas), 0) as criticas,
        coalesce(max(a.atencion), 0) as atencion
      from r
      left join al a on a.ubicacion_id = r.ubicacion_id
      group by r.ubicacion_id
    ),
    -- Cada nodo con todos sus descendientes (y consigo mismo).
    rama as (
      select u.id as nodo_id, u.id as desc_id from public.ubicaciones u
      union all
      select ra.nodo_id, h.id
      from rama ra
      join public.ubicaciones h on h.parent_id = ra.desc_id
    ),
    total as (
      select
        u.id,
        coalesce(sum(d.skus), 0)::integer as skus,
        coalesce(sum(d.ingresos), 0) as ingresos,
        sum(d.margen) as margen,
        sum(d.costo_ventas) as costo_ventas,
        sum(d.stock_val) as stock_val,
        coalesce(sum(d.quiebres), 0)::integer as quiebres,
        coalesce(sum(d.sin_stock), 0)::integer as sin_stock,
        coalesce(sum(d.sin_movimiento), 0)::integer as sin_movimiento,
        coalesce(sum(d.criticas), 0)::integer as criticas,
        coalesce(sum(d.atencion), 0)::integer as atencion
      from public.ubicaciones u
      join rama ra on ra.nodo_id = u.id
      left join directo d on d.ubicacion_id = ra.desc_id
      group by u.id
    )
    select jsonb_build_object(
      'puede_ver_costos', v_costos,
      'periodo', jsonb_build_object('desde', p_desde, 'hasta', p_hasta, 'dias', v_dias),
      'nodos', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', u.id,
                 'parent_id', u.parent_id,
                 'tipo', u.tipo,
                 'nombre', u.nombre,
                 'codigo', u.codigo,
                 'activo', u.activo,
                 'skus', t.skus,
                 'skus_directos', coalesce(dd.skus, 0),
                 'ingresos', round(t.ingresos, 2),
                 'margen', case when v_costos then round(t.margen, 2) end,
                 'margen_pct', case when v_costos and t.ingresos > 0
                                    then round((t.margen / t.ingresos * 100)::numeric, 1) end,
                 'stock_valorizado', case when v_costos then round(coalesce(t.stock_val, 0), 2) end,
                 'dias_inventario', case when v_costos and coalesce(t.costo_ventas, 0) > 0
                   then round((coalesce(t.stock_val, 0) / (t.costo_ventas / v_dias))::numeric, 1) end,
                 'quiebres', t.quiebres,
                 'sin_stock', t.sin_stock,
                 'sin_movimiento', t.sin_movimiento,
                 'alertas_criticas', t.criticas,
                 'alertas_atencion', t.atencion,
                 'semaforo', case when t.criticas > 0 then 'rojo'
                                  when t.atencion > 0 then 'amarillo'
                                  when t.skus > 0 then 'verde'
                                  else 'gris' end
               ) order by u.orden, u.nombre, u.id)
        from public.ubicaciones u
        join total t on t.id = u.id
        left join directo dd on dd.ubicacion_id = u.id
      ), '[]'::jsonb),
      -- Los que todavía no están en el mapa: el trabajo que falta.
      'sin_ubicar', (
        select count(*)::integer
        from public.productos p
        where p.activo
          and not exists (
            select 1 from public.producto_ubicacion pu
            where pu.producto_id = p.id and pu.es_principal
          )
      )
    )
  );
end;
$$;

revoke execute on function public.fn_mapa_semaforo(date, date) from public, anon;
grant execute on function public.fn_mapa_semaforo(date, date) to authenticated;

notify pgrst, 'reload schema';

-- Verificación (debe dar true). Se prueba desde la app: en el SQL Editor no
-- hay usuario y la función rechaza ("No tenés permiso").
select to_regprocedure('public.fn_mapa_semaforo(date,date)') is not null as creada;
