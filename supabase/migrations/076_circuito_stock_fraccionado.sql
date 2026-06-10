-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 076 · Fase 2 de la 062: circuito de stock fraccionado    ║
-- ║                                                                     ║
-- ║  La 062 pasó el circuito de VENTA a numeric pero dejó pendiente el  ║
-- ║  de COMPRA/CONTEO/DEVOLUCIÓN: recibir, contar o devolver un producto║
-- ║  por peso con fracción daba "invalid input syntax for type integer" ║
-- ║  (rollback seguro). Esta migración completa esa fase para habilitar ║
-- ║  insumos fraccionados (ej. recibir 10.5 kg de carne por OC).        ║
-- ║                                                                     ║
-- ║  1) Columnas de cantidad → numeric(12,3):                           ║
-- ║       items_pedido.cantidad_pedida / cantidad_recibida             ║
-- ║       conteos_items.cantidad_contada                                ║
-- ║       items_devolucion.cantidad                                     ║
-- ║  2) Reissue de fn_recibir_pedido (061), fn_crear_devolucion (071) y ║
-- ║     fn_aprobar_conteo (018) migrando TODAS las variables internas   ║
-- ║     de cantidad/stock a numeric (no solo el cast de entrada).       ║
-- ║                                                                     ║
-- ║  Firmas IDÉNTICAS → CREATE OR REPLACE reemplaza limpio, no cambia   ║
-- ║  types/database.ts. fn_crear_ajuste_stock NO se toca (la vigente es ║
-- ║  la 062, ya numeric). Ninguna vista referencia estas columnas.      ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────────────────────
-- 1. Columnas de cantidad → numeric(12,3)
--    Los CHECK existentes (> 0, >= 0) siguen válidos sobre numeric.
-- ─────────────────────────────────────────────────────────────────────
alter table public.items_pedido     alter column cantidad_pedida   type numeric(12,3);
alter table public.items_pedido     alter column cantidad_recibida type numeric(12,3);
alter table public.conteos_items    alter column cantidad_contada  type numeric(12,3);
alter table public.items_devolucion alter column cantidad          type numeric(12,3);

-- ─────────────────────────────────────────────────────────────────────
-- 2a. fn_recibir_pedido (base 061, recepción acumulativa) con cantidad
--     y stock numeric. Idéntica salvo los tipos de v_cant, v_stock_ant,
--     v_stock_nuevo, v_total_pedido, v_total_recibido_unid y el cast.
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

  -- Cuenta a pagar provisoria: reusa la que no tiene factura (recepciones
  -- previas del mismo pedido) y la deja con el monto acumulado real.
  select id into v_cuenta_id from public.cuentas_a_pagar
    where pedido_id = p_pedido_id and tiene_factura = false
    order by id desc limit 1;
  if v_cuenta_id is null then
    insert into public.cuentas_a_pagar (
      pedido_id, proveedor_id, monto, fecha_vencimiento, estado, provisoria, tiene_factura
    ) values (
      p_pedido_id, p_proveedor_id, v_total_acumulado,
      current_date + p_condicion_pago_dias, 'pendiente', true, false
    ) returning id into v_cuenta_id;
  else
    update public.cuentas_a_pagar
      set monto = v_total_acumulado, proveedor_id = p_proveedor_id,
          fecha_vencimiento = current_date + p_condicion_pago_dias
      where id = v_cuenta_id;
  end if;

  return jsonb_build_object(
    'cuenta_a_pagar_id', v_cuenta_id, 'total_recibido', v_total_acumulado,
    'es_parcial', (v_estado = 'recepcion_parcial'), 'variaciones', v_variaciones
  );
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 2b. fn_crear_devolucion (base 071, gate controlar_stock) con cantidad
--     y stock numeric. v_cant, v_vendida, v_ya_dev, v_stock_ant,
--     v_stock_nuevo → numeric; casts de 'cantidad' → ::numeric.
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
  v_cant numeric;
  v_precio numeric;
  v_destino text;
  v_subtotal numeric;
  v_total numeric := 0;
  v_costo_total numeric := 0;
  v_costo_unit numeric;
  v_vendida numeric;
  v_ya_dev numeric;
  v_stock_ant numeric;
  v_stock_nuevo numeric;
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
  v_controlar boolean;
begin
  select * into v_venta from public.ventas where id = p_venta_id for update;
  if not found then raise exception 'La venta no existe.'; end if;
  if v_venta.estado <> 'completada' then
    raise exception 'Solo se pueden devolver items de ventas completadas.';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_iv_id := nullif(v_item->>'item_venta_id','')::integer;
    v_prod_id := (v_item->>'producto_id')::integer;
    v_cant := (v_item->>'cantidad')::numeric;
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

    -- El reembolso (v_total) se acumula SIEMPRE: la venta cobró.
    v_subtotal := v_cant * v_precio;
    v_total := v_total + v_subtotal;

    -- El inventario y el CMV de reversa SOLO si el producto controla stock.
    select stock_actual, coalesce(controlar_stock, true)
      into v_stock_ant, v_controlar from public.productos where id = v_prod_id for update;
    v_stock_ant := coalesce(v_stock_ant, 0);
    if v_controlar then
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
    end if;
  end loop;

  if v_total <= 0 then raise exception 'La devolución no tiene items válidos.'; end if;

  insert into public.devoluciones (
    venta_id, turno_id, usuario_id, motivo, tipo_reembolso, total_devuelto, cliente_id
  ) values (
    p_venta_id, p_turno_id, p_usuario_id, p_motivo, p_tipo_reembolso, v_total, p_cliente_id
  ) returning id into v_dev_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    if (v_item->>'cantidad')::numeric <= 0 then continue; end if;
    insert into public.items_devolucion (
      devolucion_id, item_venta_id, producto_id, cantidad, precio_unitario, subtotal, destino
    ) values (
      v_dev_id, nullif(v_item->>'item_venta_id','')::integer,
      (v_item->>'producto_id')::integer, (v_item->>'cantidad')::numeric,
      (v_item->>'precio_unitario')::numeric,
      (v_item->>'cantidad')::numeric * (v_item->>'precio_unitario')::numeric,
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

-- ─────────────────────────────────────────────────────────────────────
-- 2c. fn_aprobar_conteo (base 018) con stock numeric. Solo cambia el
--     tipo de v_stock_ant; cantidad_contada ahora es numeric en tabla.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_aprobar_conteo(
  p_conteo_id integer,
  p_aprobador_id uuid
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_estado text;
  v_ahora timestamptz := now();
  v_item record;
  v_stock_ant numeric;
begin
  select estado into v_estado
    from public.conteos where id = p_conteo_id for update;
  if v_estado is null then
    raise exception 'El conteo no existe.';
  end if;
  if v_estado <> 'contado' then
    raise exception 'Solo se puede aprobar un conteo que ya fue contado.';
  end if;

  for v_item in
    select producto_id, cantidad_contada
      from public.conteos_items
      where conteo_id = p_conteo_id and cantidad_contada is not null
  loop
    select stock_actual into v_stock_ant
      from public.productos where id = v_item.producto_id for update;
    if v_stock_ant is null then
      continue;
    end if;
    if v_item.cantidad_contada = v_stock_ant then
      continue;
    end if;
    update public.productos
      set stock_actual = v_item.cantidad_contada, updated_at = v_ahora
      where id = v_item.producto_id;
    insert into public.movimientos_stock (
      producto_id, tipo, cantidad, stock_anterior, stock_nuevo,
      referencia_id, usuario_id, nota
    ) values (
      v_item.producto_id, 'ajuste',
      abs(v_item.cantidad_contada - v_stock_ant),
      v_stock_ant, v_item.cantidad_contada,
      p_conteo_id, p_aprobador_id, 'Conteo #' || p_conteo_id || ' aprobado'
    );
  end loop;

  update public.conteos
    set estado = 'aprobado',
        usuario_aprobador = p_aprobador_id,
        fecha_aprobacion = v_ahora
    where id = p_conteo_id;
end;
$$;

notify pgrst, 'reload schema';
