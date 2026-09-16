-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 196 · Fase G (2/2): fn_sugerencias_compra v3              ║
-- ║                                                                     ║
-- ║  Base: la v2 de la mig 152 ÍNTEGRA. Tres cambios:                   ║
-- ║  1. VELOCIDAD CORREGIDA POR QUIEBRES: si estuvo 12 días sin stock,   ║
-- ║     vendió en 18, así que vende u30/18, no u30/30. Sin esto se       ║
-- ║     sub-compra justo lo que más se quiebra. El tope de config_       ║
-- ║     compras evita que un quebrado crónico pida de más.               ║
-- ║  2. CASCADA POR SKU: producto → proveedor → global.                  ║
-- ║  3. stock_objetivo_manual: piso fijo de exhibición.                  ║
-- ║                                                                     ║
-- ║  Columnas NUEVAS al final: dias_sin_stock_30d, venta_diaria_base,   ║
-- ║  factor_quiebre, origen_parametros → DROP+CREATE (cambia el tipo).   ║
-- ║  Espejo TS: lib/compras/cobertura.ts.                                ║
-- ║  REQUIERE: migs 151, 152, 172 y 195. Ejecutar UNA sola vez.          ║
-- ╚════════════════════════════════════════════════════════════════════╝

drop function if exists public.fn_sugerencias_compra(integer);

create function public.fn_sugerencias_compra(p_proveedor_id integer default null)
returns table (
  producto_id integer,
  nombre text,
  codigo_barras text,
  proveedor_id integer,
  proveedor_nombre text,
  venta_por_peso boolean,
  es_critico boolean,
  producto_nuevo boolean,
  stock_actual numeric,
  stock_minimo numeric,
  venta_30d numeric,
  venta_diaria numeric,
  dias_stock numeric,
  stock_en_transito numeric,
  borrador_pendiente numeric,
  dias_cobertura_objetivo numeric,
  dias_seguridad numeric,
  frecuencia_reposicion_dias numeric,
  punto_reposicion numeric,
  stock_objetivo numeric,
  requiere_compra boolean,
  cantidad_sugerida numeric,
  multiplo_compra numeric,
  cantidad_sugerida_redondeada numeric,
  clase_abc text,
  precio_costo numeric,
  ultimo_costo numeric,
  variacion_costo_pct numeric,
  precio_venta numeric,
  margen_pct numeric,
  dias_sin_stock_30d numeric,
  venta_diaria_base numeric,
  factor_quiebre numeric,
  origen_parametros text
)
language sql
stable
security definer
set search_path = public
as $$
  with cfg as (
    select
      coalesce(min(cc.dias_cobertura_objetivo_default), 14) as d_cob_def,
      coalesce(min(cc.dias_seguridad_default), 2) as d_seg_def,
      coalesce(min(cc.frecuencia_reposicion_default), 7) as d_frec_def,
      greatest(coalesce(min(cc.factor_maximo_correccion_quiebre), 3), 1) as factor_max
    from public.config_compras cc
    where cc.id = 1
  ),
  ventas_fisicas as (
    select iv.producto_id as pid, iv.cantidad,
           coalesce(iv.subtotal, iv.cantidad * iv.precio_unitario) as ingreso
    from public.items_venta iv
    join public.ventas v on v.id = iv.venta_id
    where v.estado = 'completada' and v.fecha >= now() - interval '30 days'
  ),
  expandido as (
    -- la venta de un combo cuenta como venta de sus componentes
    select pc.componente_id as pid, vf.cantidad * pc.cantidad as cantidad
    from ventas_fisicas vf
    join public.producto_componentes pc on pc.producto_id = vf.pid
    union all
    select vf.pid, vf.cantidad
    from ventas_fisicas vf
    where not exists (
      select 1 from public.producto_componentes pc where pc.producto_id = vf.pid
    )
  ),
  venta30 as (select e.pid, sum(e.cantidad) as u30 from expandido e group by e.pid),
  abc as (
    select t.pid,
      case when t.acum <= 0.80 then 'A' when t.acum <= 0.95 then 'B' else 'C' end as clase
    from (
      select vf.pid,
        sum(sum(vf.ingreso)) over (order by sum(vf.ingreso) desc, vf.pid)
          / nullif(sum(sum(vf.ingreso)) over (), 0) as acum
      from ventas_fisicas vf group by vf.pid having sum(vf.ingreso) > 0
    ) t
  ),
  transito as (
    select ip.producto_id as pid,
      sum(greatest(ip.cantidad_pedida - coalesce(ip.cantidad_recibida, 0), 0)) as en_transito
    from public.items_pedido ip
    join public.pedidos pe on pe.id = ip.pedido_id
    where pe.estado in ('enviado', 'recepcion_parcial')
    group by ip.producto_id
  ),
  borradores as (
    select ip.producto_id as pid, sum(ip.cantidad_pedida) as pendiente
    from public.items_pedido ip
    join public.pedidos pe on pe.id = ip.pedido_id
    where pe.estado = 'borrador'
    group by ip.producto_id
  ),
  -- v3: días de la ventana en que NO se pudo vender (mig 195)
  quiebres as (select * from public.fn__dias_sin_stock(30)),
  base as (
    select
      p.id, p.nombre, p.codigo_barras,
      p.proveedor_id as prov_id, pr.nombre as prov_nombre,
      p.venta_por_peso, p.es_critico,
      (p.created_at >= now() - interval '30 days') as es_nuevo,
      p.stock_actual, p.stock_minimo, p.precio_venta,
      coalesce(v.u30, 0) as u30,
      coalesce(q.dias_sin_stock, 0) as dias_sin_stock,
      -- días en que realmente se pudo vender, con el tope de corrección
      greatest(30 - coalesce(q.dias_sin_stock, 0), 30.0 / cfg.factor_max) as dias_con_stock,
      coalesce(t.en_transito, 0) as en_transito,
      coalesce(b.pendiente, 0) as borrador_pend,
      -- v3: cascada SKU → proveedor → global
      coalesce(p.dias_cobertura_objetivo, pr.dias_cobertura_objetivo, cfg.d_cob_def) as d_cobertura,
      coalesce(p.dias_seguridad, pr.dias_seguridad, cfg.d_seg_def) as d_seguridad,
      coalesce(
        public.fn_dias_hasta_entrega(pr.dias_toma_pedido, pr.dias_entrega_semana)::numeric,
        pr.frecuencia_reposicion_dias,
        cfg.d_frec_def
      ) as d_frecuencia,
      case
        when p.dias_cobertura_objetivo is not null or p.dias_seguridad is not null
             or p.stock_objetivo_manual is not null then 'sku'
        when pr.dias_cobertura_objetivo is not null or pr.dias_seguridad is not null
          then 'proveedor'
        else 'global'
      end as origen,
      coalesce(p.stock_objetivo_manual, 0) as objetivo_manual,
      a.clase as clase_abc,
      pp.multiplo_compra, pp.costo as costo_catalogo, c.precio_costo as costo_actual
    from public.productos p
    cross join cfg
    left join venta30 v on v.pid = p.id
    left join quiebres q on q.producto_id = p.id
    left join transito t on t.pid = p.id
    left join borradores b on b.pid = p.id
    left join abc a on a.pid = p.id
    left join public.proveedores pr on pr.id = p.proveedor_id
    left join public.proveedor_producto pp
      on pp.proveedor_id = p.proveedor_id and pp.producto_id = p.id
    left join public.costos_producto c on c.producto_id = p.id
    where p.activo
      and not exists (
        select 1 from public.producto_componentes pc where pc.producto_id = p.id
      )
      and (p_proveedor_id is null or p.proveedor_id = p_proveedor_id)
  ),
  velocidad as (
    select base.*,
      round(base.u30 / 30.0, 3) as vdiaria_base,
      round(base.u30 / base.dias_con_stock, 3) as vdiaria,
      round(30.0 / base.dias_con_stock, 2) as factor
    from base
  ),
  calculado as (
    select velocidad.*,
      round(velocidad.vdiaria * (velocidad.d_frecuencia + velocidad.d_seguridad), 3) as punto,
      -- objetivo: fórmula, nunca por debajo del punto ni del piso manual
      greatest(
        round(velocidad.vdiaria * velocidad.d_cobertura, 3),
        round(velocidad.vdiaria * (velocidad.d_frecuencia + velocidad.d_seguridad), 3),
        velocidad.objetivo_manual
      ) as objetivo,
      velocidad.stock_actual + velocidad.en_transito as disponible,
      case
        when velocidad.vdiaria > 0
          then (velocidad.stock_actual + velocidad.en_transito)
                 <= round(velocidad.vdiaria * (velocidad.d_frecuencia + velocidad.d_seguridad), 3)
        when velocidad.objetivo_manual > 0
          then (velocidad.stock_actual + velocidad.en_transito) < velocidad.objetivo_manual
        when velocidad.es_critico or velocidad.es_nuevo
          then velocidad.stock_minimo > 0
                 and (velocidad.stock_actual + velocidad.en_transito) < velocidad.stock_minimo
        else false
      end as requiere
    from velocidad
  ),
  sugerido as (
    select calculado.*,
      case
        when not calculado.requiere then 0
        when calculado.vdiaria > 0 then greatest(calculado.objetivo - calculado.disponible, 0)
        else greatest(
          greatest(calculado.stock_minimo, calculado.objetivo_manual) - calculado.disponible, 0)
      end as sug
    from calculado
  )
  select
    s.id, s.nombre::text, s.codigo_barras::text,
    s.prov_id, s.prov_nombre::text,
    s.venta_por_peso, s.es_critico, s.es_nuevo,
    s.stock_actual, s.stock_minimo, s.u30, s.vdiaria,
    case when s.vdiaria > 0 then round(s.stock_actual / s.vdiaria, 1) else null end,
    s.en_transito, s.borrador_pend,
    s.d_cobertura, s.d_seguridad, s.d_frecuencia,
    s.punto, s.objetivo, s.requiere,
    round(s.sug, 3),
    s.multiplo_compra,
    case
      when s.sug <= 0 then 0
      when s.multiplo_compra is not null and s.multiplo_compra > 0
        then ceil(s.sug / s.multiplo_compra) * s.multiplo_compra
      when s.venta_por_peso then round(s.sug, 3)
      else ceil(s.sug)
    end,
    s.clase_abc::text,
    case when (select public.fn_tiene_permiso('costos'))
      then coalesce(s.costo_actual, 0) else 0 end,
    case when (select public.fn_tiene_permiso('costos'))
      then s.costo_catalogo else null end,
    case when (select public.fn_tiene_permiso('costos'))
      then round((s.costo_actual - s.costo_catalogo) / nullif(s.costo_catalogo, 0) * 100, 1)
      else null end,
    s.precio_venta,
    case when (select public.fn_tiene_permiso('costos'))
      then round((s.precio_venta - coalesce(s.costo_actual, 0))
                 / nullif(s.precio_venta, 0) * 100, 1)
      else null end,
    s.dias_sin_stock,
    s.vdiaria_base,
    s.factor,
    s.origen::text
  from sugerido s
  order by s.prov_nombre nulls last, lower(s.nombre), s.id
$$;

revoke execute on function public.fn_sugerencias_compra(integer) from public, anon;
grant execute on function public.fn_sugerencias_compra(integer) to authenticated;

notify pgrst, 'reload schema';

-- Verificación: debe dar true. Después, el chequeo T1 y ver qué corrigió
-- (las dos consultas van en el mensaje del chat).
select to_regprocedure('public.fn_sugerencias_compra(integer)') is not null as creada;
