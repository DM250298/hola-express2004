-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 122 · PEDIDO 2 — RPCs de la factura de compra directa    ║
-- ║                                                                     ║
-- ║  fn_registrar_compra_directa: crea la factura (fiscal) + opcional    ║
-- ║    stock/costo/precio + pago al instante (efectivo del turno o una   ║
-- ║    cuenta) + asiento. NO crea deuda: se paga en el acto.            ║
-- ║  fn_anular_compra_directa: repone stock, revierte el pago y el       ║
-- ║    asiento, borra la factura.                                        ║
-- ║                                                                     ║
-- ║  Gateadas por el permiso 'compras'. Correr después de la 121.       ║
-- ╚════════════════════════════════════════════════════════════════════╝

create or replace function public.fn_registrar_compra_directa(
  p_usuario_id uuid,
  p_proveedor_id integer,
  p_fecha date,
  p_fiscal jsonb,
  p_lineas jsonb,
  p_gasto jsonb,
  p_mueve_stock boolean,
  p_afecta_precio_venta boolean,
  p_pago jsonb
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_ahora timestamptz := now();
  v_fecha date := coalesce(p_fecha, current_date);
  v_tipo text := nullif(btrim(p_fiscal->>'tipo_comprobante'), '');
  v_punto text := nullif(btrim(p_fiscal->>'punto_venta'), '');
  v_numero text := nullif(btrim(p_fiscal->>'numero_comprobante'), '');
  v_cuit text := nullif(btrim(p_fiscal->>'cuit'), '');
  v_neto numeric := coalesce((p_fiscal->>'neto')::numeric, 0);
  v_iva numeric := coalesce((p_fiscal->>'iva_total')::numeric, 0);
  v_perc_iva numeric := coalesce((p_fiscal->>'perc_iva')::numeric, 0);
  v_perc_iibb numeric := coalesce((p_fiscal->>'perc_iibb')::numeric, 0);
  v_perc_otros numeric := coalesce((p_fiscal->>'perc_otros')::numeric, 0);
  v_gastos numeric := coalesce((p_fiscal->>'gastos')::numeric, 0);
  v_total numeric;
  v_factura_id integer;
  v_origen text := p_pago->>'origen';
  v_turno_id integer := nullif(p_pago->>'turno_id', '')::integer;
  v_cuenta_id integer := nullif(p_pago->>'cuenta_id', '')::integer;
  v_categoria text;
  v_egreso_id integer;
  v_tipo_cuenta text;
  v_es_boveda boolean;
  v_saldo numeric;
  v_saldo_nuevo numeric;
  v_linea jsonb;
  v_prod_id integer;
  v_cant numeric;
  v_costo_sin_iva numeric;
  v_desc numeric;
  v_iva_compra numeric;
  v_margen numeric;
  v_iva_venta numeric;
  v_costo_neto numeric;
  v_costo_con_iva numeric;
  v_precio_con_iva numeric;
  v_precio_sin_iva numeric;
  v_stock_ant numeric;
  v_stock_nuevo numeric;
  v_asiento_id integer;
  v_orden integer := 0;
  v_cta_debe integer;
  v_cta_iva_cred integer;
  v_cta_haber integer;
  v_cta_perc_iva integer;
  v_cta_perc_iibb integer;
  v_cta_perc_otros integer;
begin
  if not (select public.fn_tiene_permiso('compras')) then
    raise exception 'No tenés permiso para registrar compras.';
  end if;
  if public.fn_periodo_cerrado(v_fecha) then
    raise exception 'El período de esa compra está cerrado.';
  end if;
  if v_origen not in ('turno', 'cuenta') then
    raise exception 'Origen de pago inválido.';
  end if;
  if v_origen = 'turno' and v_turno_id is null then
    raise exception 'Falta el turno para el pago en efectivo.';
  end if;

  v_total := round(v_neto + v_gastos + v_iva + v_perc_iva + v_perc_iibb + v_perc_otros, 2);
  if v_total <= 0 then
    raise exception 'El total de la compra debe ser mayor a 0.';
  end if;

  -- Anti-duplicado fiscal (solo con comprobante completo).
  if v_cuit is not null and v_tipo is not null and v_punto is not null and v_numero is not null then
    if exists (
      select 1 from public.facturas_compra
      where cuit_proveedor = v_cuit and tipo_comprobante = v_tipo
        and punto_venta = v_punto and numero_comprobante = v_numero
    ) then
      raise exception 'Ya existe una factura con ese comprobante (% %-%).', v_tipo, v_punto, v_numero;
    end if;
  end if;

  -- Cabecera de la factura (sin cuenta a pagar ni pedido: pagada al instante).
  insert into public.facturas_compra (
    cuenta_id, pedido_id, proveedor_id, fecha, neto, iva_total, total,
    afecta_precio_venta, usuario_id, es_directa,
    tipo_comprobante, punto_venta, numero_comprobante, cuit_proveedor,
    percepcion_iva, percepcion_iibb, percepcion_otros, gastos_no_debitables
  ) values (
    null, null, p_proveedor_id, v_fecha, v_neto, v_iva, v_total,
    (p_mueve_stock and p_afecta_precio_venta), p_usuario_id, true,
    v_tipo, v_punto, v_numero, v_cuit,
    v_perc_iva, v_perc_iibb, v_perc_otros, v_gastos
  ) returning id into v_factura_id;

  if p_mueve_stock then
    -- ── Compra con mercadería: cada línea es un producto (stock/costo/precio) ──
    for v_linea in select * from jsonb_array_elements(p_lineas) loop
      v_prod_id := (v_linea->>'producto_id')::integer;
      v_cant := coalesce((v_linea->>'cantidad')::numeric, 0);
      v_costo_sin_iva := coalesce((v_linea->>'costo_sin_iva')::numeric, 0);
      v_desc := coalesce((v_linea->>'descuento_porcentaje')::numeric, 0);
      v_iva_compra := coalesce((v_linea->>'iva_compra_porcentaje')::numeric, 0);
      v_margen := coalesce((v_linea->>'margen_porcentaje')::numeric, 0);
      v_iva_venta := coalesce((v_linea->>'iva_venta_porcentaje')::numeric, 0);
      if v_prod_id is null or v_cant <= 0 then continue; end if;

      v_costo_neto := round(v_costo_sin_iva * (1 - v_desc / 100), 2);
      v_costo_con_iva := round(v_costo_neto * (1 + v_iva_compra / 100), 2);
      v_precio_con_iva := public.fn_precio_venta(v_costo_neto, v_margen, v_iva_venta);
      v_precio_sin_iva := round(v_precio_con_iva / (1 + v_iva_venta / 100), 2);

      select stock_actual into v_stock_ant from public.productos where id = v_prod_id for update;
      v_stock_ant := coalesce(v_stock_ant, 0);
      v_stock_nuevo := v_stock_ant + v_cant;
      update public.productos set stock_actual = v_stock_nuevo, updated_at = v_ahora where id = v_prod_id;
      insert into public.movimientos_stock (
        producto_id, tipo, cantidad, stock_anterior, stock_nuevo, referencia_id, usuario_id, nota
      ) values (
        v_prod_id, 'entrada', v_cant, v_stock_ant, v_stock_nuevo, v_factura_id, p_usuario_id,
        'Compra directa #' || v_factura_id
      );

      insert into public.items_factura_compra (
        factura_id, producto_id, cantidad, costo_sin_iva, descuento_porcentaje,
        iva_compra_porcentaje, costo_con_iva, margen_porcentaje, iva_venta_porcentaje,
        precio_sin_iva, precio_con_iva
      ) values (
        v_factura_id, v_prod_id, v_cant, v_costo_sin_iva, v_desc,
        v_iva_compra, v_costo_con_iva, v_margen, v_iva_venta, v_precio_sin_iva, v_precio_con_iva
      );

      perform public.fn_set_costo(v_prod_id, v_costo_neto);
      if p_afecta_precio_venta then
        update public.productos
          set precio_venta = v_precio_con_iva, margen = v_margen,
              pendiente_precio = case when v_precio_con_iva > 0 then false else pendiente_precio end,
              updated_at = v_ahora
          where id = v_prod_id;
      end if;
      insert into public.proveedor_producto (proveedor_id, producto_id, costo, es_principal, updated_at)
      values (p_proveedor_id, v_prod_id, v_costo_neto, false, v_ahora)
      on conflict (proveedor_id, producto_id) do update set costo = excluded.costo, updated_at = v_ahora;
    end loop;
    v_categoria := 'compra_mercaderia'; -- excluida del P&L (va a Mercadería/CMV)
  else
    -- ── Gasto sin stock: una línea sin producto (para el Libro IVA) ──
    insert into public.items_factura_compra (
      factura_id, producto_id, descripcion, cantidad, costo_sin_iva,
      descuento_porcentaje, iva_compra_porcentaje, costo_con_iva
    ) values (
      v_factura_id, null,
      coalesce(nullif(btrim(p_gasto->>'descripcion'), ''), 'Compra'),
      1, v_neto, 0,
      case when v_neto > 0 then round(v_iva / v_neto * 100, 2) else 0 end,
      round(v_neto + v_iva, 2)
    );
    v_categoria := coalesce(nullif(btrim(p_gasto->>'categoria'), ''), 'otros');
  end if;

  -- ── Egreso (alimenta el cierre del turno y el P&L) ──
  insert into public.egresos (descripcion, monto, categoria, fecha, usuario_id, turno_id, cuenta_id)
  values (
    'Compra a proveedor · factura #' || v_factura_id, v_total, v_categoria, v_fecha,
    p_usuario_id,
    case when v_origen = 'turno' then v_turno_id else null end,
    case when v_origen = 'cuenta' then v_cuenta_id else null end
  ) returning id into v_egreso_id;

  update public.facturas_compra set egreso_id = v_egreso_id where id = v_factura_id;

  -- ── Pago ──
  if v_origen = 'cuenta' then
    select tipo, coalesce(es_caja_fuerte, false), saldo_actual
      into v_tipo_cuenta, v_es_boveda, v_saldo
      from public.cuentas where id = v_cuenta_id for update;
    if v_saldo is null then raise exception 'La cuenta de pago no existe.'; end if;
    v_saldo_nuevo := v_saldo - v_total;
    if v_es_boveda and v_saldo_nuevo < 0 then
      raise exception 'La compra deja la caja fuerte en negativo (saldo actual %).', v_saldo;
    end if;
    -- referencia_tipo='egreso' → getSaldoCajaFuerte lo netea del circuito.
    insert into public.movimientos_cuenta (
      cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo,
      descripcion, categoria, referencia_tipo, referencia_id, usuario_id, fecha
    ) values (
      v_cuenta_id, 'egreso', v_total, v_saldo, v_saldo_nuevo,
      'Compra a proveedor · factura #' || v_factura_id, v_categoria, 'egreso', v_egreso_id,
      p_usuario_id, v_fecha
    );
    update public.cuentas set saldo_actual = v_saldo_nuevo, updated_at = v_ahora where id = v_cuenta_id;
    v_cta_haber := case v_tipo_cuenta
      when 'caja' then (select id from public.plan_cuentas where codigo = '1.1.01')
      else (select id from public.plan_cuentas where codigo = '1.1.02')
    end;
  else
    -- Pago desde el efectivo del turno: NO toca cuentas (ya baja en el cierre).
    v_cta_haber := (select id from public.plan_cuentas where codigo = '1.1.01');
  end if;

  -- ── Asiento: Debe Mercadería/Gasto + IVA crédito + percepciones / Haber cuenta ──
  if p_mueve_stock then
    v_cta_debe := (select id from public.plan_cuentas where codigo = '1.1.04'); -- Mercadería
  else
    v_cta_debe := case v_categoria
      when 'alquiler' then (select id from public.plan_cuentas where codigo = '5.2.03')
      when 'servicios' then (select id from public.plan_cuentas where codigo = '5.2.04')
      when 'sueldos' then (select id from public.plan_cuentas where codigo = '5.2.01')
      when 'mantenimiento' then (select id from public.plan_cuentas where codigo = '5.2.05')
      when 'impuestos' then (select id from public.plan_cuentas where codigo = '5.2.06')
      else (select id from public.plan_cuentas where codigo = '5.2.09')
    end;
  end if;
  select id into v_cta_iva_cred from public.plan_cuentas where codigo = '1.1.05';
  select id into v_cta_perc_iva from public.plan_cuentas where codigo = '1.1.07';
  select id into v_cta_perc_iibb from public.plan_cuentas where codigo = '1.1.08';
  select id into v_cta_perc_otros from public.plan_cuentas where codigo = '1.1.09';

  if v_cta_debe is not null and v_cta_haber is not null then
    insert into public.asientos (fecha, descripcion, tipo, origen, referencia_id, usuario_id)
    values (v_fecha, 'Compra directa · factura #' || v_factura_id, 'automatico', 'compra_directa', v_factura_id, p_usuario_id)
    returning id into v_asiento_id;

    insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
    values (v_asiento_id, v_cta_debe, round(v_neto + v_gastos, 2), 0, v_orden);
    v_orden := v_orden + 1;
    if v_iva > 0 and v_cta_iva_cred is not null then
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_iva_cred, v_iva, 0, v_orden); v_orden := v_orden + 1;
    end if;
    if v_perc_iva > 0 and v_cta_perc_iva is not null then
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_perc_iva, v_perc_iva, 0, v_orden); v_orden := v_orden + 1;
    end if;
    if v_perc_iibb > 0 and v_cta_perc_iibb is not null then
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_perc_iibb, v_perc_iibb, 0, v_orden); v_orden := v_orden + 1;
    end if;
    if v_perc_otros > 0 and v_cta_perc_otros is not null then
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_perc_otros, v_perc_otros, 0, v_orden); v_orden := v_orden + 1;
    end if;
    insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
    values (v_asiento_id, v_cta_haber, 0, v_total, v_orden);
  end if;

  perform public.fn_auditar(p_usuario_id, 'compra_directa', 'factura_compra', v_factura_id,
    jsonb_build_object('total', v_total, 'mueve_stock', p_mueve_stock, 'origen', v_origen));

  return jsonb_build_object('factura_id', v_factura_id, 'egreso_id', v_egreso_id, 'total', v_total);
end;
$$;

revoke execute on function public.fn_registrar_compra_directa(uuid, integer, date, jsonb, jsonb, jsonb, boolean, boolean, jsonb) from anon;
grant execute on function public.fn_registrar_compra_directa(uuid, integer, date, jsonb, jsonb, jsonb, boolean, boolean, jsonb) to authenticated;

-- ─── Anular una compra directa ──────────────────────────────────────────────────
create or replace function public.fn_anular_compra_directa(
  p_factura_id integer,
  p_usuario_id uuid
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_factura public.facturas_compra;
  v_item record;
  v_mov record;
  v_stock_ant numeric;
  v_stock_nuevo numeric;
  v_saldo numeric;
  v_saldo_nuevo numeric;
begin
  select * into v_factura from public.facturas_compra where id = p_factura_id;
  if v_factura.id is null then raise exception 'La factura no existe.'; end if;
  if not coalesce(v_factura.es_directa, false) then
    raise exception 'Solo se pueden anular compras directas por esta vía.';
  end if;
  if not (select public.fn_tiene_permiso('compras')) then
    raise exception 'No tenés permiso para anular compras.';
  end if;
  if public.fn_periodo_cerrado(v_factura.fecha) then
    raise exception 'El período de esa compra está cerrado; no se puede anular.';
  end if;

  -- Reponer stock (salida por lo que había entrado; no rebobina costo/precio).
  for v_item in
    select producto_id, cantidad from public.items_factura_compra
    where factura_id = p_factura_id and producto_id is not null
  loop
    select stock_actual into v_stock_ant from public.productos where id = v_item.producto_id for update;
    v_stock_nuevo := coalesce(v_stock_ant, 0) - v_item.cantidad;
    update public.productos set stock_actual = v_stock_nuevo, updated_at = now() where id = v_item.producto_id;
    insert into public.movimientos_stock (
      producto_id, tipo, cantidad, stock_anterior, stock_nuevo, referencia_id, usuario_id, nota
    ) values (
      v_item.producto_id, 'salida', v_item.cantidad, coalesce(v_stock_ant, 0), v_stock_nuevo,
      p_factura_id, p_usuario_id, 'Anulación compra directa #' || p_factura_id
    );
  end loop;

  -- Revertir el pago desde cuenta (si lo hubo) y borrar el egreso.
  if v_factura.egreso_id is not null then
    for v_mov in
      select cuenta_id, monto from public.movimientos_cuenta
      where referencia_tipo = 'egreso' and referencia_id = v_factura.egreso_id and tipo = 'egreso'
    loop
      select saldo_actual into v_saldo from public.cuentas where id = v_mov.cuenta_id for update;
      v_saldo_nuevo := coalesce(v_saldo, 0) + v_mov.monto;
      insert into public.movimientos_cuenta (
        cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo,
        descripcion, categoria, referencia_tipo, referencia_id, usuario_id, fecha
      ) values (
        v_mov.cuenta_id, 'ingreso', v_mov.monto, coalesce(v_saldo, 0), v_saldo_nuevo,
        'Anulación compra directa #' || p_factura_id, 'compra_mercaderia', 'egreso', v_factura.egreso_id,
        p_usuario_id, current_date
      );
      update public.cuentas set saldo_actual = v_saldo_nuevo, updated_at = now() where id = v_mov.cuenta_id;
    end loop;
    delete from public.egresos where id = v_factura.egreso_id;
  end if;

  delete from public.asientos where origen = 'compra_directa' and referencia_id = p_factura_id;
  delete from public.facturas_compra where id = p_factura_id;

  perform public.fn_auditar(p_usuario_id, 'anular_compra_directa', 'factura_compra', p_factura_id,
    jsonb_build_object('total', v_factura.total));
end;
$$;

revoke execute on function public.fn_anular_compra_directa(integer, uuid) from anon;
grant execute on function public.fn_anular_compra_directa(integer, uuid) to authenticated;

notify pgrst, 'reload schema';
