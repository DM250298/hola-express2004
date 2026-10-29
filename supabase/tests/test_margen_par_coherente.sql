-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  Test · migs 322–324 · el margen guardado es siempre el real           ║
-- ║                                                                        ║
-- ║  Correr en el SQL Editor DESPUÉS de la 322, la 323 y la 324. Todo      ║
-- ║  dentro de una transacción que se deshace: no deja datos. Si algo      ║
-- ║  falla, aborta con el mensaje del assert.                              ║
-- ║                                                                        ║
-- ║  Como `postgres` fn_tiene_permiso devuelve false (auth.uid() es        ║
-- ║  null): se setean los claims de un usuario admin real. Necesita el     ║
-- ║  plan de cuentas cargado (1.1.04, 1.1.05, 2.1.01) y config_fiscal.     ║
-- ╚══════════════════════════════════════════════════════════════════════╝

begin;

do $$
declare
  v_uid uuid;
  v_prov integer;
  v_a integer; v_b integer; v_c integer; v_d integer;
  v_item_a integer; v_item_b integer;
  v_pedido integer;
  v_cuenta integer;
  v_precio_c numeric;
  v_esperado numeric;
  p record;
  r record;
  v_rep numeric;
  v_real numeric;
begin
  select u.id into v_uid from public.usuarios u where u.rol = 'admin' limit 1;
  if v_uid is null then raise exception 'No hay usuario admin para el test.'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid)::text, true);

  insert into public.proveedores (nombre) values ('TEST 322') returning id into v_prov;

  -- A = el par viejo de Trix: precio 7400,27 y margen 16,97 coherentes con un
  --     costo de 4481 (hoy el costo real es otro). Con lista mayorista.
  insert into public.productos (nombre, precio_venta, margen, iva_venta, iva_compra, stock_actual,
                                precio_mayorista, margen_mayorista)
    values ('T324 A trix', 7400.27, 16.97, 21, 21, 10, 6000, 10) returning id into v_a;
  perform public.fn_set_costo(v_a, 4481);
  -- B = alta al vuelo, sin precio.
  insert into public.productos (nombre, precio_venta, margen, iva_venta, iva_compra, stock_actual, pendiente_precio)
    values ('T324 B nuevo', 0, 0, 21, 21, 0, true) returning id into v_b;
  -- C = puesto por margen: el precio sale del motor con margen 30 → coherente.
  v_precio_c := public.fn_precio_venta(1000, 30, 21);
  insert into public.productos (nombre, precio_venta, margen, iva_venta, iva_compra, stock_actual)
    values ('T324 C coherente', v_precio_c, 30, 21, 21, 0) returning id into v_c;
  perform public.fn_set_costo(v_c, 1000);
  -- D = mismo precio que C pero el costo bajó a 800 y nadie tocó el margen.
  insert into public.productos (nombre, precio_venta, margen, iva_venta, iva_compra, stock_actual)
    values ('T324 D desactualizado', v_precio_c, 30, 21, 21, 0) returning id into v_d;
  perform public.fn_set_costo(v_d, 800);

  insert into public.pedidos (proveedor_id, usuario_id, estado, total)
    values (v_prov, v_uid, 'recibido', 0) returning id into v_pedido;
  insert into public.cuentas_a_pagar (pedido_id, proveedor_id, monto, fecha_vencimiento, provisoria, tiene_factura)
    values (v_pedido, v_prov, 1000, current_date + 7, true, false) returning id into v_cuenta;
  insert into public.items_pedido (pedido_id, producto_id, cantidad_pedida, cantidad_recibida, precio_costo, subtotal, cuenta_a_pagar_id)
    values (v_pedido, v_a, 6, 6, 3262.24, 19573.44, v_cuenta) returning id into v_item_a;
  insert into public.items_pedido (pedido_id, producto_id, cantidad_pedida, cantidad_recibida, precio_costo, subtotal, cuenta_a_pagar_id)
    values (v_pedido, v_b, 4, 4, 500, 2000, v_cuenta) returning id into v_item_b;

  -- ── 1) Cliente viejo: p_afecta_precio_venta = false ─────────────────────
  --   El costo cambia (4481 → 3262,24), el precio NO, y el margen pasa a ser
  --   el real del par. B sigue sin precio (no hay precio que proteger).
  perform public.fn_guardar_factura_compra(
    v_cuenta, v_pedido, v_prov, current_date, false, v_uid,
    jsonb_build_array(
      jsonb_build_object('item_pedido_id', v_item_a, 'producto_id', v_a, 'cantidad', 6,
        'costo_sin_iva', 3262.24, 'descuento_porcentaje', 0, 'iva_compra_porcentaje', 21,
        'margen_porcentaje', 16.97, 'iva_venta_porcentaje', 21, 'precio_venta', null, 'aplicar_iva', true),
      jsonb_build_object('item_pedido_id', v_item_b, 'producto_id', v_b, 'cantidad', 4,
        'costo_sin_iva', 500, 'descuento_porcentaje', 0, 'iva_compra_porcentaje', 21,
        'margen_porcentaje', 30, 'iva_venta_porcentaje', 21, 'precio_venta', null, 'aplicar_iva', true)
    ));
  select * into p from public.productos where id = v_a;
  assert p.precio_venta = 7400.27, '1) precio intacto, dio ' || p.precio_venta;
  assert public.fn_costo(v_a) = 3262.24, '1) costo nuevo, dio ' || public.fn_costo(v_a);
  v_esperado := public.fn_margen_desde_precio(3262.24, 7400.27, 21);
  assert p.margen = v_esperado, '1) margen real ' || v_esperado || ', dio ' || p.margen;
  assert p.margen > 60 and p.margen < 61, '1) margen real ≈ 60,69, dio ' || p.margen;
  assert p.precio_mayorista = 6000, '1) precio mayorista intacto, dio ' || p.precio_mayorista;
  assert p.margen_mayorista = public.fn_margen_desde_precio(3262.24, 6000, 21),
    '1) margen mayorista re-deducido, dio ' || p.margen_mayorista;
  assert not exists (select 1 from public.etiquetas_pendientes where producto_id = v_a),
    '1) sin etiqueta: el precio no cambió';
  select * into p from public.productos where id = v_b;
  assert p.precio_venta = 0 and p.pendiente_precio, '1) B sigue pendiente de precio';

  -- ── 2) App nueva: true + renglón sin tocar (precio vigente en la línea) ──
  --   Mismo resultado para A; B recibe el precio del margen 30 y deja de
  --   estar pendiente.
  perform public.fn_guardar_factura_compra(
    v_cuenta, v_pedido, v_prov, current_date, true, v_uid,
    jsonb_build_array(
      jsonb_build_object('item_pedido_id', v_item_a, 'producto_id', v_a, 'cantidad', 6,
        'costo_sin_iva', 3262.24, 'descuento_porcentaje', 0, 'iva_compra_porcentaje', 21,
        'margen_porcentaje', 60.69, 'iva_venta_porcentaje', 21, 'precio_venta', 7400.27, 'aplicar_iva', true),
      jsonb_build_object('item_pedido_id', v_item_b, 'producto_id', v_b, 'cantidad', 4,
        'costo_sin_iva', 500, 'descuento_porcentaje', 0, 'iva_compra_porcentaje', 21,
        'margen_porcentaje', 30, 'iva_venta_porcentaje', 21, 'precio_venta', null, 'aplicar_iva', true)
    ));
  select * into p from public.productos where id = v_a;
  assert p.precio_venta = 7400.27, '2) precio intacto, dio ' || p.precio_venta;
  assert p.margen = v_esperado, '2) margen real, dio ' || p.margen;
  select * into p from public.productos where id = v_b;
  assert p.precio_venta = public.fn_precio_venta(500, 30, 21), '2) B priceado por margen, dio ' || p.precio_venta;
  assert p.margen = 30 and not p.pendiente_precio, '2) B margen 30 y ya no pendiente';

  -- ── 3) Margen tocado: el motor fija el precio y encola etiqueta ──────────
  perform public.fn_guardar_factura_compra(
    v_cuenta, v_pedido, v_prov, current_date, true, v_uid,
    jsonb_build_array(
      jsonb_build_object('item_pedido_id', v_item_a, 'producto_id', v_a, 'cantidad', 6,
        'costo_sin_iva', 3262.24, 'descuento_porcentaje', 0, 'iva_compra_porcentaje', 21,
        'margen_porcentaje', 40, 'iva_venta_porcentaje', 21, 'precio_venta', null, 'aplicar_iva', true),
      jsonb_build_object('item_pedido_id', v_item_b, 'producto_id', v_b, 'cantidad', 4,
        'costo_sin_iva', 500, 'descuento_porcentaje', 0, 'iva_compra_porcentaje', 21,
        'margen_porcentaje', 30, 'iva_venta_porcentaje', 21, 'precio_venta', null, 'aplicar_iva', true)
    ));
  select * into p from public.productos where id = v_a;
  assert p.precio_venta = public.fn_precio_venta(3262.24, 40, 21), '3) precio del motor, dio ' || p.precio_venta;
  assert p.margen = 40, '3) margen 40, dio ' || p.margen;
  assert exists (select 1 from public.etiquetas_pendientes where producto_id = v_a and precio = p.precio_venta),
    '3) etiqueta encolada con el precio nuevo';

  -- ── 4) Compra directa con el tilde apagado (mig 323) ────────────────────
  --   El costo pasa a 3000, el precio no se toca y el margen vuelve a ser el
  --   real con ese costo.
  perform public.fn_registrar_compra_directa(
    v_uid, v_prov, current_date,
    jsonb_build_object('tipo_comprobante', 'X', 'neto', 3000, 'iva_total', 630),
    jsonb_build_array(jsonb_build_object('producto_id', v_a, 'cantidad', 1, 'costo_sin_iva', 3000,
      'iva_compra_porcentaje', 21, 'margen_porcentaje', 40, 'iva_venta_porcentaje', 21)),
    null, true, false,
    jsonb_build_object('origen', 'ninguno'),
    jsonb_build_object('fecha_vencimiento', (current_date + 30)::text),
    null);
  select * into p from public.productos where id = v_a;
  assert public.fn_costo(v_a) = 3000, '4) costo 3000, dio ' || public.fn_costo(v_a);
  assert p.precio_venta = public.fn_precio_venta(3262.24, 40, 21), '4) precio intacto, dio ' || p.precio_venta;
  assert p.margen = public.fn_margen_desde_precio(3000, p.precio_venta, 21), '4) margen real con costo 3000, dio ' || p.margen;

  -- ── 5) Backfill (copia del cuerpo de la 324, acotada a los productos del
  --       test para que sea rápida y determinista) ──────────────────────────
  for r in
    select pr.id, pr.precio_venta, pr.margen, pr.precio_mayorista, pr.margen_mayorista,
           coalesce(pr.iva_venta, 21) as iva_venta, c.precio_costo as costo
      from public.productos pr
      join public.costos_producto c on c.producto_id = pr.id
     where pr.activo and pr.precio_venta > 0 and c.precio_costo > 0
       and coalesce(pr.tipo, '') <> 'combo'
       and not exists (select 1 from public.producto_componentes pc where pc.producto_id = pr.id)
       and pr.nombre like 'T324 %'
  loop
    v_rep := public.fn_precio_venta(r.costo, coalesce(r.margen, 0), r.iva_venta);
    if abs(v_rep - r.precio_venta) > 0.5 then
      v_real := public.fn_margen_desde_precio(r.costo, r.precio_venta, r.iva_venta);
      if v_real is distinct from r.margen then
        update public.productos set margen = v_real, updated_at = now() where id = r.id;
      end if;
    end if;
  end loop;
  select * into p from public.productos where id = v_c;
  assert p.margen = 30, '5) C coherente no cambia, dio ' || p.margen;
  select * into p from public.productos where id = v_d;
  v_esperado := public.fn_margen_desde_precio(800, v_precio_c, 21);
  assert p.margen = v_esperado and p.margen <> 30, '5) D re-deducido a ' || v_esperado || ', dio ' || p.margen;
  select * into p from public.productos where id = v_a;
  assert p.margen = public.fn_margen_desde_precio(3000, p.precio_venta, 21), '5) A ya coherente, no cambia';

  raise notice 'OK migs 322-324: el margen guardado es siempre el real del par';
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
