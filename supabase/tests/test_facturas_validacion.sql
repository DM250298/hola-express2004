-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  Test · mig 303 · validación de facturas (portal de proveedores)      ║
-- ║                                                                        ║
-- ║  Correr en el SQL Editor DESPUÉS de la 303. Todo dentro de una         ║
-- ║  transacción que se deshace: no deja datos. Si algo falla, aborta     ║
-- ║  con el mensaje del assert.                                            ║
-- ║                                                                        ║
-- ║  Como `postgres` fn_tiene_permiso devuelve false (auth.uid() es        ║
-- ║  null): se setean los claims de un usuario real con permiso compras   ║
-- ║  o finanzas (reemplazar :uid). En PGlite se corrió con la misma       ║
-- ║  lógica el 2026-10-18 (scratchpad, base simulada).                     ║
-- ╚══════════════════════════════════════════════════════════════════════╝

begin;

do $$
declare
  v_uid uuid;
  v_prov integer;
  v_prod1 integer; v_prod2 integer; v_prod3 integer;
  v_pedido integer;
  v_cuenta integer;
  v_factura integer;
  v_directa integer;
  f record;
begin
  -- Un usuario con finanzas o compras (admin sirve).
  select u.id into v_uid from public.usuarios u where u.rol = 'admin' limit 1;
  if v_uid is null then raise exception 'No hay usuario admin para el test.'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid)::text, true);

  insert into public.proveedores (nombre) values ('TEST 303') returning id into v_prov;
  insert into public.productos (nombre, precio_venta, stock_actual) values ('T303 a', 1, 0) returning id into v_prod1;
  insert into public.productos (nombre, precio_venta, stock_actual) values ('T303 b', 1, 0) returning id into v_prod2;
  insert into public.productos (nombre, precio_venta, stock_actual) values ('T303 extra', 1, 0) returning id into v_prod3;
  insert into public.pedidos (proveedor_id, usuario_id, estado, total) values (v_prov, v_uid, 'recibido', 0) returning id into v_pedido;
  insert into public.cuentas_a_pagar (pedido_id, proveedor_id, monto, fecha_vencimiento, provisoria, tiene_factura)
    values (v_pedido, v_prov, 1000, current_date + 7, false, true) returning id into v_cuenta;
  -- Renglón 1: recibidos 10, facturados 12 a $100 → +200. Renglón 2: iguales.
  insert into public.items_pedido (pedido_id, producto_id, cantidad_pedida, cantidad_recibida, precio_costo, subtotal, cuenta_a_pagar_id, cantidad_facturada)
    values (v_pedido, v_prod1, 10, 10, 100, 1200, v_cuenta, 12), (v_pedido, v_prod2, 5, 5, 50, 250, v_cuenta, 5);
  insert into public.facturas_compra (cuenta_id, pedido_id, proveedor_id, fecha, neto, iva_total, total)
    values (v_cuenta, v_pedido, v_prov, current_date, 1450, 304.5, 1754.5) returning id into v_factura;
  -- Renglón extra: 3 × $20 con 10% → 54
  insert into public.items_factura_compra (factura_id, producto_id, cantidad, costo_sin_iva, descuento_porcentaje, iva_compra_porcentaje, costo_con_iva, margen_porcentaje, iva_venta_porcentaje, precio_sin_iva, precio_con_iva)
    values (v_factura, v_prod3, 3, 20, 10, 21, 21.78, 0, 21, 18, 21.78);

  assert (select validada from public.facturas_compra where id = v_factura) = false, 'una factura nueva arranca sin validar';

  perform public.fn_validar_factura_compra(v_factura);
  select * into f from public.facturas_compra where id = v_factura;
  assert f.validada, 'validada';
  assert f.validada_por = v_uid, 'validada_por';
  assert f.diferencia_recepcion = 254.00, 'diferencia 200 + 54, dio ' || f.diferencia_recepcion;
  assert f.renglones_diferentes = 2, 'renglones 1 + 1 extra, dio ' || f.renglones_diferentes;
  assert exists (select 1 from public.auditoria where accion = 'validar_factura_compra' and entidad_id = v_factura), 'auditada';

  perform public.fn_validar_factura_compra(v_factura, false);
  select * into f from public.facturas_compra where id = v_factura;
  assert not f.validada and f.diferencia_recepcion is null, 'reabierta y sin cruce';

  -- Directa sin orden: validar no cruza nada y la deja controlada.
  insert into public.facturas_compra (es_directa, controlada, proveedor_id, fecha, neto, iva_total, total)
    values (true, false, v_prov, current_date, 200, 42, 242) returning id into v_directa;
  perform public.fn_validar_factura_compra(v_directa);
  select * into f from public.facturas_compra where id = v_directa;
  assert f.validada and f.controlada and f.diferencia_recepcion is null, 'directa validada = controlada, sin cruce';

  -- Controlar (mig 123 reemitida) también valida / desvalida.
  perform public.fn_controlar_compra_directa(v_directa, v_uid, 'X', null, null, null, false);
  assert (select validada from public.facturas_compra where id = v_directa) = false, 'descontrolar la desvalida';
  perform public.fn_controlar_compra_directa(v_directa, v_uid, 'X', null, null, null, true);
  assert (select validada from public.facturas_compra where id = v_directa) = true, 'controlar la valida';

  -- Inexistente
  begin
    perform public.fn_validar_factura_compra(-1);
    raise exception 'debió fallar';
  exception when others then
    if sqlerrm = 'debió fallar' then raise; end if;
  end;

  raise notice 'OK mig 303: validación de facturas';
end $$;

-- T1: sin funciones duplicadas
do $$
declare n int;
begin
  select count(*) into n from (
    select proname from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and proname like 'fn_%' group by proname having count(*) > 1
  ) d;
  assert n = 0, 'funciones fn_% duplicadas: ' || n;
end $$;

rollback;
