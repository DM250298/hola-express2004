-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 198 · fn_sugerencias_compra v4: el quebrado crónico      ║
-- ║  vuelve a pedirse                                                   ║
-- ║  Base: la v3 de la mig 196 ÍNTEGRA, con UN cambio de lógica.        ║
-- ║                                                                     ║
-- ║  El producto que se quedó sin stock hace rato y POR ESO dejó de     ║
-- ║  venderse tiene venta 30d = 0 → velocidad 0 → ninguna de las tres   ║
-- ║  ramas de "requiere compra" da true → sugiere 0 para siempre. Y     ║
-- ║  tampoco lo levanta la alerta crítica: sin ventas no tiene clase    ║
-- ║  ABC, y quiebre_clave filtra por clase. Queda invisible.            ║
-- ║                                                                     ║
-- ║  v4: si estuvo sin stock (y sin vender) N días o más — N =          ║
-- ║  config_compras.dias_quiebre_reposicion_minimo, 10 por defecto —    ║
-- ║  vuelve a pedirse con stock_minimo de piso, igual que un crítico.   ║
-- ║  No hace ruido: quiebres_stock abre evento solo cuando el stock     ║
-- ║  CRUZÓ de >0 a <=0 (mig 172), así que llegar a esa rama ya prueba   ║
-- ║  que el producto tuvo mercadería y se agotó; el catálogo que nunca  ║
-- ║  se stockeó no entra. Además exige stock_minimo > 0.                ║
-- ║                                                                     ║
-- ║  LÍMITE REAL (el comentario de la 196 decía lo contrario y era      ║
-- ║  falso): quiebres_stock mide el stock del SISTEMA, no la góndola;   ║
-- ║  un producto puede figurar quebrado y seguir vendiendo. Por eso la  ║
-- ║  mig 197 descuenta del quiebre los días en que igual se vendió.     ║
-- ║                                                                     ║
-- ║  Firma y columnas de salida idénticas → create or replace, sin      ║
-- ║  drop (el chequeo T1 de duplicadas sigue en 0).                     ║
-- ║  Espejo TS: lib/compras/cobertura.ts · REQUIERE: migs 151, 152,     ║
-- ║  172, 195, 196 y 197. Ejecutar UNA sola vez, COMPLETO.              ║
-- ╚════════════════════════════════════════════════════════════════════╝

create or replace function public.fn_sugerencias_compra(p_proveedor_id integer default null)
returns table (
  producto_id integer, nombre text, codigo_barras text,
  proveedor_id integer, proveedor_nombre text, venta_por_peso boolean,
  es_critico boolean, producto_nuevo boolean,
  stock_actual numeric, stock_minimo numeric, venta_30d numeric,
  venta_diaria numeric, dias_stock numeric, stock_en_transito numeric,
  borrador_pendiente numeric, dias_cobertura_objetivo numeric,
  dias_seguridad numeric, frecuencia_reposicion_dias numeric,
  punto_reposicion numeric, stock_objetivo numeric, requiere_compra boolean,
  cantidad_sugerida numeric, multiplo_compra numeric,
  cantidad_sugerida_redondeada numeric, clase_abc text, precio_costo numeric,
  ultimo_costo numeric, variacion_costo_pct numeric, precio_venta numeric,
  margen_pct numeric, dias_sin_stock_30d numeric, venta_diaria_base numeric,
  factor_quiebre numeric, origen_parametros text
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
      greatest(coalesce(min(cc.factor_maximo_correccion_quiebre), 3), 1) as factor_max,
      -- v4: a partir de acá, el quebrado sin ventas vuelve a pedirse.
      greatest(coalesce(min(cc.dias_quiebre_reposicion_minimo), 10), 1) as d_quiebre
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
  expandido as ( -- la venta de un combo cuenta como venta de sus componentes
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
  quiebres as ( -- días quebrado Y sin vender: lo único que no se pudo vender
    select d.producto_id as pid, d.dias_sin_stock as dsin
    from public.fn__dias_sin_stock(30) d
  ),
  base as (
    select
      p.id, p.nombre, p.codigo_barras,
      p.proveedor_id as prov_id, pr.nombre as prov_nombre,
      p.venta_por_peso, p.es_critico,
      (p.created_at >= now() - interval '30 days') as es_nuevo,
      p.stock_actual, p.stock_minimo, p.precio_venta,
      coalesce(v.u30, 0) as u30,
      coalesce(q.dsin, 0) as dias_sin_stock,
      greatest(30 - coalesce(q.dsin, 0), 30.0 / cfg.factor_max) as dias_con_stock,
      cfg.d_quiebre as d_quiebre_min,
      coalesce(t.en_transito, 0) as en_transito,
      coalesce(b.pendiente, 0) as borrador_pend,
      coalesce(p.dias_cobertura_objetivo, pr.dias_cobertura_objetivo, cfg.d_cob_def) as d_cobertura,
      coalesce(p.dias_seguridad, pr.dias_seguridad, cfg.d_seg_def) as d_seguridad,
      coalesce(
        public.fn_dias_hasta_entrega(pr.dias_toma_pedido, pr.dias_entrega_semana)::numeric,
        pr.frecuencia_reposicion_dias,
        cfg.d_frec_def
      ) as d_frecuencia,
      case -- de dónde salieron los DÍAS (el piso manual no entra acá)
        when p.dias_cobertura_objetivo is not null or p.dias_seguridad is not null then 'sku'
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
    left join quiebres q on q.pid = p.id
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
      greatest( -- objetivo: ni por debajo del punto ni del piso manual
        round(velocidad.vdiaria * velocidad.d_cobertura, 3),
        round(velocidad.vdiaria * (velocidad.d_frecuencia + velocidad.d_seguridad), 3),
        velocidad.objetivo_manual
      ) as objetivo,
      velocidad.stock_actual + velocidad.en_transito as disponible,
      case
        when velocidad.vdiaria > 0
          then (velocidad.stock_actual + velocidad.en_transito)
                 <= round(velocidad.vdiaria * (velocidad.d_frecuencia + velocidad.d_seguridad), 3)
               or (velocidad.objetivo_manual > 0
                   and (velocidad.stock_actual + velocidad.en_transito)
                         < velocidad.objetivo_manual)
        when velocidad.objetivo_manual > 0
          then (velocidad.stock_actual + velocidad.en_transito) < velocidad.objetivo_manual
        -- v4: crítico, nuevo, o QUEBRADO HACE RATO (el que dejó de vender
        -- porque nunca se repuso: sin esto sugería 0 para siempre).
        when velocidad.es_critico or velocidad.es_nuevo
             or velocidad.dias_sin_stock >= velocidad.d_quiebre_min
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
    s.dias_sin_stock, s.vdiaria_base, s.factor, s.origen::text
  from sugerido s
  order by s.prov_nombre nulls last, lower(s.nombre), s.id
$$;

revoke execute on function public.fn_sugerencias_compra(integer) from public, anon;
grant execute on function public.fn_sugerencias_compra(integer) to authenticated;

notify pgrst, 'reload schema';

-- Verificación: los que vuelven a pedirse por quiebre largo (antes: 0 filas).
select nombre, dias_sin_stock_30d, stock_minimo, stock_actual,
       cantidad_sugerida_redondeada
from public.fn_sugerencias_compra()
where venta_diaria = 0 and dias_sin_stock_30d >= 10
order by dias_sin_stock_30d desc, nombre
limit 20;
