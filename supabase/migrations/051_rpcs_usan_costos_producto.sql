-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 051 · R1.2 Parte 3 — los RPCs usan costos_producto       ║
-- ║                                                                     ║
-- ║  Reissue de las 5 funciones que leían/escribían productos.precio_   ║
-- ║  costo para que usen la tabla gateada costos_producto, vía los      ║
-- ║  helpers fn_costo / fn_set_costo. El cambio en cada función es      ║
-- ║  mínimo (solo las líneas del costo); el resto es idéntico.          ║
-- ║                                                                     ║
-- ║  No-breaking: la columna y el trigger siguen existiendo. Se borran  ║
-- ║  en la Parte 4.                                                     ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─── Helpers ─────────────────────────────────────────────────────────
create or replace function public.fn_costo(p_producto_id integer)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(precio_costo, 0) from public.costos_producto
  where producto_id = p_producto_id
$$;

create or replace function public.fn_set_costo(p_producto_id integer, p_costo numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.costos_producto (producto_id, precio_costo, updated_at)
  values (p_producto_id, coalesce(p_costo, 0), now())
  on conflict (producto_id)
  do update set precio_costo = excluded.precio_costo, updated_at = now();
end $$;

grant execute on function public.fn_costo(integer) to authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- fn_crear_venta v5  (lee el costo para el CMV desde costos_producto)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_crear_venta(
  p_turno_id integer,
  p_usuario_id uuid,
  p_pagos jsonb,
  p_items jsonb,
  p_cliente_uuid uuid default null,
  p_cliente_id integer default null
) returns public.ventas
language plpgsql security definer set search_path = public
as $$
declare
  v_total numeric := 0;
  v_medio_principal text;
  v_venta public.ventas;
  v_hoy date := current_date;
  v_ahora timestamptz := now();
  v_pago jsonb;
  v_item jsonb;
  v_medio text;
  v_monto numeric;
  v_cuenta_id integer;
  v_comision numeric;
  v_comision_monto numeric;
  v_dias_acred integer;
  v_pago_venta_id integer;
  v_saldo numeric;
  v_saldo_nuevo numeric;
  v_nc record;
  v_nc_codigo text;
  v_prod_id integer;
  v_cantidad integer;
  v_precio numeric;
  v_stock_ant integer;
  v_stock_nuevo integer;
  v_lote record;
  v_restante integer;
  v_usar integer;
  v_costo_unit numeric;
  v_total_costo numeric := 0;
  v_pagos_no_efec numeric := 0;
  v_neto numeric;
  v_iva numeric;
  v_efectivo numeric;
  v_no_efec numeric;
  v_asiento_id integer;
  v_orden integer := 0;
  v_cta_ventas integer;
  v_cta_iva integer;
  v_cta_caja integer;
  v_cta_banco integer;
  v_cta_cmv integer;
  v_cta_merc integer;
begin
  if p_pagos is null or jsonb_array_length(p_pagos) = 0 then
    raise exception 'La venta debe tener al menos un pago.';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_total := v_total
      + (v_item->>'precio_unitario')::numeric * (v_item->>'cantidad')::integer;
  end loop;

  select p->>'medio_pago' into v_medio_principal
  from jsonb_array_elements(p_pagos) p
  order by (p->>'monto')::numeric desc limit 1;

  insert into public.ventas (turno_id, usuario_id, total, medio_pago, estado, cliente_uuid, cliente_id)
  values (p_turno_id, p_usuario_id, v_total, v_medio_principal, 'completada', p_cliente_uuid, p_cliente_id)
  returning * into v_venta;

  for v_pago in select * from jsonb_array_elements(p_pagos) loop
    insert into public.pagos_venta (venta_id, medio_pago, monto)
    values (v_venta.id, v_pago->>'medio_pago', (v_pago->>'monto')::numeric)
    returning id into v_pago_venta_id;

    v_medio := v_pago->>'medio_pago';
    v_monto := (v_pago->>'monto')::numeric;
    if v_medio <> 'efectivo' then
      v_pagos_no_efec := v_pagos_no_efec + v_monto;
    end if;

    if v_medio = 'nota_credito' then
      v_nc_codigo := v_pago->>'nc_codigo';
      if v_nc_codigo is null or btrim(v_nc_codigo) = '' then
        raise exception 'Falta el código de la nota de crédito.';
      end if;
      select * into v_nc from public.notas_credito
        where codigo = v_nc_codigo and estado = 'activa' for update;
      if not found then
        raise exception 'Nota de crédito % no válida o ya usada.', v_nc_codigo;
      end if;
      if v_nc.saldo_disponible + 0.01 < v_monto then
        raise exception 'Saldo insuficiente en la nota de crédito (disp. %).', v_nc.saldo_disponible;
      end if;
      update public.notas_credito
        set saldo_disponible = saldo_disponible - v_monto,
            estado = case when saldo_disponible - v_monto <= 0.005 then 'usada' else 'activa' end
        where id = v_nc.id;
      continue;
    end if;

    select cuenta_id, coalesce(comision_porcentaje, 0), coalesce(dias_acreditacion, 0)
      into v_cuenta_id, v_comision, v_dias_acred
      from public.medios_pago where codigo = v_medio;
    if v_cuenta_id is null then continue; end if;
    v_comision_monto := round(v_monto * v_comision) / 100;

    if v_dias_acred > 0 then
      insert into public.acreditaciones (
        venta_id, pago_venta_id, medio_pago, cuenta_id,
        monto_bruto, comision_pct, comision_monto, monto_neto,
        fecha_venta, fecha_estimada, estado, usuario_id
      ) values (
        v_venta.id, v_pago_venta_id, v_medio, v_cuenta_id,
        v_monto, v_comision, v_comision_monto, v_monto - v_comision_monto,
        v_hoy, v_hoy + v_dias_acred, 'pendiente', p_usuario_id
      );
    else
      select saldo_actual into v_saldo from public.cuentas where id = v_cuenta_id for update;
      if v_saldo is null then continue; end if;
      v_saldo_nuevo := v_saldo + v_monto;
      insert into public.movimientos_cuenta (
        cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo,
        descripcion, categoria, referencia_tipo, referencia_id, usuario_id, fecha
      ) values (
        v_cuenta_id, 'ingreso', v_monto, v_saldo, v_saldo_nuevo,
        'Venta #' || v_venta.id || ' · ' || v_medio,
        'venta', 'venta', v_venta.id, p_usuario_id, v_hoy
      );
      if v_comision_monto > 0 then
        insert into public.movimientos_cuenta (
          cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo,
          descripcion, categoria, referencia_tipo, referencia_id, usuario_id, fecha
        ) values (
          v_cuenta_id, 'egreso', v_comision_monto,
          v_saldo_nuevo, v_saldo_nuevo - v_comision_monto,
          'Comision ' || v_medio || ' (' || v_comision || '%) Venta #' || v_venta.id,
          'comisiones', 'venta', v_venta.id, p_usuario_id, v_hoy
        );
        v_saldo_nuevo := v_saldo_nuevo - v_comision_monto;
      end if;
      update public.cuentas set saldo_actual = v_saldo_nuevo, updated_at = v_ahora
        where id = v_cuenta_id;
    end if;
  end loop;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_prod_id := (v_item->>'producto_id')::integer;
    v_cantidad := (v_item->>'cantidad')::integer;
    v_precio := (v_item->>'precio_unitario')::numeric;

    -- COSTO desde costos_producto (gateado)
    select stock_actual into v_stock_ant
      from public.productos where id = v_prod_id for update;
    v_stock_ant := coalesce(v_stock_ant, 0);
    v_costo_unit := public.fn_costo(v_prod_id);
    v_stock_nuevo := v_stock_ant - v_cantidad;
    v_total_costo := v_total_costo + v_costo_unit * v_cantidad;

    insert into public.items_venta (venta_id, producto_id, cantidad, precio_unitario, subtotal)
    values (v_venta.id, v_prod_id, v_cantidad, v_precio, v_precio * v_cantidad);

    update public.productos set stock_actual = v_stock_nuevo, updated_at = v_ahora
      where id = v_prod_id;

    insert into public.movimientos_stock (
      producto_id, tipo, cantidad, stock_anterior, stock_nuevo,
      referencia_id, usuario_id, nota
    ) values (
      v_prod_id, 'venta', v_cantidad, v_stock_ant, v_stock_nuevo,
      v_venta.id, p_usuario_id, 'Venta #' || v_venta.id
    );

    v_restante := v_cantidad;
    for v_lote in
      select id, cantidad_actual from public.lotes
        where producto_id = v_prod_id and estado = 'activo'::public.estado_lote
          and cantidad_actual > 0
        order by fecha_vencimiento asc for update
    loop
      exit when v_restante <= 0;
      v_usar := least(v_lote.cantidad_actual, v_restante);
      update public.lotes
        set cantidad_actual = v_lote.cantidad_actual - v_usar,
            estado = (case when v_lote.cantidad_actual - v_usar = 0 then 'agotado' else 'activo' end)::public.estado_lote
        where id = v_lote.id;
      v_restante := v_restante - v_usar;
    end loop;
  end loop;

  select id into v_cta_ventas from public.plan_cuentas where codigo = '4.1.01';
  select id into v_cta_iva from public.plan_cuentas where codigo = '2.1.02';
  select id into v_cta_caja from public.plan_cuentas where codigo = '1.1.01';
  select id into v_cta_banco from public.plan_cuentas where codigo = '1.1.02';
  select id into v_cta_cmv from public.plan_cuentas where codigo = '5.1.01';
  select id into v_cta_merc from public.plan_cuentas where codigo = '1.1.04';

  if v_total > 0 and v_cta_ventas is not null and v_cta_iva is not null
     and v_cta_caja is not null and v_cta_banco is not null then
    v_neto := round(v_total / 1.21, 2);
    v_iva := round(v_total - v_neto, 2);
    v_no_efec := least(v_pagos_no_efec, v_total);
    v_efectivo := v_total - v_no_efec;

    insert into public.asientos (fecha, descripcion, tipo, origen, referencia_id, usuario_id)
    values (v_hoy, 'Venta #' || v_venta.id, 'automatico', 'venta', v_venta.id, p_usuario_id)
    returning id into v_asiento_id;

    if v_efectivo > 0 then
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_caja, v_efectivo, 0, v_orden);
      v_orden := v_orden + 1;
    end if;
    if v_no_efec > 0 then
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_banco, v_no_efec, 0, v_orden);
      v_orden := v_orden + 1;
    end if;
    insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
    values (v_asiento_id, v_cta_ventas, 0, v_neto, v_orden);
    v_orden := v_orden + 1;
    insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
    values (v_asiento_id, v_cta_iva, 0, v_iva, v_orden);
    v_orden := v_orden + 1;

    if v_cta_cmv is not null and v_cta_merc is not null and v_total_costo > 0 then
      v_total_costo := round(v_total_costo, 2);
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_cmv, v_total_costo, 0, v_orden);
      v_orden := v_orden + 1;
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_merc, 0, v_total_costo, v_orden);
    end if;
  end if;

  return v_venta;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- fn_crear_ajuste_stock  (costo desde costos_producto)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_crear_ajuste_stock(
  p_usuario_id uuid,
  p_razon text,
  p_razon_detalle text,
  p_items jsonb
) returns public.ajustes_stock
language plpgsql security definer set search_path = public
as $$
declare
  v_ahora timestamptz := now();
  v_ajuste public.ajustes_stock;
  v_item jsonb;
  v_prod_id integer;
  v_tipo text;
  v_cantidad integer;
  v_stock_ant integer;
  v_costo numeric;
  v_stock_final integer;
  v_diferencia integer;
  v_subtotal numeric;
  v_mov_cant integer;
  v_total numeric := 0;
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Agregá al menos un producto al ajuste.';
  end if;

  insert into public.ajustes_stock (usuario_id, razon, razon_detalle, total_costo, cantidad_items)
  values (p_usuario_id, p_razon, p_razon_detalle, 0, jsonb_array_length(p_items))
  returning * into v_ajuste;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_prod_id := (v_item->>'producto_id')::integer;
    v_tipo := v_item->>'tipo';
    v_cantidad := (v_item->>'cantidad')::integer;
    if v_cantidad is null or v_cantidad < 0 then
      raise exception 'Cantidad inválida en un producto del ajuste.';
    end if;

    select stock_actual into v_stock_ant
      from public.productos where id = v_prod_id for update;
    if v_stock_ant is null then
      raise exception 'Producto inexistente en el ajuste.';
    end if;
    v_costo := public.fn_costo(v_prod_id);

    if v_tipo = 'entrada' then v_stock_final := v_stock_ant + v_cantidad;
    elsif v_tipo = 'salida' then v_stock_final := v_stock_ant - v_cantidad;
    else v_stock_final := v_cantidad; end if;
    if v_stock_final < 0 then
      raise exception 'El ajuste dejaría el stock negativo en un producto.';
    end if;

    v_diferencia := abs(v_stock_final - v_stock_ant);
    v_subtotal := v_diferencia * v_costo;
    v_total := v_total + v_subtotal;
    v_mov_cant := case when v_tipo = 'ajuste' then v_diferencia else v_cantidad end;

    update public.productos set stock_actual = v_stock_final, updated_at = v_ahora
      where id = v_prod_id;
    insert into public.movimientos_stock (
      producto_id, tipo, cantidad, stock_anterior, stock_nuevo,
      referencia_id, usuario_id, nota
    ) values (
      v_prod_id, v_tipo::public.tipo_movimiento, v_mov_cant, v_stock_ant, v_stock_final,
      v_ajuste.id, p_usuario_id, 'Ajuste #' || v_ajuste.id || ' · ' || p_razon
    );
    insert into public.items_ajuste_stock (
      ajuste_id, producto_id, tipo, cantidad,
      stock_anterior, stock_final, costo_unitario, subtotal
    ) values (
      v_ajuste.id, v_prod_id, v_tipo, v_cantidad,
      v_stock_ant, v_stock_final, v_costo, v_subtotal
    );
  end loop;

  update public.ajustes_stock set total_costo = v_total where id = v_ajuste.id;
  v_ajuste.total_costo := v_total;
  return v_ajuste;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- fn_recibir_pedido  (variación de costo lee desde costos_producto)
-- ─────────────────────────────────────────────────────────────────────
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
  v_total numeric := 0;
  v_item jsonb;
  v_item_id integer;
  v_prod_id integer;
  v_cant integer;
  v_precio numeric;
  v_venc date;
  v_subtotal numeric;
  v_stock_ant integer;
  v_stock_nuevo integer;
  v_cuenta_id integer;
  v_costo_ant numeric;
  v_var_pct numeric;
  v_umbral numeric;
  v_variaciones jsonb := '[]'::jsonb;
  v_total_pedido integer;
  v_total_recibido_unid integer;
  v_estado text;
begin
  select coalesce(umbral_variacion_costo, 10) into v_umbral
    from public.config_compras where id = 1;
  v_umbral := coalesce(v_umbral, 10);

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_item_id := (v_item->>'item_id')::integer;
    v_prod_id := (v_item->>'producto_id')::integer;
    v_cant := (v_item->>'cantidad_recibida')::integer;
    v_precio := (v_item->>'precio_costo')::numeric;
    v_venc := nullif(v_item->>'fecha_vencimiento', '')::date;
    v_subtotal := v_cant * v_precio;

    update public.items_pedido set cantidad_recibida = v_cant, subtotal = v_subtotal
      where id = v_item_id;
    if v_cant <= 0 then continue; end if;
    v_total := v_total + v_subtotal;

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

  select coalesce(sum(cantidad_pedida), 0), coalesce(sum(coalesce(cantidad_recibida, 0)), 0)
    into v_total_pedido, v_total_recibido_unid
    from public.items_pedido where pedido_id = p_pedido_id;
  if v_total_recibido_unid >= v_total_pedido then v_estado := 'recibido';
  else v_estado := 'recepcion_parcial'; end if;

  update public.pedidos
    set estado = v_estado::public.estado_pedido, total = v_total, updated_at = v_ahora
    where id = p_pedido_id;

  select id into v_cuenta_id from public.cuentas_a_pagar
    where pedido_id = p_pedido_id and tiene_factura = false
    order by id desc limit 1;
  if v_cuenta_id is null then
    insert into public.cuentas_a_pagar (
      pedido_id, proveedor_id, monto, fecha_vencimiento, estado, provisoria, tiene_factura
    ) values (
      p_pedido_id, p_proveedor_id, v_total,
      current_date + p_condicion_pago_dias, 'pendiente', true, false
    ) returning id into v_cuenta_id;
  else
    update public.cuentas_a_pagar
      set monto = v_total, proveedor_id = p_proveedor_id,
          fecha_vencimiento = current_date + p_condicion_pago_dias
      where id = v_cuenta_id;
  end if;

  return jsonb_build_object(
    'cuenta_a_pagar_id', v_cuenta_id, 'total_recibido', v_total,
    'es_parcial', (v_estado = 'recepcion_parcial'), 'variaciones', v_variaciones
  );
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- fn_guardar_factura_compra  (lee y escribe el costo en costos_producto)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_guardar_factura_compra(
  p_cuenta_id integer,
  p_pedido_id integer,
  p_proveedor_id integer,
  p_fecha date,
  p_afecta_precio_venta boolean,
  p_usuario_id uuid,
  p_lineas jsonb
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_ahora timestamptz := now();
  v_linea jsonb;
  v_neto numeric := 0;
  v_iva_total numeric := 0;
  v_total numeric := 0;
  v_factura_id integer;
  v_prod_id integer;
  v_costo_sin_iva numeric;
  v_desc numeric;
  v_iva_compra numeric;
  v_margen numeric;
  v_iva_venta numeric;
  v_cant numeric;
  v_costo_neto numeric;
  v_costo_con_iva numeric;
  v_precio_sin_iva numeric;
  v_precio_con_iva numeric;
  v_asiento_id integer;
  v_cta_merc integer;
  v_cta_iva_cred integer;
  v_cta_prov integer;
  v_costo_ant numeric;
  v_var_pct numeric;
begin
  delete from public.facturas_compra where cuenta_id = p_cuenta_id;

  for v_linea in select * from jsonb_array_elements(p_lineas) loop
    v_costo_sin_iva := (v_linea->>'costo_sin_iva')::numeric;
    v_desc := coalesce((v_linea->>'descuento_porcentaje')::numeric, 0);
    v_iva_compra := coalesce((v_linea->>'iva_compra_porcentaje')::numeric, 0);
    v_cant := (v_linea->>'cantidad')::numeric;
    v_costo_neto := round(v_costo_sin_iva * (1 - v_desc / 100), 2);
    v_costo_con_iva := round(v_costo_neto * (1 + v_iva_compra / 100), 2);
    v_neto := v_neto + v_costo_neto * v_cant;
    v_iva_total := v_iva_total + (v_costo_con_iva - v_costo_neto) * v_cant;
  end loop;
  v_neto := round(v_neto, 2);
  v_iva_total := round(v_iva_total, 2);
  v_total := round(v_neto + v_iva_total, 2);

  insert into public.facturas_compra (
    cuenta_id, pedido_id, proveedor_id, fecha, neto, iva_total, total, afecta_precio_venta, usuario_id
  ) values (
    p_cuenta_id, p_pedido_id, p_proveedor_id, p_fecha, v_neto, v_iva_total, v_total, p_afecta_precio_venta, p_usuario_id
  ) returning id into v_factura_id;

  for v_linea in select * from jsonb_array_elements(p_lineas) loop
    v_prod_id := (v_linea->>'producto_id')::integer;
    v_costo_sin_iva := (v_linea->>'costo_sin_iva')::numeric;
    v_desc := coalesce((v_linea->>'descuento_porcentaje')::numeric, 0);
    v_iva_compra := coalesce((v_linea->>'iva_compra_porcentaje')::numeric, 0);
    v_margen := coalesce((v_linea->>'margen_porcentaje')::numeric, 0);
    v_iva_venta := coalesce((v_linea->>'iva_venta_porcentaje')::numeric, 0);
    v_cant := (v_linea->>'cantidad')::numeric;
    v_costo_neto := round(v_costo_sin_iva * (1 - v_desc / 100), 2);
    v_costo_con_iva := round(v_costo_neto * (1 + v_iva_compra / 100), 2);
    v_precio_sin_iva := round(v_costo_neto * (1 + v_margen / 100), 2);
    v_precio_con_iva := round(v_precio_sin_iva * (1 + v_iva_venta / 100), 2);

    v_costo_ant := public.fn_costo(v_prod_id);
    if v_costo_ant > 0 and v_costo_neto > 0 and v_costo_neto <> v_costo_ant then
      v_var_pct := round(((v_costo_neto - v_costo_ant) / v_costo_ant) * 100, 2);
      insert into public.historial_costos (
        producto_id, proveedor_id, costo_anterior, costo_nuevo, variacion_pct, origen, pedido_id, usuario_id
      ) values (
        v_prod_id, p_proveedor_id, v_costo_ant, v_costo_neto, v_var_pct, 'factura', p_pedido_id, p_usuario_id
      );
    end if;

    insert into public.items_factura_compra (
      factura_id, producto_id, cantidad, costo_sin_iva,
      descuento_porcentaje, iva_compra_porcentaje, costo_con_iva,
      margen_porcentaje, iva_venta_porcentaje, precio_sin_iva, precio_con_iva
    ) values (
      v_factura_id, v_prod_id, v_cant, v_costo_sin_iva,
      v_desc, v_iva_compra, v_costo_con_iva,
      v_margen, v_iva_venta, v_precio_sin_iva, v_precio_con_iva
    );

    -- Costo a costos_producto; precio de venta a productos (si corresponde)
    if p_afecta_precio_venta then
      update public.productos set precio_venta = v_precio_con_iva, updated_at = v_ahora
        where id = v_prod_id;
    end if;
    perform public.fn_set_costo(v_prod_id, v_costo_neto);

    update public.proveedor_producto set costo = v_costo_neto, updated_at = v_ahora
      where proveedor_id = p_proveedor_id and producto_id = v_prod_id;
    update public.items_pedido
      set precio_costo = v_costo_neto, subtotal = round(v_costo_neto * v_cant, 2)
      where id = (v_linea->>'item_pedido_id')::integer;
  end loop;

  update public.pedidos set total = v_total, updated_at = v_ahora where id = p_pedido_id;
  update public.cuentas_a_pagar
    set monto = v_total, provisoria = false, tiene_factura = true
    where id = p_cuenta_id;

  delete from public.asientos where origen = 'factura_compra' and referencia_id = p_cuenta_id;
  select id into v_cta_merc from public.plan_cuentas where codigo = '1.1.04';
  select id into v_cta_iva_cred from public.plan_cuentas where codigo = '1.1.05';
  select id into v_cta_prov from public.plan_cuentas where codigo = '2.1.01';

  if v_total > 0 and v_cta_merc is not null and v_cta_iva_cred is not null and v_cta_prov is not null then
    insert into public.asientos (fecha, descripcion, tipo, origen, referencia_id, usuario_id)
    values (p_fecha, 'Factura compra · Pedido #' || p_pedido_id, 'automatico', 'factura_compra', p_cuenta_id, p_usuario_id)
    returning id into v_asiento_id;
    insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
    values (v_asiento_id, v_cta_merc, v_neto, 0, 0);
    if v_iva_total > 0 then
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_iva_cred, v_iva_total, 0, 1);
    end if;
    insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
    values (v_asiento_id, v_cta_prov, 0, v_total, 2);
  end if;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- fn_crear_devolucion  (CMV reversa lee costo desde costos_producto)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_crear_devolucion(
  p_venta_id integer,
  p_usuario_id uuid,
  p_turno_id integer,
  p_motivo text,
  p_tipo_reembolso text,
  p_cliente_id integer,
  p_items jsonb
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_ahora timestamptz := now();
  v_hoy date := current_date;
  v_venta record;
  v_item jsonb;
  v_iv_id integer;
  v_prod_id integer;
  v_cant integer;
  v_precio numeric;
  v_destino text;
  v_subtotal numeric;
  v_total numeric := 0;
  v_costo_total numeric := 0;
  v_costo_unit numeric;
  v_vendida integer;
  v_ya_dev integer;
  v_stock_ant integer;
  v_stock_nuevo integer;
  v_lote_id integer;
  v_dev_id integer;
  v_nc_id integer;
  v_egreso_id integer;
  v_codigo text;
  v_rest numeric;
  v_acred record;
  v_nuevo_bruto numeric;
  v_nuevo_com numeric;
  v_neto numeric;
  v_iva numeric;
  v_asiento_id integer;
  v_cta_ventas integer;
  v_cta_iva integer;
  v_cta_caja integer;
  v_cta_banco integer;
  v_cta_cmv integer;
  v_cta_merc integer;
  v_cta_haber integer;
begin
  select * into v_venta from public.ventas where id = p_venta_id for update;
  if not found then raise exception 'La venta no existe.'; end if;
  if v_venta.estado <> 'completada' then
    raise exception 'Solo se pueden devolver items de ventas completadas.';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_iv_id := nullif(v_item->>'item_venta_id','')::integer;
    v_prod_id := (v_item->>'producto_id')::integer;
    v_cant := (v_item->>'cantidad')::integer;
    v_precio := (v_item->>'precio_unitario')::numeric;
    v_destino := coalesce(v_item->>'destino', 'stock');
    if v_cant <= 0 then continue; end if;

    if v_iv_id is not null then
      select cantidad into v_vendida from public.items_venta where id = v_iv_id;
      select coalesce(sum(cantidad),0) into v_ya_dev
        from public.items_devolucion where item_venta_id = v_iv_id;
      if v_cant > coalesce(v_vendida,0) - coalesce(v_ya_dev,0) then
        raise exception 'No se puede devolver más de lo vendido del producto %.', v_prod_id;
      end if;
    end if;

    v_subtotal := v_cant * v_precio;
    v_total := v_total + v_subtotal;

    select stock_actual into v_stock_ant
      from public.productos where id = v_prod_id for update;
    v_stock_ant := coalesce(v_stock_ant, 0);
    v_costo_unit := public.fn_costo(v_prod_id);
    v_costo_total := v_costo_total + v_costo_unit * v_cant;
    v_stock_nuevo := v_stock_ant + v_cant;
    update public.productos set stock_actual = v_stock_nuevo, updated_at = v_ahora
      where id = v_prod_id;
    insert into public.movimientos_stock (
      producto_id, tipo, cantidad, stock_anterior, stock_nuevo,
      referencia_id, usuario_id, nota
    ) values (
      v_prod_id, 'entrada', v_cant, v_stock_ant, v_stock_nuevo,
      p_venta_id, p_usuario_id, 'Devolución venta #' || p_venta_id
    );

    select id into v_lote_id from public.lotes
      where producto_id = v_prod_id and estado in ('activo','agotado')
      order by fecha_vencimiento desc, id desc limit 1;
    if v_lote_id is not null then
      update public.lotes set cantidad_actual = cantidad_actual + v_cant, estado = 'activo'
        where id = v_lote_id;
    end if;

    if v_destino = 'merma' then
      update public.productos set stock_actual = v_stock_nuevo - v_cant, updated_at = v_ahora
        where id = v_prod_id;
      insert into public.movimientos_stock (
        producto_id, tipo, cantidad, stock_anterior, stock_nuevo,
        referencia_id, usuario_id, nota
      ) values (
        v_prod_id, 'merma', v_cant, v_stock_nuevo, v_stock_nuevo - v_cant,
        p_venta_id, p_usuario_id, 'Merma por devolución dañada venta #' || p_venta_id
      );
      if v_lote_id is not null then
        update public.lotes set cantidad_actual = greatest(cantidad_actual - v_cant, 0)
          where id = v_lote_id;
      end if;
    end if;
  end loop;

  if v_total <= 0 then raise exception 'La devolución no tiene items válidos.'; end if;

  insert into public.devoluciones (
    venta_id, turno_id, usuario_id, motivo, tipo_reembolso, total_devuelto, cliente_id
  ) values (
    p_venta_id, p_turno_id, p_usuario_id, p_motivo, p_tipo_reembolso, v_total, p_cliente_id
  ) returning id into v_dev_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    if (v_item->>'cantidad')::integer <= 0 then continue; end if;
    insert into public.items_devolucion (
      devolucion_id, item_venta_id, producto_id, cantidad, precio_unitario, subtotal, destino
    ) values (
      v_dev_id, nullif(v_item->>'item_venta_id','')::integer,
      (v_item->>'producto_id')::integer, (v_item->>'cantidad')::integer,
      (v_item->>'precio_unitario')::numeric,
      (v_item->>'cantidad')::integer * (v_item->>'precio_unitario')::numeric,
      coalesce(v_item->>'destino','stock')
    );
  end loop;

  if p_tipo_reembolso = 'efectivo' then
    insert into public.egresos (descripcion, monto, categoria, fecha, usuario_id, turno_id)
    values ('Devolución venta #' || p_venta_id, v_total, 'devolucion', v_hoy, p_usuario_id, p_turno_id)
    returning id into v_egreso_id;
    update public.devoluciones set egreso_id = v_egreso_id where id = v_dev_id;
  elsif p_tipo_reembolso = 'nota_credito' then
    v_codigo := 'NC-' || to_char(v_ahora, 'YYMMDD') || '-' || lpad((floor(random()*10000))::int::text, 4, '0');
    insert into public.notas_credito (codigo, cliente_id, devolucion_id, monto_original, saldo_disponible, estado)
    values (v_codigo, p_cliente_id, v_dev_id, v_total, v_total, 'activa') returning id into v_nc_id;
    update public.devoluciones set nota_credito_id = v_nc_id where id = v_dev_id;
  elsif p_tipo_reembolso = 'tarjeta' then
    v_rest := v_total;
    for v_acred in
      select * from public.acreditaciones
      where venta_id = p_venta_id and estado = 'pendiente' order by id for update
    loop
      exit when v_rest <= 0;
      if v_rest >= v_acred.monto_bruto then
        update public.acreditaciones set estado = 'cancelada', updated_at = v_ahora where id = v_acred.id;
        v_rest := v_rest - v_acred.monto_bruto;
      else
        v_nuevo_bruto := v_acred.monto_bruto - v_rest;
        v_nuevo_com := round(v_nuevo_bruto * v_acred.comision_pct) / 100;
        update public.acreditaciones
          set monto_bruto = v_nuevo_bruto, comision_monto = v_nuevo_com,
              monto_neto = v_nuevo_bruto - v_nuevo_com, updated_at = v_ahora
          where id = v_acred.id;
        v_rest := 0;
      end if;
    end loop;
  end if;

  if p_tipo_reembolso in ('efectivo','tarjeta') then
    select id into v_cta_ventas from public.plan_cuentas where codigo = '4.1.01';
    select id into v_cta_iva from public.plan_cuentas where codigo = '2.1.02';
    select id into v_cta_caja from public.plan_cuentas where codigo = '1.1.01';
    select id into v_cta_banco from public.plan_cuentas where codigo = '1.1.02';
    select id into v_cta_cmv from public.plan_cuentas where codigo = '5.1.01';
    select id into v_cta_merc from public.plan_cuentas where codigo = '1.1.04';
    v_cta_haber := case when p_tipo_reembolso = 'efectivo' then v_cta_caja else v_cta_banco end;
    if v_cta_ventas is not null and v_cta_iva is not null and v_cta_haber is not null then
      v_neto := round(v_total / 1.21, 2);
      v_iva := round(v_total - v_neto, 2);
      insert into public.asientos (fecha, descripcion, tipo, origen, referencia_id, usuario_id)
      values (v_hoy, 'Devolución venta #' || p_venta_id, 'automatico', 'devolucion', v_dev_id, p_usuario_id)
      returning id into v_asiento_id;
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_ventas, v_neto, 0, 0);
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_iva, v_iva, 0, 1);
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_haber, 0, v_total, 2);
      if v_cta_cmv is not null and v_cta_merc is not null and v_costo_total > 0 then
        v_costo_total := round(v_costo_total, 2);
        insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
        values (v_asiento_id, v_cta_merc, v_costo_total, 0, 3);
        insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
        values (v_asiento_id, v_cta_cmv, 0, v_costo_total, 4);
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'devolucion_id', v_dev_id, 'total_devuelto', v_total,
    'nota_credito_id', v_nc_id, 'codigo_nc', v_codigo
  );
end;
$$;

notify pgrst, 'reload schema';
