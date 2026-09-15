-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 178 · RPCs de inteligencia SKU (Fase C)                  ║
-- ║                                                                     ║
-- ║  1. fn_resumen_skus(p_desde, p_hasta): la tabla-madre del análisis  ║
-- ║     — 1 fila por SKU con ventas, margen real (costo congelado de    ║
-- ║     la mig 171 con fallback a costo actual + flag estimado),        ║
-- ║     velocity, cobertura, última venta/compra, clase ABC del         ║
-- ║     período, quiebres y ubicación. Todo agregado en SQL             ║
-- ║     (precedente mig 160: nada de bajar tablas crudas al browser).   ║
-- ║                                                                     ║
-- ║  2. fn_metricas_sku(p_producto_id, p_desde, p_hasta): la ficha 360  ║
-- ║     de un SKU — serie diaria del snapshot (mig 173) + quiebres del  ║
-- ║     rango, como jsonb.                                              ║
-- ║                                                                     ║
-- ║  Gate de costos: security definer con chequeo INLINE de             ║
-- ║  fn_tiene_permiso('costos') — sin permiso, las columnas de costo    ║
-- ║  y margen vuelven NULL (nunca 0: 0 es un dato, NULL es "no lo       ║
-- ║  podés ver"). Patrón de fn_sugerencias_compra (mig 151).            ║
-- ║                                                                     ║
-- ║  ORDER BY determinístico para traerTodo() (gotcha migs 104/151).    ║
-- ║                                                                     ║
-- ║  Semánticas respetadas (ver plan §13.8): combos facturan como       ║
-- ║  combo y su velocity va a los componentes vía unidades_via_combo;   ║
-- ║  controlar_stock=false no tiene kardex (última venta/compra NULL);  ║
-- ║  kg y unidades no se suman; lo comercial usa ventas.total.          ║
-- ║                                                                     ║
-- ║  Después de correrla, actualizar types/database.ts:                 ║
-- ║   · Functions: fn_resumen_skus, fn_metricas_sku                     ║
-- ║  REQUIERE: migs 170-177. Ejecutar UNA sola vez, COMPLETO.           ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────────────────────
-- 1. fn_resumen_skus
-- ─────────────────────────────────────────────────────────────────────
drop function if exists public.fn_resumen_skus(date, date);

create function public.fn_resumen_skus(p_desde date, p_hasta date)
returns table (
  producto_id integer,
  nombre text,
  codigo_barras text,
  venta_por_peso boolean,
  activo boolean,
  es_critico boolean,
  marca text,
  categoria text,
  proveedor text,
  gondola text,
  stock_actual numeric,
  stock_minimo numeric,
  unidades_vendidas numeric,
  unidades_via_combo numeric,
  ingresos numeric,
  venta_diaria numeric,
  dias_cobertura numeric,
  ultima_venta timestamptz,
  ultima_compra timestamptz,
  dias_sin_venta integer,
  clase_abc text,
  quiebres_periodo integer,
  venta_perdida_pesos numeric,
  precio_venta numeric,
  costo_actual numeric,
  costo_ventas numeric,
  margen_pesos numeric,
  margen_pct numeric,
  stock_valorizado numeric,
  costo_estimado boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with permiso as (
    select public.fn_tiene_permiso('costos') as ok
  ),
  rango as (
    select
      (p_desde::timestamp) at time zone 'America/Argentina/La_Rioja' as ini,
      ((p_hasta + 1)::timestamp) at time zone 'America/Argentina/La_Rioja' as fin,
      greatest(p_hasta - p_desde + 1, 1) as dias
  ),
  dia as (
    select
      iv.producto_id,
      iv.cantidad,
      coalesce(iv.subtotal, iv.cantidad * iv.precio_unitario) as ingreso,
      civ.costo_unitario as costo_congelado,
      coalesce(p.controlar_stock, true) as controla,
      exists (
        select 1 from public.producto_componentes pc where pc.producto_id = iv.producto_id
      ) as es_combo
    from public.items_venta iv
    join public.ventas v on v.id = iv.venta_id
    join public.productos p on p.id = iv.producto_id
    cross join rango r
    where v.estado = 'completada' and v.fecha >= r.ini and v.fecha < r.fin
  ),
  directo as (
    select
      d.producto_id,
      sum(d.cantidad) as unidades,
      sum(d.ingreso) as ingresos,
      sum(d.cantidad * coalesce(
        d.costo_congelado,
        case when d.controla or d.es_combo
             then coalesce(public.fn_costo(d.producto_id), 0) else 0 end
      )) as costo_ventas,
      bool_or(d.costo_congelado is null and (d.controla or d.es_combo)) as estimado
    from dia d
    group by d.producto_id
  ),
  via_combo as (
    select pc.componente_id as producto_id,
           sum(d.cantidad * pc.cantidad) as unidades
    from dia d
    join public.producto_componentes pc on pc.producto_id = d.producto_id
    group by pc.componente_id
  ),
  abc as (
    -- Pareto de ingresos DEL PERÍODO (misma fórmula que ranking / mig 152).
    select t.producto_id,
           case when t.acum <= 0.80 then 'A'
                when t.acum <= 0.95 then 'B'
                else 'C' end as clase
    from (
      select d2.producto_id,
             sum(d2.ingresos) over (order by d2.ingresos desc, d2.producto_id)
               / nullif(sum(d2.ingresos) over (), 0) as acum
      from (select directo.producto_id, directo.ingresos from directo where directo.ingresos > 0) d2
    ) t
  ),
  kardex as (
    -- Última venta / última compra desde el libro mayor de stock (una sola
    -- pasada agrupada; los índices de fecha acotan poco acá, pero es UNA
    -- query por carga de pantalla con staleTime de 60 s).
    select ms.producto_id,
           max(ms.created_at) filter (where ms.tipo = 'venta') as ultima_venta,
           max(ms.created_at) filter (where ms.tipo = 'entrada') as ultima_compra
    from public.movimientos_stock ms
    where ms.tipo in ('venta', 'entrada')
    group by ms.producto_id
  ),
  quiebres as (
    select q.producto_id,
           count(*)::integer as cantidad,
           sum(coalesce(q.venta_perdida_pesos, 0)) as perdida
    from public.quiebres_stock q
    cross join rango r
    where q.inicio_at < r.fin and coalesce(q.fin_at, now()) >= r.ini
    group by q.producto_id
  ),
  gondola as (
    select pu.producto_id, g.nombre as gondola
    from public.producto_ubicacion pu
    join lateral (
      with recursive cadena as (
        select u.id, u.parent_id, u.tipo, u.nombre
        from public.ubicaciones u where u.id = pu.ubicacion_id
        union all
        select u2.id, u2.parent_id, u2.tipo, u2.nombre
        from public.ubicaciones u2
        join cadena c on c.parent_id = u2.id
      )
      select cadena.nombre from cadena where cadena.tipo = 'gondola' limit 1
    ) g on true
    where pu.es_principal
  )
  select
    p.id as producto_id,
    p.nombre::text,
    p.codigo_barras::text,
    coalesce(p.venta_por_peso, false),
    p.activo,
    coalesce(p.es_critico, false),
    coalesce(m.nombre, nullif(btrim(coalesce(p.marca, '')), ''))::text as marca,
    c.nombre::text as categoria,
    pr.nombre::text as proveedor,
    g.gondola::text,
    p.stock_actual,
    p.stock_minimo,
    coalesce(d.unidades, 0) as unidades_vendidas,
    coalesce(vc.unidades, 0) as unidades_via_combo,
    round(coalesce(d.ingresos, 0), 2) as ingresos,
    round((coalesce(d.unidades, 0) / r.dias)::numeric, 3) as venta_diaria,
    case when coalesce(d.unidades, 0) > 0 and p.stock_actual > 0
         then round((p.stock_actual * r.dias / d.unidades)::numeric, 1)
         else null end as dias_cobertura,
    k.ultima_venta,
    k.ultima_compra,
    case when k.ultima_venta is not null
         then greatest(floor(extract(epoch from now() - k.ultima_venta) / 86400)::integer, 0)
         else null end as dias_sin_venta,
    a.clase::text as clase_abc,
    coalesce(q.cantidad, 0) as quiebres_periodo,
    round(coalesce(q.perdida, 0), 2) as venta_perdida_pesos,
    p.precio_venta,
    case when pm.ok then coalesce(public.fn_costo(p.id), 0) else null end as costo_actual,
    case when pm.ok then round(coalesce(d.costo_ventas, 0), 2) else null end as costo_ventas,
    case when pm.ok then round(coalesce(d.ingresos, 0) - coalesce(d.costo_ventas, 0), 2)
         else null end as margen_pesos,
    case when pm.ok and coalesce(d.ingresos, 0) > 0
         then round(((d.ingresos - coalesce(d.costo_ventas, 0)) / d.ingresos * 100)::numeric, 1)
         else null end as margen_pct,
    case when pm.ok
         then round(p.stock_actual * coalesce(public.fn_costo(p.id), 0), 2)
         else null end as stock_valorizado,
    coalesce(d.estimado, false) as costo_estimado
  from public.productos p
  cross join permiso pm
  cross join rango r
  left join public.marcas m on m.id = p.marca_id
  left join public.categorias c on c.id = p.categoria_id
  left join public.proveedores pr on pr.id = p.proveedor_id
  left join directo d on d.producto_id = p.id
  left join via_combo vc on vc.producto_id = p.id
  left join abc a on a.producto_id = p.id
  left join kardex k on k.producto_id = p.id
  left join quiebres q on q.producto_id = p.id
  left join gondola g on g.producto_id = p.id
  where p.activo
  order by coalesce(d.ingresos, 0) desc, p.id
$$;

revoke execute on function public.fn_resumen_skus(date, date) from public, anon;
grant execute on function public.fn_resumen_skus(date, date) to authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 2. fn_metricas_sku — la ficha 360 de un SKU, como jsonb:
--    { serie: [{fecha, unidades, ingresos, costo_ventas, margen, stock,
--               valor_stock, precio_venta, clase_abc, estimado}, ...],
--      quiebres: [{inicio_at, fin_at, duracion_horas, perdida_unid,
--                  perdida_pesos}, ...],
--      ultima_venta, ultima_compra }
--    Sin permiso 'costos': costo_ventas / margen / valor_stock = null.
-- ─────────────────────────────────────────────────────────────────────
drop function if exists public.fn_metricas_sku(integer, date, date);

create function public.fn_metricas_sku(
  p_producto_id integer,
  p_desde date,
  p_hasta date
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with permiso as (
    select public.fn_tiene_permiso('costos') as ok
  ),
  serie as (
    select jsonb_agg(jsonb_build_object(
      'fecha', ms.fecha,
      'unidades', ms.unidades_vendidas,
      'unidades_via_combo', ms.unidades_via_combo,
      'ingresos', ms.ingresos,
      'costo_ventas', case when pm.ok then ms.costo_ventas else null end,
      'margen', case when pm.ok then round(ms.ingresos - ms.costo_ventas, 2) else null end,
      'stock', ms.stock_fin_dia,
      'valor_stock', case when pm.ok
        then round(ms.stock_fin_dia * ms.costo_unitario, 2) else null end,
      'precio_venta', ms.precio_venta,
      'clase_abc', ms.clase_abc,
      'estimado', ms.costo_estimado
    ) order by ms.fecha) as datos
    from public.metricas_sku_diarias ms
    cross join permiso pm
    where ms.producto_id = p_producto_id
      and ms.fecha >= p_desde and ms.fecha <= p_hasta
  ),
  quiebres as (
    select jsonb_agg(jsonb_build_object(
      'inicio_at', q.inicio_at,
      'fin_at', q.fin_at,
      'duracion_horas',
        round((extract(epoch from coalesce(q.fin_at, now()) - q.inicio_at) / 3600.0)::numeric, 1),
      'perdida_unid', q.venta_perdida_unid,
      'perdida_pesos', q.venta_perdida_pesos
    ) order by q.inicio_at desc) as datos
    from public.quiebres_stock q
    where q.producto_id = p_producto_id
      and q.inicio_at < ((p_hasta + 1)::timestamp) at time zone 'America/Argentina/La_Rioja'
      and coalesce(q.fin_at, now()) >= (p_desde::timestamp) at time zone 'America/Argentina/La_Rioja'
  ),
  kardex as (
    select max(ms.created_at) filter (where ms.tipo = 'venta') as uv,
           max(ms.created_at) filter (where ms.tipo = 'entrada') as uc
    from public.movimientos_stock ms
    where ms.producto_id = p_producto_id and ms.tipo in ('venta', 'entrada')
  )
  select jsonb_build_object(
    'serie', coalesce(s.datos, '[]'::jsonb),
    'quiebres', coalesce(q.datos, '[]'::jsonb),
    'ultima_venta', k.uv,
    'ultima_compra', k.uc
  )
  from serie s, quiebres q, kardex k
$$;

revoke execute on function public.fn_metricas_sku(integer, date, date) from public, anon;
grant execute on function public.fn_metricas_sku(integer, date, date) to authenticated;

-- Reload PostgREST schema cache.
notify pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────────
-- Verificación post-migración:
--
-- 1. Chequeo T1 (0 filas):
--    select proname, count(*) from pg_proc p
--    join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and proname like 'fn_%'
--    group by proname having count(*) > 1;
--
-- 2. Con admin:
--    select * from public.fn_resumen_skus(current_date - 30, current_date) limit 5;
--    → filas con margen y costo. Σ ingresos ≈ ventas de 30 días.
--
-- 3. Con un usuario SIN permiso 'costos': costo_*, margen_* y
--    stock_valorizado deben venir NULL (nunca 0 ni el valor).
--
-- 4. Ficha:
--    select public.fn_metricas_sku(<id>, current_date - 30, current_date);
-- ─────────────────────────────────────────────────────────────────────
