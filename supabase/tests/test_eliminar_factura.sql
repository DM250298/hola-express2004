-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  Test · migs 337–343 · Eliminar factura y "el proveedor la debe"       ║
-- ║                                                                        ║
-- ║  Correr en el SQL Editor DESPUÉS de la 343. Todo dentro de una         ║
-- ║  transacción que se deshace: no deja datos. Si algo falla, aborta con  ║
-- ║  el mensaje del assert.                                                ║
-- ║                                                                        ║
-- ║  Como `postgres` fn_tiene_permiso devuelve false (auth.uid() es        ║
-- ║  null): se setean los claims de un usuario admin real. Necesita el     ║
-- ║  plan de cuentas cargado (1.1.01/02/04/05, 2.1.01) y config_fiscal.    ║
-- ║                                                                        ║
-- ║   1) Orden recibida + factura editada + pago + cuota + agendado, con   ║
-- ║      mercadería ya vendida → eliminar deja todo como antes de recibir  ║
-- ║      (saldo, stock en negativo, costo, precio, orden "Por recibir").   ║
-- ║   2) Otra compra posterior del mismo producto → el costo no se toca.   ║
-- ║   3) Mes cerrado → no se puede eliminar.                               ║
-- ║   4) Compra directa pagada desde una cuenta.                           ║
-- ║   5) Marca "el proveedor debe la factura".                             ║
-- ╚══════════════════════════════════════════════════════════════════════╝

begin;

do $$
declare
  v_uid uuid;
  v_prov integer;
  v_banco integer;
  v_a integer; v_b integer; v_c integer; v_d integer;
  v_item_a integer; v_item_b integer; v_item_c integer;
  v_pedido integer; v_pedido2 integer; v_pedido3 integer;
  v_cuenta integer; v_cuenta2 integer; v_cuenta3 integer; v_cuenta5 integer;
  v_factura integer;
  v_egreso integer;
  v_res jsonb;
  p record;
  ip record;
  v_n integer;
  v_num numeric;
  v_txt text;
  v_fallo boolean;
begin
  select u.id into v_uid from public.usuarios u where u.rol = 'admin' limit 1;
  if v_uid is null then raise exception 'No hay usuario admin para el test.'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid)::text, true);

  insert into public.proveedores (nombre) values ('TEST 342') returning id into v_prov;
  insert into public.cuentas (nombre, tipo, saldo_actual) values ('T342 banco', 'banco', 100000)
    returning id into v_banco;

  -- A: costo 100, precio 200, margen 30. Recibidas 10 con lote.
  insert into public.productos (nombre, precio_venta, margen, iva_venta, iva_compra, stock_actual)
    values ('T342 A', 200, 30, 21, 21, 10) returning id into v_a;
  perform public.fn_set_costo(v_a, 100);
  insert into public.proveedor_producto (proveedor_id, producto_id, costo) values (v_prov, v_a, 100);
  -- B: costo 50, precio 100. Recibidas 5 con lote. La factura no le cambia nada.
  insert into public.productos (nombre, precio_venta, margen, iva_venta, iva_compra, stock_actual)
    values ('T342 B', 100, 30, 21, 21, 5) returning id into v_b;
  perform public.fn_set_costo(v_b, 50);

  insert into public.pedidos (proveedor_id, usuario_id, estado, total)
    values (v_prov, v_uid, 'recibido', 0) returning id into v_pedido;
  insert into public.cuentas_a_pagar (pedido_id, proveedor_id, monto, fecha_vencimiento, provisoria, tiene_factura)
    values (v_pedido, v_prov, 1250, current_date + 7, true, false) returning id into v_cuenta;
  insert into public.items_pedido (pedido_id, producto_id, cantidad_pedida, cantidad_recibida, precio_costo, subtotal, cuenta_a_pagar_id)
    values (v_pedido, v_a, 10, 10, 100, 1000, v_cuenta) returning id into v_item_a;
  insert into public.items_pedido (pedido_id, producto_id, cantidad_pedida, cantidad_recibida, precio_costo, subtotal, cuenta_a_pagar_id)
    values (v_pedido, v_b, 5, 5, 50, 250, v_cuenta) returning id into v_item_b;
  insert into public.lotes (producto_id, fecha_vencimiento, cantidad_inicial, cantidad_actual, estado, pedido_origen_id)
    values (v_a, current_date + 90, 10, 10, 'activo', v_pedido),
           (v_b, current_date + 90, 5, 5, 'activo', v_pedido);

  -- ── 1) Factura (A sube a 120 y a $260), re-edición (130 / $280) ───────
  perform public.fn_guardar_factura_compra(
    v_cuenta, v_pedido, v_prov, current_date, true, v_uid, jsonb_build_array(
      jsonb_build_object('item_pedido_id', v_item_a, 'producto_id', v_a, 'cantidad', 10,
        'costo_sin_iva', 120, 'descuento_porcentaje', 0, 'iva_compra_porcentaje', 21,
        'margen_porcentaje', 30, 'iva_venta_porcentaje', 21, 'precio_venta', 260),
      jsonb_build_object('item_pedido_id', v_item_b, 'producto_id', v_b, 'cantidad', 5,
        'costo_sin_iva', 50, 'descuento_porcentaje', 0, 'iva_compra_porcentaje', 21,
        'margen_porcentaje', 30, 'iva_venta_porcentaje', 21, 'precio_venta', 100)));
  perform public.fn_guardar_factura_compra(
    v_cuenta, v_pedido, v_prov, current_date, true, v_uid, jsonb_build_array(
      jsonb_build_object('item_pedido_id', v_item_a, 'producto_id', v_a, 'cantidad', 10,
        'costo_sin_iva', 130, 'descuento_porcentaje', 0, 'iva_compra_porcentaje', 21,
        'margen_porcentaje', 30, 'iva_venta_porcentaje', 21, 'precio_venta', 280),
      jsonb_build_object('item_pedido_id', v_item_b, 'producto_id', v_b, 'cantidad', 5,
        'costo_sin_iva', 50, 'descuento_porcentaje', 0, 'iva_compra_porcentaje', 21,
        'margen_porcentaje', 30, 'iva_venta_porcentaje', 21, 'precio_venta', 100)));

  assert public.fn_costo(v_a) = 130, '1) costo de A tras la factura 130, dio ' || public.fn_costo(v_a);
  select * into p from public.productos where id = v_a;
  assert p.precio_venta = 280, '1) precio de A tras la factura 280, dio ' || p.precio_venta;
  -- La foto es la de ANTES de la primera carga, no la de la re-edición.
  select costo, precio_venta into v_num, p.precio_venta
    from public.factura_compra_previos where cuenta_id = v_cuenta and producto_id = v_a;
  assert v_num = 100 and p.precio_venta = 200, '1) foto de A = 100 / 200, dio ' || v_num || ' / ' || p.precio_venta;
  select count(*) into v_n from public.factura_compra_previos where cuenta_id = v_cuenta;
  assert v_n = 2, '1) una foto por producto (2), hay ' || v_n;

  -- Pago parcial desde el banco + una cuota + un pago agendado.
  perform public.fn_pagar_cuenta(v_cuenta, v_uid, v_banco, 500, current_date, null, 'transferencia', '123');
  select saldo_actual into v_num from public.cuentas where id = v_banco;
  assert v_num = 99500, '1) el pago baja el banco a 99500, dio ' || v_num;
  select egreso_id into v_egreso from public.pagos_cuenta where cuenta_a_pagar_id = v_cuenta;
  insert into public.cuotas_cuenta_pagar (cuenta_a_pagar_id, numero, monto, fecha_vencimiento)
    values (v_cuenta, 1, 300, current_date + 30);
  insert into public.pagos_programados (cuenta_a_pagar_id, cuenta_origen_id, monto, fecha_programada)
    values (v_cuenta, v_banco, 300, current_date + 30);

  -- Ya se vendieron 8 de A: quedan 2 en la góndola y en el lote.
  update public.productos set stock_actual = 2 where id = v_a;
  update public.lotes set cantidad_actual = 2 where producto_id = v_a and pedido_origen_id = v_pedido;

  -- Previsualizar: avisa y NO toca nada.
  v_res := public.fn_eliminar_factura_compra(v_cuenta, null, true);
  assert v_res->>'bloqueo' is null, '1) sin bloqueo, dio ' || coalesce(v_res->>'bloqueo', '');
  assert jsonb_array_length(v_res->'pagos_revertidos') = 1, '1) previsualiza 1 pago';
  assert (v_res->'pagos_revertidos'->0->>'cuenta') = 'T342 banco', '1) el pago vuelve al banco';
  assert jsonb_array_length(v_res->'productos_negativos') = 1, '1) 1 producto quedaría negativo';
  assert (v_res->'productos_negativos'->0->>'stock_final')::numeric = -8, '1) A quedaría en -8';
  assert (v_res->>'recepcion_revertida')::boolean, '1) se deshace la recepción';
  assert exists (select 1 from public.facturas_compra where cuenta_id = v_cuenta), '1) previsualizar no borra';
  select saldo_actual into v_num from public.cuentas where id = v_banco;
  assert v_num = 99500, '1) previsualizar no mueve plata, banco ' || v_num;
  assert public.fn_costo(v_a) = 130, '1) previsualizar no toca el costo';

  -- Eliminar.
  v_res := public.fn_eliminar_factura_compra(v_cuenta);

  select saldo_actual into v_num from public.cuentas where id = v_banco;
  assert v_num = 100000, '1) la plata vuelve al banco (100000), dio ' || v_num;
  assert not exists (select 1 from public.egresos where id = v_egreso), '1) el gasto del pago se borra';
  assert not exists (select 1 from public.asientos where origen = 'egreso' and referencia_id = v_egreso),
    '1) el asiento del pago se borra';
  assert not exists (select 1 from public.asientos where origen = 'factura_compra' and referencia_id = v_cuenta),
    '1) el asiento de la factura se borra';
  assert not exists (select 1 from public.cuentas_a_pagar where id = v_cuenta), '1) la deuda desaparece';
  assert not exists (select 1 from public.facturas_compra where cuenta_id = v_cuenta), '1) la factura desaparece';
  assert not exists (select 1 from public.cuotas_cuenta_pagar where cuenta_a_pagar_id = v_cuenta), '1) sin cuotas';
  assert not exists (select 1 from public.pagos_programados where cuenta_a_pagar_id = v_cuenta and estado = 'pendiente'),
    '1) sin pagos agendados pendientes';

  select * into p from public.productos where id = v_a;
  assert p.stock_actual = -8, '1) A queda en -8 (forzado), dio ' || p.stock_actual;
  assert p.precio_venta = 200, '1) A vuelve a $200, dio ' || p.precio_venta;
  assert p.margen = 30, '1) A vuelve a margen 30, dio ' || p.margen;
  assert public.fn_costo(v_a) = 100, '1) A vuelve a costo 100, dio ' || public.fn_costo(v_a);
  select costo into v_num from public.proveedor_producto where proveedor_id = v_prov and producto_id = v_a;
  assert v_num = 100, '1) el costo del catálogo vuelve a 100, dio ' || v_num;
  select * into p from public.productos where id = v_b;
  assert p.stock_actual = 0, '1) B queda en 0, dio ' || p.stock_actual;
  assert p.precio_venta = 100 and public.fn_costo(v_b) = 50, '1) B sin cambios de costo/precio';

  select * into ip from public.items_pedido where id = v_item_a;
  assert ip.cantidad_recibida is null and ip.cantidad_facturada is null and ip.cuenta_a_pagar_id is null,
    '1) el renglón de A vuelve a sin recibir';
  select estado::text into v_txt from public.pedidos where id = v_pedido;
  assert v_txt = 'enviado', '1) la orden vuelve a Por recibir, dio ' || v_txt;
  assert not exists (select 1 from public.lotes where pedido_origen_id = v_pedido and producto_id = v_b),
    '1) el lote intacto de B se borra';
  select cantidad_actual, estado::text into v_num, v_txt
    from public.lotes where pedido_origen_id = v_pedido and producto_id = v_a;
  assert v_num = 0 and v_txt = 'agotado', '1) el lote consumido de A queda agotado en 0';
  assert not exists (select 1 from public.historial_costos where pedido_id = v_pedido),
    '1) el historial de costos de la orden se borra';
  assert exists (select 1 from public.auditoria where accion = 'eliminar_factura_compra'
                   and (detalle->>'cuenta_id')::integer = v_cuenta), '1) queda en auditoría';
  select count(*) into v_n from public.movimientos_stock
    where producto_id in (v_a, v_b) and nota like 'Factura eliminada%';
  assert v_n = 2, '1) dos movimientos de salida, hubo ' || v_n;

  -- ── 2) Otra compra posterior del mismo producto ───────────────────────
  insert into public.productos (nombre, precio_venta, margen, iva_venta, iva_compra, stock_actual)
    values ('T342 C', 50, 30, 21, 21, 10) returning id into v_c;
  perform public.fn_set_costo(v_c, 10);

  insert into public.pedidos (proveedor_id, usuario_id, estado, total)
    values (v_prov, v_uid, 'recibido', 0) returning id into v_pedido2;
  insert into public.cuentas_a_pagar (pedido_id, proveedor_id, monto, fecha_vencimiento, provisoria, tiene_factura)
    values (v_pedido2, v_prov, 50, current_date + 7, true, false) returning id into v_cuenta2;
  insert into public.items_pedido (pedido_id, producto_id, cantidad_pedida, cantidad_recibida, precio_costo, subtotal, cuenta_a_pagar_id)
    values (v_pedido2, v_c, 5, 5, 10, 50, v_cuenta2) returning id into v_item_c;
  perform public.fn_guardar_factura_compra(
    v_cuenta2, v_pedido2, v_prov, current_date, true, v_uid, jsonb_build_array(
      jsonb_build_object('item_pedido_id', v_item_c, 'producto_id', v_c, 'cantidad', 5,
        'costo_sin_iva', 20, 'descuento_porcentaje', 0, 'iva_compra_porcentaje', 21,
        'margen_porcentaje', 30, 'iva_venta_porcentaje', 21, 'precio_venta', 60)));

  insert into public.pedidos (proveedor_id, usuario_id, estado, total)
    values (v_prov, v_uid, 'recibido', 0) returning id into v_pedido3;
  insert into public.cuentas_a_pagar (pedido_id, proveedor_id, monto, fecha_vencimiento, provisoria, tiene_factura)
    values (v_pedido3, v_prov, 100, current_date + 7, true, false) returning id into v_cuenta3;
  insert into public.items_pedido (pedido_id, producto_id, cantidad_pedida, cantidad_recibida, precio_costo, subtotal, cuenta_a_pagar_id)
    values (v_pedido3, v_c, 5, 5, 20, 100, v_cuenta3) returning id into v_item_c;
  perform public.fn_guardar_factura_compra(
    v_cuenta3, v_pedido3, v_prov, current_date, true, v_uid, jsonb_build_array(
      jsonb_build_object('item_pedido_id', v_item_c, 'producto_id', v_c, 'cantidad', 5,
        'costo_sin_iva', 30, 'descuento_porcentaje', 0, 'iva_compra_porcentaje', 21,
        'margen_porcentaje', 30, 'iva_venta_porcentaje', 21, 'precio_venta', 70)));
  -- Dentro de una transacción now() no avanza: se separan las dos compras a mano.
  update public.facturas_compra set created_at = now() + interval '1 hour' where cuenta_id = v_cuenta3;
  update public.historial_costos set created_at = now() + interval '1 hour' where pedido_id = v_pedido3;
  update public.factura_compra_previos set created_at = now() + interval '1 hour' where cuenta_id = v_cuenta3;

  -- Eliminar la PRIMERA: la segunda ya dejó el costo en 30 → no se toca.
  v_res := public.fn_eliminar_factura_compra(v_cuenta2);
  assert jsonb_array_length(v_res->'costos_no_restaurados') = 1, '2) C figura como no restaurado';
  assert public.fn_costo(v_c) = 30, '2) el costo de C sigue en 30, dio ' || public.fn_costo(v_c);
  select precio_venta into v_num from public.productos where id = v_c;
  assert v_num = 70, '2) el precio de C sigue en 70, dio ' || v_num;
  select stock_actual into v_num from public.productos where id = v_c;
  assert v_num = 5, '2) el stock baja solo lo de esa orden (5), dio ' || v_num;

  -- ── 3) Mes cerrado → no se puede eliminar ─────────────────────────────
  update public.periodos_contables set estado = 'cerrado'
    where anio = extract(year from current_date)::int and mes = extract(month from current_date)::int;
  if not found then
    insert into public.periodos_contables (anio, mes, estado)
      values (extract(year from current_date)::int, extract(month from current_date)::int, 'cerrado');
  end if;
  v_res := public.fn_eliminar_factura_compra(v_cuenta3, null, true);
  assert v_res->>'bloqueo' is not null, '3) previsualizar informa el bloqueo';
  v_fallo := false;
  begin
    perform public.fn_eliminar_factura_compra(v_cuenta3);
  exception when others then v_fallo := true;
  end;
  assert v_fallo, '3) con el mes cerrado eliminar falla';
  assert exists (select 1 from public.facturas_compra where cuenta_id = v_cuenta3), '3) la factura sigue';
  update public.periodos_contables set estado = 'abierto'
    where anio = extract(year from current_date)::int and mes = extract(month from current_date)::int;

  -- Reabierto: ahora sí, y como es la última compra de C, vuelve a lo previo.
  v_res := public.fn_eliminar_factura_compra(v_cuenta3);
  assert public.fn_costo(v_c) = 20, '3) C vuelve al costo previo a esa factura (20), dio ' || public.fn_costo(v_c);
  select precio_venta into v_num from public.productos where id = v_c;
  assert v_num = 60, '3) C vuelve al precio previo (60), dio ' || v_num;

  -- ── 4) Compra directa pagada desde el banco ───────────────────────────
  insert into public.productos (nombre, precio_venta, margen, iva_venta, iva_compra, stock_actual)
    values ('T342 D', 500, 30, 21, 21, 0) returning id into v_d;
  perform public.fn_set_costo(v_d, 300);
  perform public.fn_registrar_compra_directa(
    v_uid, v_prov, current_date,
    jsonb_build_object('tipo_comprobante', 'X', 'neto', 1600, 'iva_total', 336),
    jsonb_build_array(jsonb_build_object('producto_id', v_d, 'cantidad', 4, 'costo_sin_iva', 400,
      'iva_compra_porcentaje', 21, 'margen_porcentaje', 30, 'iva_venta_porcentaje', 21)),
    null, true, false,
    jsonb_build_object('origen', 'cuenta', 'cuenta_id', v_banco),
    null, null);
  select id into v_factura from public.facturas_compra
    where proveedor_id = v_prov and es_directa order by id desc limit 1;
  select saldo_actual into v_num from public.cuentas where id = v_banco;
  assert v_num = 100000 - 1936, '4) la directa baja el banco, dio ' || v_num;
  assert public.fn_costo(v_d) = 400, '4) la directa deja el costo en 400';

  v_res := public.fn_eliminar_factura_compra(null, v_factura);
  select saldo_actual into v_num from public.cuentas where id = v_banco;
  assert v_num = 100000, '4) la plata de la directa vuelve (100000), dio ' || v_num;
  assert not exists (select 1 from public.facturas_compra where id = v_factura), '4) la directa desaparece';
  assert not exists (select 1 from public.asientos where origen = 'compra_directa' and referencia_id = v_factura),
    '4) sin asiento de la directa';
  select stock_actual into v_num from public.productos where id = v_d;
  assert v_num = 0, '4) el stock de D vuelve a 0, dio ' || v_num;
  assert public.fn_costo(v_d) = 300, '4) el costo de D vuelve a 300, dio ' || public.fn_costo(v_d);
  assert not (v_res->>'recepcion_revertida')::boolean, '4) una directa no tiene recepción';

  -- ── 5) "El proveedor debe la factura" ─────────────────────────────────
  insert into public.cuentas_a_pagar (pedido_id, proveedor_id, monto, fecha_vencimiento, provisoria, tiene_factura)
    values (null, v_prov, 100, current_date + 7, true, false) returning id into v_cuenta5;
  perform public.fn_marcar_factura_adeudada(v_cuenta5, true, '  la trae el lunes ');
  select factura_adeudada_nota into v_txt from public.cuentas_a_pagar
    where id = v_cuenta5 and factura_adeudada_desde is not null and factura_adeudada_por = v_uid;
  assert v_txt = 'la trae el lunes', '5) queda marcada con la nota limpia, dio ' || coalesce(v_txt, 'null');
  perform public.fn_marcar_factura_adeudada(v_cuenta5, false);
  assert exists (select 1 from public.cuentas_a_pagar where id = v_cuenta5
                   and factura_adeudada_desde is null and factura_adeudada_nota is null), '5) se desmarca';
  update public.cuentas_a_pagar set tiene_factura = true where id = v_cuenta5;
  v_fallo := false;
  begin
    perform public.fn_marcar_factura_adeudada(v_cuenta5, true);
  exception when others then v_fallo := true;
  end;
  assert v_fallo, '5) con la factura cargada no se puede marcar';

  raise notice 'OK · test_eliminar_factura: los 5 bloques pasaron.';
end $$;

rollback;
