-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  Test · mig 325 · unidades SIN CARGO en la factura con orden           ║
-- ║                                                                        ║
-- ║  Correr en el SQL Editor DESPUÉS de la 325. Todo dentro de una         ║
-- ║  transacción que se deshace: no deja datos. Si algo falla, aborta con  ║
-- ║  el mensaje del assert.                                                ║
-- ║                                                                        ║
-- ║  Como `postgres` fn_tiene_permiso devuelve false (auth.uid() es        ║
-- ║  null): se setean los claims de un usuario admin real. Necesita el     ║
-- ║  plan de cuentas cargado (1.1.04, 1.1.05, 2.1.01) y config_fiscal.     ║
-- ║                                                                        ║
-- ║  El caso del dueño: 6 Benedictino a $1.463,49 + 1 sin cargo.           ║
-- ║   A) la recepción contó las 7 → facturar 6 + 1 no mueve stock          ║
-- ║   B) la recepción contó 6     → facturar 6 + 1 mete la gratis (+1)     ║
-- ║   C) extra regalado (0 pagadas + 3) → +3 y el costo no se toca         ║
-- ║   re-guardar 1 → 2 sin cargo = +1; quitar el extra = −3; anular        ║
-- ║   vuelve todo a lo recibido; un sin cargo negativo se rechaza.         ║
-- ╚══════════════════════════════════════════════════════════════════════╝

begin;

do $$
declare
  v_uid uuid;
  v_prov integer;
  v_a integer; v_b integer; v_c integer;
  v_item_a integer; v_item_b integer;
  v_pedido integer;
  v_cuenta integer;
  v_factura integer;
  p record;
  ip record;
  f record;
  it record;
  v_lote numeric;
  v_n integer;
  v_linea_a jsonb;
  v_linea_b jsonb;
  v_linea_c jsonb;
begin
  select u.id into v_uid from public.usuarios u where u.rol = 'admin' limit 1;
  if v_uid is null then raise exception 'No hay usuario admin para el test.'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid)::text, true);

  insert into public.proveedores (nombre) values ('TEST 325') returning id into v_prov;

  -- A: pedidas 6, recibidas 7 (la gratis se contó en el depósito), lote de 7,
  --    costo previo 1400 (distinto del de la factura para ver qué queda).
  insert into public.productos (nombre, precio_venta, margen, iva_venta, iva_compra, stock_actual)
    values ('T325 A benedictino', 2500, 30, 21, 21, 7) returning id into v_a;
  perform public.fn_set_costo(v_a, 1400);
  -- B: pedidas 6, recibidas 6 (la gratis NO se contó), lote de 6.
  insert into public.productos (nombre, precio_venta, margen, iva_venta, iva_compra, stock_actual)
    values ('T325 B coca', 4300, 30, 21, 21, 6) returning id into v_b;
  perform public.fn_set_costo(v_b, 2517.22);
  -- C: no estaba en la orden; el proveedor regaló 3. Costo conservado 400.
  insert into public.productos (nombre, precio_venta, margen, iva_venta, iva_compra, stock_actual)
    values ('T325 C extra', 900, 30, 21, 21, 2) returning id into v_c;
  perform public.fn_set_costo(v_c, 400);

  insert into public.pedidos (proveedor_id, usuario_id, estado, total)
    values (v_prov, v_uid, 'recibido', 0) returning id into v_pedido;
  insert into public.cuentas_a_pagar (pedido_id, proveedor_id, monto, fecha_vencimiento, provisoria, tiene_factura)
    values (v_pedido, v_prov, 1000, current_date + 7, true, false) returning id into v_cuenta;
  insert into public.items_pedido (pedido_id, producto_id, cantidad_pedida, cantidad_recibida, precio_costo, subtotal, cuenta_a_pagar_id)
    values (v_pedido, v_a, 6, 7, 1463.49, 10244.43, v_cuenta) returning id into v_item_a;
  insert into public.items_pedido (pedido_id, producto_id, cantidad_pedida, cantidad_recibida, precio_costo, subtotal, cuenta_a_pagar_id)
    values (v_pedido, v_b, 6, 6, 2517.22, 15103.32, v_cuenta) returning id into v_item_b;
  insert into public.lotes (producto_id, fecha_vencimiento, cantidad_inicial, cantidad_actual, estado, pedido_origen_id)
    values (v_a, current_date + 180, 7, 7, 'activo', v_pedido);
  insert into public.lotes (producto_id, fecha_vencimiento, cantidad_inicial, cantidad_actual, estado, pedido_origen_id)
    values (v_b, current_date + 180, 6, 6, 'activo', v_pedido);

  -- Columnas nuevas: arrancan en 0.
  select * into ip from public.items_pedido where id = v_item_a;
  assert ip.cantidad_sin_cargo = 0, '0) items_pedido.cantidad_sin_cargo arranca en 0';

  v_linea_a := jsonb_build_object('item_pedido_id', v_item_a, 'producto_id', v_a, 'cantidad', 6,
    'cantidad_sin_cargo', 1,
    'costo_sin_iva', 1463.49, 'descuento_porcentaje', 0, 'iva_compra_porcentaje', 21,
    'margen_porcentaje', 21, 'iva_venta_porcentaje', 21, 'precio_venta', 2500, 'aplicar_iva', true);
  v_linea_b := jsonb_build_object('item_pedido_id', v_item_b, 'producto_id', v_b, 'cantidad', 6,
    'cantidad_sin_cargo', 1,
    'costo_sin_iva', 2517.22, 'descuento_porcentaje', 0, 'iva_compra_porcentaje', 21,
    'margen_porcentaje', 21, 'iva_venta_porcentaje', 21, 'precio_venta', 4300, 'aplicar_iva', true);
  v_linea_c := jsonb_build_object('item_pedido_id', null, 'producto_id', v_c, 'cantidad', 0,
    'cantidad_sin_cargo', 3,
    'costo_sin_iva', 500, 'descuento_porcentaje', 0, 'iva_compra_porcentaje', 21,
    'margen_porcentaje', 30, 'iva_venta_porcentaje', 21, 'precio_venta', 900, 'aplicar_iva', true);

  -- ── 1) A sola: 6 pagadas + 1 sin cargo con 7 recibidas → delta 0 ──────
  perform public.fn_guardar_factura_compra(
    v_cuenta, v_pedido, v_prov, current_date, true, v_uid, jsonb_build_array(v_linea_a));

  select * into p from public.productos where id = v_a;
  assert p.stock_actual = 7, '1) A: stock sigue en 7, dio ' || p.stock_actual;
  select count(*) into v_n from public.movimientos_stock
    where producto_id = v_a and nota like 'Factura compra%';
  assert v_n = 0, '1) A: sin movimiento de stock, hubo ' || v_n;
  select cantidad_actual into v_lote from public.lotes
    where producto_id = v_a and pedido_origen_id = v_pedido;
  assert v_lote = 7, '1) A: lote sigue en 7, dio ' || v_lote;
  -- El costo es el unitario PAGADO, no el promedio con la gratis (1254,42).
  assert public.fn_costo(v_a) = 1463.49, '1) A: costo = unitario pagado, dio ' || public.fn_costo(v_a);
  assert p.precio_venta = 2500, '1) A: precio tipeado se respeta, dio ' || p.precio_venta;
  select * into ip from public.items_pedido where id = v_item_a;
  assert ip.cantidad_facturada = 6, '1) A: cantidad_facturada 6, dio ' || ip.cantidad_facturada;
  assert ip.cantidad_sin_cargo = 1, '1) A: cantidad_sin_cargo 1, dio ' || ip.cantidad_sin_cargo;
  assert ip.subtotal = 8780.94, '1) A: subtotal sobre lo pagado 8780,94, dio ' || ip.subtotal;
  assert ip.precio_costo = 1463.49, '1) A: precio_costo landed 1463,49, dio ' || ip.precio_costo;
  select * into f from public.facturas_compra where cuenta_id = v_cuenta;
  v_factura := f.id;
  assert f.neto = 8780.94, '1) neto solo pagadas 8780,94, dio ' || f.neto;
  assert f.iva_total = 1843.98, '1) IVA solo pagadas 1843,98, dio ' || f.iva_total;
  select * into it from public.items_factura_compra where factura_id = v_factura and producto_id = v_a;
  assert it.cantidad = 6 and it.cantidad_sin_cargo = 1 and it.cantidad_stock_aplicada = 0,
    '1) renglón A: cantidad 6 / sin cargo 1 / stock_aplicada 0';
  -- Asiento: Mercadería = neto (la gratis no se contabiliza).
  select coalesce(sum(ai.debe), 0) into v_lote
    from public.asientos a join public.asientos_items ai on ai.asiento_id = a.id
    join public.plan_cuentas pc on pc.id = ai.cuenta_id
   where a.origen = 'factura_compra' and a.referencia_id = v_cuenta and pc.codigo = '1.1.04';
  assert v_lote = 8780.94, '1) asiento Mercadería 8780,94, dio ' || v_lote;

  -- Validar: 6 + 1 = 7 recibidas → nada difiere.
  perform public.fn_validar_factura_compra(v_factura, true);
  select * into f from public.facturas_compra where id = v_factura;
  assert f.validada, '1) validada';
  assert f.renglones_diferentes = 0, '1) renglones_diferentes 0, dio ' || f.renglones_diferentes;
  assert f.diferencia_recepcion = 0, '1) diferencia_recepcion 0, dio ' || f.diferencia_recepcion;

  -- ── 2) Re-guardar con B (gratis no contada) y C (extra regalado) ──────
  perform public.fn_guardar_factura_compra(
    v_cuenta, v_pedido, v_prov, current_date, true, v_uid,
    jsonb_build_array(v_linea_a, v_linea_b, v_linea_c));

  -- A: delta 0 otra vez (reflejado = 6 + 1).
  select * into p from public.productos where id = v_a;
  assert p.stock_actual = 7, '2) A: stock sigue en 7, dio ' || p.stock_actual;
  select count(*) into v_n from public.movimientos_stock
    where producto_id = v_a and nota like 'Factura compra%';
  assert v_n = 0, '2) A: sigue sin movimientos, hubo ' || v_n;
  -- B: la gratis entra al facturar (+1), con nota y al lote.
  select * into p from public.productos where id = v_b;
  assert p.stock_actual = 7, '2) B: stock 6 → 7, dio ' || p.stock_actual;
  select count(*) into v_n from public.movimientos_stock
    where producto_id = v_b and tipo = 'entrada' and cantidad = 1 and nota like '%(1 sin cargo)%';
  assert v_n = 1, '2) B: un movimiento de entrada 1 con "(1 sin cargo)", hubo ' || v_n;
  select cantidad_actual into v_lote from public.lotes
    where producto_id = v_b and pedido_origen_id = v_pedido;
  assert v_lote = 7, '2) B: lote 6 → 7, dio ' || v_lote;
  assert public.fn_costo(v_b) = 2517.22, '2) B: costo unitario pagado, dio ' || public.fn_costo(v_b);
  select * into ip from public.items_pedido where id = v_item_b;
  assert ip.cantidad_facturada = 6 and ip.cantidad_sin_cargo = 1, '2) B: facturada 6 / sin cargo 1';
  -- C: extra 100 % sin cargo: +3 al stock, marcador 3, costo intacto.
  select * into p from public.productos where id = v_c;
  assert p.stock_actual = 5, '2) C: stock 2 → 5, dio ' || p.stock_actual;
  assert public.fn_costo(v_c) = 400, '2) C: costo conservado 400 (0 pagadas no fija costo), dio ' || public.fn_costo(v_c);
  select * into f from public.facturas_compra where cuenta_id = v_cuenta;
  v_factura := f.id;
  select * into it from public.items_factura_compra where factura_id = v_factura and producto_id = v_c;
  assert it.cantidad = 0 and it.cantidad_sin_cargo = 3 and it.cantidad_stock_aplicada = 3,
    '2) renglón C: cantidad 0 / sin cargo 3 / stock_aplicada 3';
  assert f.neto = 23884.26, '2) neto = 8780,94 + 15103,32 (C no suma), dio ' || f.neto;
  assert f.iva_total = 5015.70, '2) IVA 1843,98 + 3171,72, dio ' || f.iva_total;

  -- Validar: B difiere (7 esperadas vs 6 recibidas, valuada al costo del
  -- renglón) y el extra C cuenta como renglón distinto con neto 0.
  perform public.fn_validar_factura_compra(v_factura, true);
  select * into f from public.facturas_compra where id = v_factura;
  assert f.renglones_diferentes = 2, '2) renglones_diferentes 2 (B y C), dio ' || f.renglones_diferentes;
  assert f.diferencia_recepcion = 2517.22, '2) diferencia_recepcion 2517,22 (1 × costo de B), dio ' || f.diferencia_recepcion;

  -- ── 3) A pasa de 1 a 2 sin cargo → +1; se quita el extra C → −3 ────────
  v_linea_a := v_linea_a || jsonb_build_object('cantidad_sin_cargo', 2);
  perform public.fn_guardar_factura_compra(
    v_cuenta, v_pedido, v_prov, current_date, true, v_uid,
    jsonb_build_array(v_linea_a, v_linea_b));

  select * into p from public.productos where id = v_a;
  assert p.stock_actual = 8, '3) A: stock 7 → 8, dio ' || p.stock_actual;
  select cantidad_actual into v_lote from public.lotes
    where producto_id = v_a and pedido_origen_id = v_pedido;
  assert v_lote = 8, '3) A: lote 7 → 8, dio ' || v_lote;
  select * into ip from public.items_pedido where id = v_item_a;
  assert ip.cantidad_facturada = 6 and ip.cantidad_sin_cargo = 2, '3) A: facturada 6 / sin cargo 2';
  select * into p from public.productos where id = v_b;
  assert p.stock_actual = 7, '3) B: sin cambios, dio ' || p.stock_actual;
  select * into p from public.productos where id = v_c;
  assert p.stock_actual = 2, '3) C: barrido del extra 5 → 2, dio ' || p.stock_actual;
  select count(*) into v_n from public.movimientos_stock
    where producto_id = v_c and tipo = 'salida' and cantidad = 3;
  assert v_n = 1, '3) C: una salida de 3, hubo ' || v_n;

  -- ── 4) Sin cargo negativo → se rechaza y no deja nada a medias ────────
  begin
    perform public.fn_guardar_factura_compra(
      v_cuenta, v_pedido, v_prov, current_date, true, v_uid,
      jsonb_build_array(v_linea_a || jsonb_build_object('cantidad_sin_cargo', -1), v_linea_b));
    raise exception 'FALLO: aceptó un sin cargo negativo';
  exception when others then
    if sqlerrm like 'FALLO:%' then raise; end if;
    if sqlerrm not like '%sin cargo no pueden ser negativas%' then
      raise exception '4) error inesperado: %', sqlerrm;
    end if;
  end;
  select * into p from public.productos where id = v_a;
  assert p.stock_actual = 8, '4) A: el rechazo no tocó el stock, dio ' || p.stock_actual;

  -- ── 5) Anular: todo vuelve a lo recibido ───────────────────────────────
  perform public.fn_anular_factura_compra(v_cuenta, v_uid);

  select * into p from public.productos where id = v_a;
  assert p.stock_actual = 7, '5) A: vuelve a las 7 recibidas, dio ' || p.stock_actual;
  select cantidad_actual into v_lote from public.lotes
    where producto_id = v_a and pedido_origen_id = v_pedido;
  assert v_lote = 7, '5) A: lote vuelve a 7, dio ' || v_lote;
  select * into p from public.productos where id = v_b;
  assert p.stock_actual = 6, '5) B: vuelve a las 6 recibidas, dio ' || p.stock_actual;
  select cantidad_actual into v_lote from public.lotes
    where producto_id = v_b and pedido_origen_id = v_pedido;
  assert v_lote = 6, '5) B: lote vuelve a 6, dio ' || v_lote;
  select * into ip from public.items_pedido where id = v_item_a;
  assert ip.cantidad_facturada is null and ip.cantidad_sin_cargo = 0,
    '5) A: cantidad_facturada null y sin cargo 0';
  select * into ip from public.items_pedido where id = v_item_b;
  assert ip.cantidad_facturada is null and ip.cantidad_sin_cargo = 0,
    '5) B: cantidad_facturada null y sin cargo 0';
  assert not exists (select 1 from public.facturas_compra where cuenta_id = v_cuenta),
    '5) la factura se borró';

  raise notice 'OK · mig 325: unidades sin cargo (stock, costo, lotes, validación, anulación)';
end $$;

-- T1: sin funciones fn_% duplicadas (tiene que dar 0 filas).
do $$
declare v_n integer;
begin
  select count(*) into v_n from (
    select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and proname like 'fn_%'
     group by proname having count(*) > 1
  ) d;
  assert v_n = 0, 'T1: hay funciones fn_% duplicadas';
end $$;

rollback;
