-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 152 · Compras por cobertura v2                           ║
-- ║                                                                     ║
-- ║  Dos piezas sobre la base de la 151:                                ║
-- ║                                                                     ║
-- ║  A. SUGERIDO PERSISTIDO: items_pedido guarda qué sugirió el sistema ║
-- ║     (cantidad_sugerida) y por qué el comprador lo cambió            ║
-- ║     (motivo_ajuste). Permite analizar después las decisiones de     ║
-- ║     compra: sugerido vs pedido vs recibido.                         ║
-- ║                                                                     ║
-- ║  B. CALENDARIO REAL: el proveedor puede declarar qué días de la     ║
-- ║     semana toma pedidos y qué días entrega. Si está cargado, el     ║
-- ║     punto de reposición usa los días REALES hasta la próxima        ║
-- ║     entrega posible en lugar de la frecuencia fija.                 ║
-- ║                                                                     ║
-- ║  Reemite fn_actualizar_pedido (base 129: el DELETE + re-INSERT de   ║
-- ║  items tiene la lista de columnas fija — sin esto, editar una       ║
-- ║  orden borraría el sugerido guardado) y fn_sugerencias_compra       ║
-- ║  (base 151, solo cambia el coalesce de la frecuencia). Ambas con    ║
-- ║  CREATE OR REPLACE: misma firma y mismo retorno.                    ║
-- ║                                                                     ║
-- ║  ⚠️ Correr ANTES de deployar el frontend (los ABM y el guardado de  ║
-- ║  órdenes escriben las columnas nuevas). Requiere la 151 corrida.    ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────────────────────
-- 1. Sugerido persistido en el renglón de la orden
-- ─────────────────────────────────────────────────────────────────────
alter table public.items_pedido
  add column if not exists cantidad_sugerida numeric(12,3),
  add column if not exists motivo_ajuste text;

comment on column public.items_pedido.cantidad_sugerida is
  'Lo que sugirió el motor de cobertura al armar la orden (ya redondeado por
   presentación). NULL = renglón cargado a mano, sin sugerencia. Congelado al
   momento de crear/editar la orden: sirve para analizar decisiones de compra.';
comment on column public.items_pedido.motivo_ajuste is
  'Motivo opcional cuando el comprador se apartó fuerte de la sugerencia
   (ej: "bonificación 3x2"). Lo pide la UI solo ante ajustes grandes.';

-- ─────────────────────────────────────────────────────────────────────
-- 2. Calendario semanal del proveedor (0 = domingo … 6 = sábado,
--    convención de extract(dow) y de Date.getDay() en JS)
-- ─────────────────────────────────────────────────────────────────────
alter table public.proveedores
  add column if not exists dias_toma_pedido smallint[]
    check (dias_toma_pedido is null
           or dias_toma_pedido <@ array[0,1,2,3,4,5,6]::smallint[]),
  add column if not exists dias_entrega_semana smallint[]
    check (dias_entrega_semana is null
           or dias_entrega_semana <@ array[0,1,2,3,4,5,6]::smallint[]);

comment on column public.proveedores.dias_toma_pedido is
  'Días de la semana en que el proveedor toma pedidos (0=dom…6=sáb).
   Junto con dias_entrega_semana reemplaza a frecuencia_reposicion_dias
   en el punto de reposición. NULL = usar la frecuencia fija.';
comment on column public.proveedores.dias_entrega_semana is
  'Días de la semana en que el proveedor entrega (0=dom…6=sáb).';

-- ─────────────────────────────────────────────────────────────────────
-- 3. fn_dias_hasta_entrega: cuántos días faltan hasta la próxima
--    entrega posible. Busca el primer día de toma de pedido desde hoy
--    (hoy inclusive) y después la primera entrega ESTRICTAMENTE
--    posterior a ese día. NULL si el calendario no está cargado.
--    Espejo TS: calcularDiasHastaEntrega en lib/compras/cobertura.ts.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_dias_hasta_entrega(
  p_dias_toma smallint[],
  p_dias_entrega smallint[],
  p_desde date default current_date
) returns integer
language sql
stable
as $$
  select min(en.offset_entrega)::integer
  from (
    select min(o.o) as offset_pedido
    from generate_series(0, 6) as o(o)
    where extract(dow from p_desde + o.o)::smallint = any(p_dias_toma)
  ) pe,
  lateral (
    select e.e as offset_entrega
    from generate_series(pe.offset_pedido + 1, pe.offset_pedido + 7) as e(e)
    where extract(dow from p_desde + e.e)::smallint = any(p_dias_entrega)
  ) en
  where p_dias_toma is not null and cardinality(p_dias_toma) > 0
    and p_dias_entrega is not null and cardinality(p_dias_entrega) > 0
$$;

revoke execute on function public.fn_dias_hasta_entrega(smallint[], smallint[], date) from public, anon;
grant execute on function public.fn_dias_hasta_entrega(smallint[], smallint[], date) to authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 4. fn_actualizar_pedido v3 (base 129 ÍNTEGRA + las 2 columnas nuevas
--    en el re-INSERT). Misma firma y retorno → CREATE OR REPLACE.
--    ⚠️ Si en el futuro items_pedido suma otra columna que deba
--    sobrevivir a la edición, hay que agregarla ACÁ también.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_actualizar_pedido(
  p_pedido_id integer,
  p_proveedor_id integer,
  p_fecha_entrega text,
  p_terminos_pago text,
  p_estado text,
  p_items jsonb
) returns public.pedidos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pedido public.pedidos;
  v_total numeric(12, 2) := 0;
  v_item jsonb;
begin
  -- Lock + guarda de estado: sólo se editan órdenes no recibidas.
  select * into v_pedido from public.pedidos where id = p_pedido_id for update;
  if not found then
    raise exception 'El pedido % no existe.', p_pedido_id;
  end if;
  if v_pedido.estado::text not in ('borrador', 'enviado') then
    raise exception 'El pedido % ya no se puede editar (estado: %).',
      p_pedido_id, v_pedido.estado;
  end if;
  if p_estado not in ('borrador', 'enviado') then
    raise exception 'Estado destino inválido: %.', p_estado;
  end if;

  -- Total a partir de los items enviados (cantidad puede ser decimal por kg).
  select coalesce(
           sum((it->>'cantidad_pedida')::numeric * (it->>'precio_costo')::numeric),
           0
         )
    into v_total
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as it;

  update public.pedidos
     set proveedor_id = p_proveedor_id,
         fecha_entrega_esperada = nullif(p_fecha_entrega, '')::date,
         terminos_pago = nullif(p_terminos_pago, ''),
         estado = p_estado::public.estado_pedido,
         total = v_total,
         updated_at = now()
   where id = p_pedido_id
   returning * into v_pedido;

  -- Reemplazo total de items. Seguro porque una orden no recibida no tiene
  -- lotes ni cuentas a pagar colgando de sus items.
  delete from public.items_pedido where pedido_id = p_pedido_id;

  for v_item in
    select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    insert into public.items_pedido
      (pedido_id, producto_id, cantidad_pedida, cantidad_recibida,
       precio_costo, subtotal, cantidad_sugerida, motivo_ajuste)
    values (
      p_pedido_id,
      (v_item->>'producto_id')::integer,
      (v_item->>'cantidad_pedida')::numeric,
      null,
      (v_item->>'precio_costo')::numeric,
      (v_item->>'cantidad_pedida')::numeric * (v_item->>'precio_costo')::numeric,
      (v_item->>'cantidad_sugerida')::numeric,
      nullif(v_item->>'motivo_ajuste', '')
    );
  end loop;

  return v_pedido;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 5. fn_sugerencias_compra (base 151 ÍNTEGRA; el ÚNICO cambio es el
--    coalesce de d_frecuencia: calendario real → frecuencia fija →
--    default global). Misma firma y retorno → CREATE OR REPLACE.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_sugerencias_compra(p_proveedor_id integer default null)
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
    -- defaults de la mig 151.
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
      -- v2: calendario real del proveedor (días hasta la próxima entrega
      -- posible) manda sobre la frecuencia fija; sin calendario, todo
      -- sigue exactamente como en la 151.
      coalesce(
        public.fn_dias_hasta_entrega(pr.dias_toma_pedido, pr.dias_entrega_semana)::numeric,
        pr.frecuencia_reposicion_dias,
        cfg.frecuencia_reposicion_default
      ) as d_frecuencia,
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

notify pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────────
-- Chequeo T1 post-migración (debe devolver 0 filas):
--
--   select proname, count(*) from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and proname like 'fn_%'
--   group by proname having count(*) > 1;
--
-- Smoke del calendario (lunes 2026-08-17: toma lun/mié/vie y entrega
-- mar/jue/sáb → pide hoy lunes, entrega mañana martes = 1):
--
--   select public.fn_dias_hasta_entrega(
--     array[1,3,5]::smallint[], array[2,4,6]::smallint[], date '2026-08-17');
--   -- esperado: 1
-- ─────────────────────────────────────────────────────────────────────
