-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 167 · La recepción no toca precios ni costos             ║
-- ║                                                                     ║
-- ║  Pedido del dueño: "el precio se tiene que actualizar al guardar la ║
-- ║  factura, no cuando pasa por recepción". Recibir queda como un acto ║
-- ║  puramente FÍSICO: stock, lotes y el log de variación de costo.     ║
-- ║  El costo real recién se conoce con el papel de la factura.         ║
-- ║                                                                     ║
-- ║  Único cambio de conducta: el upsert de proveedor_producto.costo    ║
-- ║  pasa a ser un insert pelado con `on conflict do nothing`, así la    ║
-- ║  recepción nunca PISA un costo ya cargado (pero sigue sembrando el  ║
-- ║  par proveedor↔producto la primera vez, que es lo que necesita      ║
-- ║  fn_guardar_factura_compra para poder actualizarlo después).        ║
-- ║                                                                     ║
-- ║  Lo que NO cambia: stock, movimientos, lotes, deudas multi-factura, ║
-- ║  "no vino", orden_recepcion, historial_costos (origen 'recepcion',  ║
-- ║  que es un log y alimenta la alerta de variación del que recibe).   ║
-- ║                                                                     ║
-- ║  Base: mig 137 (firma de 6 args). Se reemite con la MISMA firma —   ║
-- ║  create or replace, sin drop— para no dejar una sobrecarga viva.    ║
-- ╚════════════════════════════════════════════════════════════════════╝

create or replace function public.fn_recibir_pedido(
  p_pedido_id integer,
  p_proveedor_id integer,
  p_usuario_id uuid,
  p_condicion_pago_dias integer,
  p_items jsonb,
  p_no_vino jsonb default '[]'::jsonb
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
  -- No vino + orden (mig 137)
  v_estado_actual text;
  v_orden integer;
  v_nv_id integer;
  v_nv public.items_pedido%rowtype;
  v_eliminados jsonb := '[]'::jsonb;
  v_reducidos jsonb := '[]'::jsonb;
begin
  -- Guarda de estado (mig 137): traba la fila del pedido y rechaza la doble
  -- recepción (con la política "completa o nada" todo pedido termina en
  -- 'recibido'; un reintento sobre uno ya recibido duplicaría stock).
  select estado::text into v_estado_actual
    from public.pedidos where id = p_pedido_id for update;
  if v_estado_actual is null then
    raise exception 'El pedido #% no existe.', p_pedido_id;
  end if;
  if v_estado_actual not in ('enviado', 'recepcion_parcial') then
    raise exception 'El pedido ya fue recibido (estado actual: %).', v_estado_actual;
  end if;

  select coalesce(umbral_variacion_costo, 10) into v_umbral
    from public.config_compras where id = 1;
  v_umbral := coalesce(v_umbral, 10);

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_item_id := (v_item->>'item_id')::integer;
    v_prod_id := (v_item->>'producto_id')::integer;
    v_cant := (v_item->>'cantidad_recibida')::numeric;
    v_precio := (v_item->>'precio_costo')::numeric;
    v_venc := nullif(v_item->>'fecha_vencimiento', '')::date;
    v_orden := nullif(v_item->>'orden', '')::integer;

    -- ACUMULA: suma lo recibido ahora a lo que ya había. El subtotal del
    -- item queda en el valor recibido acumulado (usa el costo del item).
    -- El orden de escaneo se escribe una sola vez: la primera asignación
    -- gana (no se pisa el orden de una entrega anterior).
    update public.items_pedido
      set cantidad_recibida = coalesce(cantidad_recibida, 0) + v_cant,
          subtotal = (coalesce(cantidad_recibida, 0) + v_cant) * precio_costo,
          orden_recepcion = coalesce(orden_recepcion, v_orden)
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

    -- ── mig 167: la recepción NO fija costos ──────────────────────────
    --   Acá iba un upsert con `costo = v_precio`, que es el costo del RENGLÓN
    --   DE LA ORDEN (lo que se pidió), no lo que factura el proveedor: la
    --   recepción móvil manda `items_pedido.precio_costo` y para un producto
    --   agregado al vuelo manda 0. O sea: escribía un costo viejo, o cero.
    --   Ahora el único que escribe plata es fn_guardar_factura_compra, con el
    --   costo LANDED real, al guardar la factura.
    --   Queda un insert PELADO (sin costo) porque fn_guardar_factura_compra
    --   hace UPDATE sobre esta tabla, nunca INSERT: sin la fila, el catálogo
    --   N:M del proveedor no volvería a crecer y ese update no encontraría
    --   nada que pisar. `costo` queda en su default 0 = "sin dato todavía", y
    --   el `do nothing` garantiza que jamás se pisa un costo ya cargado.
    insert into public.proveedor_producto (proveedor_id, producto_id, es_principal, updated_at)
    values (p_proveedor_id, v_prod_id, false, v_ahora)
    on conflict (proveedor_id, producto_id) do nothing;
  end loop;

  -- ── "No vino" (mig 137): renglones confirmados como faltantes ──────
  --   Corre DESPUÉS del loop (ya está acumulado lo de esta entrega) y
  --   ANTES del cálculo de estado/total, así el pedido queda completo y
  --   pedidos.total sale solo de los renglones que sobreviven. La
  --   reconciliación multi-factura de más abajo limpia las provisorias
  --   que queden sin renglones.
  for v_nv_id in
    select distinct x::integer
    from jsonb_array_elements_text(coalesce(p_no_vino, '[]'::jsonb)) x
  loop
    select * into v_nv from public.items_pedido
      where id = v_nv_id and pedido_id = p_pedido_id for update;
    -- Id ajeno al pedido o renglón ya eliminado (reintento): no-op.
    if not found then continue; end if;
    -- Defensivo: un renglón ya facturado no se toca (la factura lo referencia).
    if v_nv.cantidad_facturada is not null then continue; end if;

    if coalesce(v_nv.cantidad_recibida, 0) <= 0 then
      -- Nunca se recibió nada (ni antes ni ahora): se elimina de la orden.
      delete from public.items_pedido where id = v_nv_id;
      v_eliminados := v_eliminados || jsonb_build_object(
        'item_id', v_nv_id, 'producto_id', v_nv.producto_id,
        'cantidad_pedida', v_nv.cantidad_pedida);
    elsif coalesce(v_nv.cantidad_recibida, 0) < v_nv.cantidad_pedida then
      -- Vino incompleto: la pedida baja a lo recibido total. Solo reduce.
      update public.items_pedido
        set cantidad_pedida = v_nv.cantidad_recibida,
            subtotal = v_nv.cantidad_recibida * precio_costo
        where id = v_nv_id;
      v_reducidos := v_reducidos || jsonb_build_object(
        'item_id', v_nv_id, 'producto_id', v_nv.producto_id,
        'pedida_anterior', v_nv.cantidad_pedida,
        'pedida_nueva', v_nv.cantidad_recibida);
    end if;
    -- recibido >= pedida: no-op (jamás se aumenta la pedida por acá).
  end loop;

  if jsonb_array_length(v_eliminados) > 0 or jsonb_array_length(v_reducidos) > 0 then
    if not exists (
      select 1 from public.items_pedido where pedido_id = p_pedido_id
    ) then
      raise exception 'La orden quedaría vacía: si no vino nada, cancelá la orden en vez de recibirla.';
    end if;
    perform public.fn_auditar(
      p_usuario_id, 'recepcion_no_vino', 'pedido', p_pedido_id,
      jsonb_build_object('eliminados', v_eliminados, 'reducidos', v_reducidos)
    );
  end if;

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

    update public.items_pedido ip
      set cuenta_a_pagar_id = v_cuenta_id
      where ip.pedido_id = p_pedido_id
        and ip.id in (
          select (v_i->>'item_id')::integer
          from jsonb_array_elements(p_items) v_i
          where coalesce(nullif(v_i->>'factura_ref', ''), '__default__') = v_fact.ref
        )
        -- No mover renglones que ya están en una deuda BLOQUEADA (con factura
        -- cargada o con pagos): esa deuda queda congelada, así no se rompe la
        -- contabilidad ni el historial de pagos.
        and not exists (
          select 1 from public.cuentas_a_pagar cbl
          where cbl.id = ip.cuenta_a_pagar_id
            and (
              cbl.tiene_factura = true
              or coalesce(cbl.monto_pagado, 0) > 0
              or exists (
                select 1 from public.pagos_cuenta pg
                where pg.cuenta_a_pagar_id = cbl.id
              )
            )
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

  -- Paso 2: RECONCILIA. Recalcula el monto de cada provisoria NO bloqueada del
  -- pedido desde sus renglones imputados, y borra las que quedan sin renglones
  -- (un ítem pudo migrar de factura). Garantiza que sum(montos) = total recibido
  -- para las deudas todavía abiertas. Las deudas con pagos quedan CONGELADAS
  -- (no se recalculan ni se borran) para no cascadear el borrado sobre
  -- pagos_cuenta (FK on delete cascade) ni perder el historial de pagos.
  update public.cuentas_a_pagar c
    set monto = coalesce((
      select sum(coalesce(ip.cantidad_recibida, 0) * ip.precio_costo)
      from public.items_pedido ip where ip.cuenta_a_pagar_id = c.id
    ), 0)
    where c.pedido_id = p_pedido_id and c.tiene_factura = false
      and coalesce(c.monto_pagado, 0) = 0
      and not exists (
        select 1 from public.pagos_cuenta pg where pg.cuenta_a_pagar_id = c.id
      );

  delete from public.cuentas_a_pagar c
    where c.pedido_id = p_pedido_id and c.tiene_factura = false
      and coalesce(c.monto_pagado, 0) = 0
      and not exists (
        select 1 from public.pagos_cuenta pg where pg.cuenta_a_pagar_id = c.id
      )
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

grant execute on function public.fn_recibir_pedido(integer, integer, uuid, integer, jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';
