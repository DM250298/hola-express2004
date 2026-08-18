-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 151 · Compras por cobertura (días de stock)              ║
-- ║                                                                     ║
-- ║  Reemplaza el criterio "stock < mínimo" por compras basadas en      ║
-- ║  velocidad de venta y días de cobertura:                            ║
-- ║                                                                     ║
-- ║   · venta_diaria     = unidades vendidas últimos 30 días / 30       ║
-- ║   · dias_stock       = stock_actual / venta_diaria                  ║
-- ║   · en tránsito      = pedido y todavía no recibido (OC abiertas)   ║
-- ║   · punto_reposicion = venta_diaria × (frecuencia + seguridad)      ║
-- ║   · stock_objetivo   = venta_diaria × días de cobertura objetivo    ║
-- ║   · sugerido         = objetivo − stock − tránsito (si requiere)    ║
-- ║                                                                     ║
-- ║  Piezas:                                                            ║
-- ║   1. Config por proveedor (null = usa el default global)            ║
-- ║   2. Defaults globales en config_compras                            ║
-- ║   3. productos.es_critico (independiente del ABC)                   ║
-- ║   4. proveedor_producto.multiplo_compra (presentación: caja x6)     ║
-- ║   5. Índices para el agregado de tránsito y ventas 30d              ║
-- ║   6. fn_sugerencias_compra(p_proveedor_id) — todo en una pasada     ║
-- ║                                                                     ║
-- ║  Todo aditivo e idempotente: solo ADD COLUMN IF NOT EXISTS, dos     ║
-- ║  índices y una función nueva. NO toca fn_productos_a_reponer ni     ║
-- ║  items_pedido ni ningún trigger. No depende de las migs 148-149.    ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ║                                                                     ║
-- ║  ⚠️ Correr ANTES de deployar el frontend: los ABM de proveedor,     ║
-- ║  producto y catálogo escriben las columnas nuevas; sin la           ║
-- ║  migración, guardar cualquier proveedor/producto da error 400       ║
-- ║  (mismo criterio que la mig 150 con stock_minimo).                  ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────────────────────
-- 1. Config de reposición por proveedor (null = default global)
-- ─────────────────────────────────────────────────────────────────────
alter table public.proveedores
  add column if not exists dias_cobertura_objetivo numeric(6,1)
    check (dias_cobertura_objetivo is null or dias_cobertura_objetivo > 0),
  add column if not exists dias_seguridad numeric(6,1)
    check (dias_seguridad is null or dias_seguridad >= 0),
  add column if not exists frecuencia_reposicion_dias numeric(6,1)
    check (frecuencia_reposicion_dias is null or frecuencia_reposicion_dias > 0);

comment on column public.proveedores.dias_cobertura_objetivo is
  'Días de venta que se busca dejar cubiertos al reponer. NULL = usa el default de config_compras.';
comment on column public.proveedores.dias_seguridad is
  'Colchón en días para el punto de reposición. NULL = default global.';
comment on column public.proveedores.frecuencia_reposicion_dias is
  'Cada cuántos días se le pide habitualmente a este proveedor. Distinto de
   dias_entrega (lead time de entrega de la OC): la frecuencia define CUÁNDO
   comprar, el lead time cuándo llega. NULL = default global.';

-- ─────────────────────────────────────────────────────────────────────
-- 2. Defaults globales (singleton config_compras, id = 1)
-- ─────────────────────────────────────────────────────────────────────
alter table public.config_compras
  add column if not exists dias_cobertura_objetivo_default numeric(6,1) not null default 14
    check (dias_cobertura_objetivo_default > 0),
  add column if not exists dias_seguridad_default numeric(6,1) not null default 2
    check (dias_seguridad_default >= 0),
  add column if not exists frecuencia_reposicion_default numeric(6,1) not null default 7
    check (frecuencia_reposicion_default > 0),
  add column if not exists umbral_sobrestock_dias numeric(6,1)
    check (umbral_sobrestock_dias is null or umbral_sobrestock_dias > 0);

comment on column public.config_compras.umbral_sobrestock_dias is
  'Días de cobertura a partir de los cuales un producto se marca SOBRESTOCK.
   NULL = dinámico: 2 × la cobertura objetivo efectiva del producto.';

-- ─────────────────────────────────────────────────────────────────────
-- 3. Producto crítico: el cliente espera encontrarlo SIEMPRE, aunque
--    por facturación no sea clase A. Habilita sugerencias aun sin
--    ventas recientes (usa stock_minimo como piso).
-- ─────────────────────────────────────────────────────────────────────
alter table public.productos
  add column if not exists es_critico boolean not null default false;

comment on column public.productos.es_critico is
  'Producto que no puede faltar (independiente de la clase ABC). Sin ventas
   en 30 días igual sugiere compra usando stock_minimo como piso.';

-- ─────────────────────────────────────────────────────────────────────
-- 4. Presentación de compra por proveedor-producto (caja x6, pack x12).
--    La sugerencia se redondea HACIA ARRIBA a este múltiplo.
-- ─────────────────────────────────────────────────────────────────────
alter table public.proveedor_producto
  add column if not exists multiplo_compra numeric(12,3)
    check (multiplo_compra is null or multiplo_compra > 0);

comment on column public.proveedor_producto.multiplo_compra is
  'Unidades por bulto en que vende este proveedor (caja x6 = 6). NULL = suelto.
   numeric por los productos por peso (ej: horma de 3,5 kg).';

-- ─────────────────────────────────────────────────────────────────────
-- 5. Índices
--    · items_pedido solo tenía índice por pedido_id y cuenta: el agregado
--      de tránsito por producto barría la tabla entera.
--    · ventas: el par (estado, fecha) evita filtrar 'completada' fila por
--      fila sobre el índice de fecha en la ventana de 30 días.
-- ─────────────────────────────────────────────────────────────────────
create index if not exists idx_items_pedido_producto
  on public.items_pedido(producto_id);
create index if not exists ventas_estado_fecha_idx
  on public.ventas(estado, fecha desc);

-- ─────────────────────────────────────────────────────────────────────
-- 6. fn_sugerencias_compra — el cálculo completo en una sola pasada.
--
--    Decisiones (confirmadas con el negocio):
--    · Velocity: items_venta 30d con ventas 'completada', EXPANDIDA por
--      producto_componentes (la venta de un combo acredita velocidad a
--      sus componentes, que son lo que se compra). Los combos quedan
--      FUERA del listado: no se compran, se arman.
--    · Tránsito: OC en 'enviado' o 'recepcion_parcial', neto de lo ya
--      recibido, con greatest(...,0) por sobre-recepciones. Los estados
--      cubren las 3 trampas conocidas: "Cerrar recepción" (recibido con
--      faltante permanente), "no vino" (renglones borrados/reducidos) y
--      cierre por agregado.
--    · Borradores: NO suman al tránsito (no están comprometidos con el
--      proveedor); van en borrador_pendiente para avisar en la UI.
--    · Sin ventas 30d: dias_stock NULL y sin sugerencia automática,
--      SALVO producto crítico o nuevo (created_at < 30 días), que usan
--      stock_minimo como piso.
--    · ABC: misma fórmula que la pantalla de ranking (ingresos por SKU
--      tal como se vendió, acumulado 80% / 95%). Un componente vendido
--      solo dentro de combos no tiene ingresos propios → clase NULL.
--    · Costos gateados por permiso 'costos' (la función es security
--      definer y saltea RLS: el gate va inline, patrón mig 110).
--    · Estados visuales (rojo/naranja/verde/gris/sobrestock) NO se
--      calculan acá: viven en lib/compras/cobertura.ts para poder
--      tunearse sin migración.
--
--    ORDER BY estable (proveedor, nombre, id): el Max Rows de PostgREST
--    (1000) corta también a las funciones set-returning, el cliente
--    pagina con .range() vía traerTodo() — gotcha mig 104.
-- ─────────────────────────────────────────────────────────────────────
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
  margen_pct numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with cfg as (
    -- Agregado sin GROUP BY: SIEMPRE devuelve una fila, aun si alguien
    -- borró el singleton de config_compras (sin esto, el cross join de
    -- abajo devolvería 0 filas en silencio). Los coalesce repiten los
    -- defaults de la sección 2.
    select
      coalesce(min(cc.dias_cobertura_objetivo_default), 14) as dias_cobertura_objetivo_default,
      coalesce(min(cc.dias_seguridad_default), 2) as dias_seguridad_default,
      coalesce(min(cc.frecuencia_reposicion_default), 7) as frecuencia_reposicion_default
    from public.config_compras cc
    where cc.id = 1
  ),
  ventas_fisicas as (
    select
      iv.producto_id as pid,
      iv.cantidad,
      coalesce(iv.subtotal, iv.cantidad * iv.precio_unitario) as ingreso
    from public.items_venta iv
    join public.ventas v on v.id = iv.venta_id
    where v.estado = 'completada'
      and v.fecha >= now() - interval '30 days'
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
  venta30 as (
    select e.pid, sum(e.cantidad) as u30
    from expandido e
    group by e.pid
  ),
  abc as (
    -- espeja lib/queries/clasificacionAbc.ts: acumulado de ingresos desc,
    -- A hasta 80%, B hasta 95%, C el resto (solo SKUs con ingresos > 0)
    select t.pid,
      case
        when t.acum <= 0.80 then 'A'
        when t.acum <= 0.95 then 'B'
        else 'C'
      end as clase
    from (
      select vf.pid,
        sum(sum(vf.ingreso)) over (order by sum(vf.ingreso) desc, vf.pid)
          / nullif(sum(sum(vf.ingreso)) over (), 0) as acum
      from ventas_fisicas vf
      group by vf.pid
      having sum(vf.ingreso) > 0
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
  base as (
    select
      p.id,
      p.nombre,
      p.codigo_barras,
      p.proveedor_id as prov_id,
      pr.nombre as prov_nombre,
      p.venta_por_peso,
      p.es_critico,
      (p.created_at >= now() - interval '30 days') as es_nuevo,
      p.stock_actual,
      p.stock_minimo,
      p.precio_venta,
      coalesce(v.u30, 0) as u30,
      round(coalesce(v.u30, 0) / 30.0, 3) as vdiaria,
      coalesce(t.en_transito, 0) as en_transito,
      coalesce(b.pendiente, 0) as borrador_pend,
      coalesce(pr.dias_cobertura_objetivo, cfg.dias_cobertura_objetivo_default) as d_cobertura,
      coalesce(pr.dias_seguridad, cfg.dias_seguridad_default) as d_seguridad,
      coalesce(pr.frecuencia_reposicion_dias, cfg.frecuencia_reposicion_default) as d_frecuencia,
      a.clase as clase_abc,
      pp.multiplo_compra,
      pp.costo as costo_catalogo,
      c.precio_costo as costo_actual
    from public.productos p
    cross join cfg
    left join venta30 v on v.pid = p.id
    left join transito t on t.pid = p.id
    left join borradores b on b.pid = p.id
    left join abc a on a.pid = p.id
    left join public.proveedores pr on pr.id = p.proveedor_id
    left join public.proveedor_producto pp
      on pp.proveedor_id = p.proveedor_id and pp.producto_id = p.id
    left join public.costos_producto c on c.producto_id = p.id
    where p.activo
      -- los combos no se compran: se arman con sus componentes
      and not exists (
        select 1 from public.producto_componentes pc where pc.producto_id = p.id
      )
      and (p_proveedor_id is null or p.proveedor_id = p_proveedor_id)
  ),
  calculado as (
    select
      base.*,
      round(base.vdiaria * (base.d_frecuencia + base.d_seguridad), 3) as punto,
      -- El objetivo nunca queda debajo del punto: con una config incoherente
      -- (cobertura < frecuencia + seguridad) la fila diría "requiere compra"
      -- con sugerido 0. Se clampa acá y en el motor TS (calcularCobertura).
      greatest(
        round(base.vdiaria * base.d_cobertura, 3),
        round(base.vdiaria * (base.d_frecuencia + base.d_seguridad), 3)
      ) as objetivo,
      base.stock_actual + base.en_transito as disponible,
      -- requiere: con ventas, disponible proyectado en el punto o abajo;
      -- sin ventas, solo crítico/nuevo con stock_minimo como piso
      case
        when base.vdiaria > 0
          then (base.stock_actual + base.en_transito)
                 <= round(base.vdiaria * (base.d_frecuencia + base.d_seguridad), 3)
        when base.es_critico or base.es_nuevo
          then base.stock_minimo > 0
                 and (base.stock_actual + base.en_transito) < base.stock_minimo
        else false
      end as requiere
    from base
  ),
  sugerido as (
    select
      calculado.*,
      case
        when not calculado.requiere then 0
        when calculado.vdiaria > 0
          then greatest(calculado.objetivo - calculado.disponible, 0)
        else greatest(calculado.stock_minimo - calculado.disponible, 0)
      end as sug
    from calculado
  )
  select
    s.id as producto_id,
    s.nombre::text,
    s.codigo_barras::text,
    s.prov_id as proveedor_id,
    s.prov_nombre::text as proveedor_nombre,
    s.venta_por_peso,
    s.es_critico,
    s.es_nuevo as producto_nuevo,
    s.stock_actual,
    s.stock_minimo,
    s.u30 as venta_30d,
    s.vdiaria as venta_diaria,
    case when s.vdiaria > 0
      then round(s.stock_actual / s.vdiaria, 1)
      else null
    end as dias_stock,
    s.en_transito as stock_en_transito,
    s.borrador_pend as borrador_pendiente,
    s.d_cobertura as dias_cobertura_objetivo,
    s.d_seguridad as dias_seguridad,
    s.d_frecuencia as frecuencia_reposicion_dias,
    s.punto as punto_reposicion,
    s.objetivo as stock_objetivo,
    s.requiere as requiere_compra,
    round(s.sug, 3) as cantidad_sugerida,
    s.multiplo_compra,
    -- redondeo por presentación: SIEMPRE hacia arriba al múltiplo; sin
    -- múltiplo, 3 decimales si es por peso, techo entero si es por unidad
    case
      when s.sug <= 0 then 0
      when s.multiplo_compra is not null and s.multiplo_compra > 0
        then ceil(s.sug / s.multiplo_compra) * s.multiplo_compra
      when s.venta_por_peso then round(s.sug, 3)
      else ceil(s.sug)
    end as cantidad_sugerida_redondeada,
    s.clase_abc::text,
    case when (select public.fn_tiene_permiso('costos'))
      then coalesce(s.costo_actual, 0)
      else 0
    end as precio_costo,
    case when (select public.fn_tiene_permiso('costos'))
      then s.costo_catalogo
      else null
    end as ultimo_costo,
    case when (select public.fn_tiene_permiso('costos'))
      then round(
        (s.costo_actual - s.costo_catalogo) / nullif(s.costo_catalogo, 0) * 100, 1)
      else null
    end as variacion_costo_pct,
    s.precio_venta,
    case when (select public.fn_tiene_permiso('costos'))
      then round(
        (s.precio_venta - coalesce(s.costo_actual, 0))
          / nullif(s.precio_venta, 0) * 100, 1)
      else null
    end as margen_pct
  from sugerido s
  order by s.prov_nombre nulls last, lower(s.nombre), s.id
$$;

revoke execute on function public.fn_sugerencias_compra(integer) from public, anon;
grant execute on function public.fn_sugerencias_compra(integer) to authenticated;

notify pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────────
-- Chequeo T1 post-migración (debe devolver 0 filas):
--
--   select proname, count(*) from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and proname like 'fn_%'
--   group by proname having count(*) > 1;
--
-- Smoke test (con un admin y con un usuario SIN permiso costos —
-- el segundo debe ver precio_costo = 0 y ultimo_costo/margen NULL):
--
--   select * from public.fn_sugerencias_compra() limit 5;
--   select * from public.fn_sugerencias_compra(1) limit 5;
-- ─────────────────────────────────────────────────────────────────────
