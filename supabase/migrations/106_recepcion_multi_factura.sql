-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 106 · Recepción multi-factura (Fase 1: base + RPC)        ║
-- ║                                                                     ║
-- ║  Hasta ahora: 1 pedido → 1 deuda provisoria → 1 factura.            ║
-- ║  Realidad: una entrega del proveedor trae VARIAS facturas.          ║
-- ║  Decisión (2026-07-12): cada factura es su propia cuenta a pagar.  ║
-- ║                                                                     ║
-- ║  Esta fase deja lista la base y el RPC de recepción para crear      ║
-- ║  UNA deuda provisoria POR FACTURA. La UI que la alimenta (recepción ║
-- ║  móvil) va en la Fase 2; hasta entonces los callers actuales, que   ║
-- ║  NO mandan factura, siguen creando UNA sola deuda (comportamiento   ║
-- ║  idéntico). 100% backward-compatible (misma firma del RPC).         ║
-- ║                                                                     ║
-- ║  Cambios:                                                           ║
-- ║   1) cuentas_a_pagar.numero_factura  (nro tal como lo tipeó el que  ║
-- ║      recibió; NULL = deuda sin factura identificada).              ║
-- ║   2) items_pedido.cuenta_a_pagar_id  (a qué factura/deuda se        ║
-- ║      imputó cada renglón recibido; lo usa la pestaña Facturas para  ║
-- ║      cargar cada factura con sus items).                            ║
-- ║   3) fn_recibir_pedido: agrupa p_items por 'factura_ref' y crea/    ║
-- ║      reusa una provisoria por factura. Sin factura → grupo default. ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─── 1) Columnas nuevas ─────────────────────────────────────────────
alter table public.cuentas_a_pagar
  add column if not exists numero_factura text;

comment on column public.cuentas_a_pagar.numero_factura is
  'Nº de factura identificado al recibir (una deuda por factura). NULL = deuda sin factura identificada.';

alter table public.items_pedido
  add column if not exists cuenta_a_pagar_id integer;

comment on column public.items_pedido.cuenta_a_pagar_id is
  'Cuenta a pagar (= factura) a la que se imputó lo recibido de este renglón. La pestaña Facturas carga cada factura con sus items via esta columna.';

create index if not exists idx_items_pedido_cuenta
  on public.items_pedido (cuenta_a_pagar_id);

-- ─── 2) fn_recibir_pedido: una provisoria por factura ───────────────
--   Base: 076. El loop por item (stock, movimientos, lotes, historial de
--   costos, proveedor_producto) queda IDÉNTICO. Sólo cambia el bloque de
--   la cuenta a pagar: en vez de una sola, agrupa por factura.
--   Firma idéntica → CREATE OR REPLACE reemplaza limpio.
create or replace function public.fn_recibir_pedido(
  p_pedido_id integer,
  p_proveedor_id integer,
  p_usuario_id uuid,
  p_condicion_pago_dias integer,
  p_items jsonb
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_ahora timestamptz := now();
  v_item jsonb;
  v_item_id integer;
  v_prod_id integer;
  v_cant numeric;
  v_precio numeric;
  v_venc date;
  v_stock_ant numeric;
  v_stock_nuevo numeric;
  v_cuenta_id integer;
  v_costo_ant numeric;
  v_var_pct numeric;
  v_umbral numeric;
  v_variaciones jsonb := '[]'::jsonb;
  v_total_acumulado numeric := 0;
  v_total_pedido numeric;
  v_total_recibido_unid numeric;
  v_estado text;
  -- Multi-factura
  v_fact record;
  v_cuentas jsonb := '[]'::jsonb;
  v_primera_cuenta integer := null;
begin
  select coalesce(umbral_variacion_costo, 10) into v_umbral
    from public.config_compras where id = 1;
  v_umbral := coalesce(v_umbral, 10);

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_item_id := (v_item->>'item_id')::integer;
    v_prod_id := (v_item->>'producto_id')::integer;
    v_cant := (v_item->>'cantidad_recibida')::numeric;
    v_precio := (v_item->>'precio_costo')::numeric;
    v_venc := nullif(v_item->>'fecha_vencimiento', '')::date;

    -- ACUMULA: suma lo recibido ahora a lo que ya había. El subtotal del
    -- item queda en el valor recibido acumulado (usa el costo del item).
    update public.items_pedido
      set cantidad_recibida = coalesce(cantidad_recibida, 0) + v_cant,
          subtotal = (coalesce(cantidad_recibida, 0) + v_cant) * precio_costo
      where id = v_item_id;

    if v_cant <= 0 then continue; end if;

    select stock_actual into v_stock_ant
      from public.productos where id = v_prod_id for update;
    v_stock_ant := coalesce(v_stock_ant, 0);
    v_costo_ant := public.fn_costo(v_prod_id);
    v_stock_nuevo := v_stock_ant + v_cant;
    update public.productos set stock_actual = v_stock_nuevo, updated_at = v_ahora
      where id = v_prod_id;

    insert into public.movimientos_stock (
      producto_id, tipo, cantidad, stock_anterior, stock_nuevo,
      referencia_id, usuario_id, nota
    ) values (
      v_prod_id, 'entrada', v_cant, v_stock_ant, v_stock_nuevo,
      p_pedido_id, p_usuario_id, 'Recepción de pedido #' || p_pedido_id
    );

    if v_venc is not null then
      insert into public.lotes (
        producto_id, fecha_vencimiento, cantidad_inicial, cantidad_actual, estado, pedido_origen_id
      ) values (v_prod_id, v_venc, v_cant, v_cant, 'activo', p_pedido_id);
    end if;

    if v_costo_ant > 0 and v_precio > 0 then
      v_var_pct := round(((v_precio - v_costo_ant) / v_costo_ant) * 100, 2);
    else v_var_pct := 0; end if;

    if v_var_pct <> 0 then
      insert into public.historial_costos (
        producto_id, proveedor_id, costo_anterior, costo_nuevo,
        variacion_pct, origen, pedido_id, usuario_id
      ) values (
        v_prod_id, p_proveedor_id, v_costo_ant, v_precio,
        v_var_pct, 'recepcion', p_pedido_id, p_usuario_id
      );
      if v_var_pct >= v_umbral then
        v_variaciones := v_variaciones || jsonb_build_object(
          'producto_id', v_prod_id, 'costo_anterior', v_costo_ant,
          'costo_nuevo', v_precio, 'variacion_pct', v_var_pct);
      end if;
    end if;

    insert into public.proveedor_producto (proveedor_id, producto_id, costo, es_principal, updated_at)
    values (p_proveedor_id, v_prod_id, v_precio, false, v_ahora)
    on conflict (proveedor_id, producto_id)
    do update set costo = excluded.costo, updated_at = v_ahora;
  end loop;

  -- Total acumulado real (robusto ante recepciones sucesivas) + unidades
  -- para decidir si el pedido quedó completo o sigue parcial.
  select coalesce(sum(coalesce(cantidad_recibida, 0) * precio_costo), 0),
         coalesce(sum(cantidad_pedida), 0),
         coalesce(sum(coalesce(cantidad_recibida, 0)), 0)
    into v_total_acumulado, v_total_pedido, v_total_recibido_unid
    from public.items_pedido where pedido_id = p_pedido_id;

  if v_total_recibido_unid >= v_total_pedido then v_estado := 'recibido';
  else v_estado := 'recepcion_parcial'; end if;

  update public.pedidos
    set estado = v_estado::public.estado_pedido, total = v_total_acumulado, updated_at = v_ahora
    where id = p_pedido_id;

  -- ── Cuentas a pagar provisorias: UNA POR FACTURA ──────────────────
  --   Cada item puede traer 'factura_ref' (agrupador de esta entrega) y
  --   'numero_factura'. Sin factura_ref → grupo '__default__' (numero NULL),
  --   que reproduce el comportamiento histórico de una sola deuda.
  --
  --   Paso 1: para cada factura que recibió algo en esta entrega, crea/reusa su
  --   provisoria (match por numero) e IMPUTA sus renglones (cuenta_a_pagar_id).
  --   NO calcula el monto acá: eso se hace en el paso 2 sobre TODAS las
  --   provisorias, para no dejar montos obsoletos cuando un renglón migra de
  --   factura entre recepciones (double-count).
  for v_fact in
    select
      coalesce(nullif(v_i->>'factura_ref', ''), '__default__') as ref,
      nullif(btrim(max(v_i->>'numero_factura')), '') as numero
    from jsonb_array_elements(p_items) v_i
    group by 1
    having sum(coalesce((v_i->>'cantidad_recibida')::numeric, 0)) > 0
  loop
    select id into v_cuenta_id from public.cuentas_a_pagar
      where pedido_id = p_pedido_id and tiene_factura = false
        and coalesce(numero_factura, '') = coalesce(v_fact.numero, '')
      order by id desc limit 1;
    if v_cuenta_id is null then
      insert into public.cuentas_a_pagar (
        pedido_id, proveedor_id, monto, fecha_vencimiento, estado,
        provisoria, tiene_factura, numero_factura
      ) values (
        p_pedido_id, p_proveedor_id, 0,
        current_date + p_condicion_pago_dias, 'pendiente', true, false, v_fact.numero
      ) returning id into v_cuenta_id;
    else
      update public.cuentas_a_pagar
        set proveedor_id = p_proveedor_id,
            fecha_vencimiento = current_date + p_condicion_pago_dias,
            numero_factura = coalesce(v_fact.numero, numero_factura)
        where id = v_cuenta_id;
    end if;

    update public.items_pedido
      set cuenta_a_pagar_id = v_cuenta_id
      where pedido_id = p_pedido_id
        and id in (
          select (v_i->>'item_id')::integer
          from jsonb_array_elements(p_items) v_i
          where coalesce(nullif(v_i->>'factura_ref', ''), '__default__') = v_fact.ref
        );
  end loop;

  -- Salvaguarda: recepción sin ninguna provisoria (p. ej. no se recibió nada
  -- nuevo y no había ninguna). Crea la default e imputa los renglones sueltos
  -- (los que NO quedaron ya en otra factura), sin pisar imputaciones previas.
  if not exists (
    select 1 from public.cuentas_a_pagar
    where pedido_id = p_pedido_id and tiene_factura = false
  ) then
    insert into public.cuentas_a_pagar (
      pedido_id, proveedor_id, monto, fecha_vencimiento, estado, provisoria, tiene_factura
    ) values (
      p_pedido_id, p_proveedor_id, 0,
      current_date + p_condicion_pago_dias, 'pendiente', true, false
    ) returning id into v_cuenta_id;
    update public.items_pedido set cuenta_a_pagar_id = v_cuenta_id
      where pedido_id = p_pedido_id and cuenta_a_pagar_id is null;
  end if;

  -- Paso 2: RECONCILIA. Recalcula el monto de CADA provisoria del pedido desde
  -- sus renglones imputados, y borra las que quedaron sin renglones (un ítem
  -- pudo migrar de factura). Garantiza sum(montos provisorios) = total recibido.
  update public.cuentas_a_pagar c
    set monto = coalesce((
      select sum(coalesce(ip.cantidad_recibida, 0) * ip.precio_costo)
      from public.items_pedido ip where ip.cuenta_a_pagar_id = c.id
    ), 0)
    where c.pedido_id = p_pedido_id and c.tiene_factura = false;

  delete from public.cuentas_a_pagar c
    where c.pedido_id = p_pedido_id and c.tiene_factura = false
      and not exists (
        select 1 from public.items_pedido ip where ip.cuenta_a_pagar_id = c.id
      );

  -- Resultado: las provisorias que sobrevivieron.
  select id into v_primera_cuenta from public.cuentas_a_pagar
    where pedido_id = p_pedido_id and tiene_factura = false
    order by id limit 1;
  select coalesce(jsonb_agg(
      jsonb_build_object(
        'cuenta_a_pagar_id', id, 'numero_factura', numero_factura, 'monto', monto
      ) order by id
    ), '[]'::jsonb)
    into v_cuentas
    from public.cuentas_a_pagar
    where pedido_id = p_pedido_id and tiene_factura = false;

  return jsonb_build_object(
    'cuenta_a_pagar_id', v_primera_cuenta,
    'cuentas', v_cuentas,
    'total_recibido', v_total_acumulado,
    'es_parcial', (v_estado = 'recepcion_parcial'),
    'variaciones', v_variaciones
  );
end;
$$;

notify pgrst, 'reload schema';
