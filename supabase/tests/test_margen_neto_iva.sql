-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  Test · migs 311–319 · margen comercial neto de IVA y devoluciones    ║
-- ║                                                                        ║
-- ║  Correr en el SQL Editor DESPUÉS de la 319. Todo dentro de una         ║
-- ║  transacción que se deshace: no deja datos. Si algo falla, aborta     ║
-- ║  con el mensaje del assert. Mismo caso que el banco de PGlite del     ║
-- ║  2026-10-28: P1 21 %, P2 10,5 %, P3 exento, combo P1+P3, una           ║
-- ║  devolución de 1×P1 y una venta anulada que no debe contar.           ║
-- ║                                                                        ║
-- ║  Supone régimen Responsable Inscripto (si no, avisa y no compara).    ║
-- ║  Como `postgres` fn_tiene_permiso devuelve false: se setean los       ║
-- ║  claims de un usuario admin para que fn_resumen_skus muestre costos.  ║
-- ╚══════════════════════════════════════════════════════════════════════╝

begin;

do $$
declare
  v_uid uuid;
  v_turno integer;
  v_hoy date := (now() at time zone 'America/Argentina/La_Rioja')::date;
  p1 integer; p2 integer; p3 integer; pc integer;
  v1 integer; v2 integer; v3 integer;
  i1 integer; i2 integer; i3 integer; i4 integer; i5 integer;
  d1 integer; id1 integer;
  r record;
  v_bruto numeric; v_neto numeric; v_costo numeric;
begin
  if public.fn_regimen_iva() <> 'responsable_inscripto' then
    raise notice 'Régimen % : el test compara números de Responsable Inscripto, no se ejecuta.',
      public.fn_regimen_iva();
    return;
  end if;

  select u.id into v_uid from public.usuarios u where u.rol = 'admin' limit 1;
  if v_uid is null then raise exception 'No hay usuario admin para el test.'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid)::text, true);
  select t.id into v_turno from public.caja_turnos t order by t.id desc limit 1;
  if v_turno is null then raise exception 'No hay turnos de caja para colgar las ventas del test.'; end if;

  -- Productos de prueba (se borran con el rollback).
  insert into public.productos (nombre, precio_venta, stock_actual, iva_venta, iva_compra, controlar_stock)
    values ('T311 P1 21%', 1210, 10, 21, 21, true) returning id into p1;
  insert into public.productos (nombre, precio_venta, stock_actual, iva_venta, iva_compra, controlar_stock)
    values ('T311 P2 10,5%', 1105, 10, 10.5, 10.5, true) returning id into p2;
  insert into public.productos (nombre, precio_venta, stock_actual, iva_venta, iva_compra, controlar_stock)
    values ('T311 P3 exento', 500, 10, 0, 0, true) returning id into p3;
  insert into public.productos (nombre, precio_venta, stock_actual, iva_venta, iva_compra, controlar_stock)
    values ('T311 combo', 1573, 0, 21, 21, true) returning id into pc;
  insert into public.costos_producto (producto_id, precio_costo) values (p1, 700), (p2, 800), (p3, 400);
  insert into public.producto_componentes (producto_id, componente_id, cantidad) values (pc, p1, 1), (pc, p3, 1);

  -- Venta 1: 2×P1 + 1×P2 · Venta 2: 3×P3 + 1×combo · Venta 3 anulada: 5×P2
  insert into public.ventas (turno_id, usuario_id, total, medio_pago, estado)
    values (v_turno, v_uid, 3525, 'efectivo', 'completada') returning id into v1;
  insert into public.ventas (turno_id, usuario_id, total, medio_pago, estado)
    values (v_turno, v_uid, 3073, 'efectivo', 'completada') returning id into v2;
  insert into public.ventas (turno_id, usuario_id, total, medio_pago, estado)
    values (v_turno, v_uid, 5525, 'efectivo', 'anulada') returning id into v3;
  insert into public.items_venta (venta_id, producto_id, cantidad, precio_unitario, subtotal)
    values (v1, p1, 2, 1210, 2420) returning id into i1;
  insert into public.items_venta (venta_id, producto_id, cantidad, precio_unitario, subtotal)
    values (v1, p2, 1, 1105, 1105) returning id into i2;
  insert into public.items_venta (venta_id, producto_id, cantidad, precio_unitario, subtotal)
    values (v2, p3, 3, 500, 1500) returning id into i3;
  insert into public.items_venta (venta_id, producto_id, cantidad, precio_unitario, subtotal)
    values (v2, pc, 1, 1573, 1573) returning id into i4;
  insert into public.items_venta (venta_id, producto_id, cantidad, precio_unitario, subtotal)
    values (v3, p2, 5, 1105, 5525) returning id into i5;
  insert into public.costos_item_venta (item_venta_id, costo_unitario)
    values (i1, 700), (i2, 800), (i3, 400), (i4, 1100), (i5, 800);

  -- El trigger de la 311 congeló la alícuota del producto.
  if (select iv.iva_venta from public.items_venta iv where iv.id = i2) <> 10.5 then
    raise exception 'trg_items_venta_iva no completó iva_venta (P2 debía quedar en 10,5)';
  end if;
  -- Cambiar la alícuota del producto después no altera el histórico.
  update public.productos set iva_venta = 21 where id = p2;

  -- Devolución: 1×P1 de la venta 1, a stock.
  insert into public.devoluciones (venta_id, turno_id, usuario_id, tipo_reembolso, total_devuelto)
    values (v1, v_turno, v_uid, 'efectivo', 1210) returning id into d1;
  insert into public.items_devolucion (devolucion_id, item_venta_id, producto_id, cantidad, precio_unitario, subtotal, destino)
    values (d1, i1, p1, 1, 1210, 1210, 'stock') returning id into id1;
  insert into public.costos_item_devolucion (item_devolucion_id, costo_unitario) values (id1, 700);

  -- 1. Helpers: lo vendido (sin la anulada) y lo devuelto.
  select sum(x.bruto), sum(x.neto), sum(x.costo) into v_bruto, v_neto, v_costo
    from public.fn_items_vendidos_neto(v_hoy - 1, v_hoy + 1, array[p1, p2, p3, pc]) x;
  if round(v_bruto, 2) <> 6598 or round(v_neto, 2) <> 5800 or round(v_costo, 2) <> 4500 then
    raise exception 'fn_items_vendidos_neto: bruto % neto % costo % (esperado 6598 / 5800 / 4500)', v_bruto, v_neto, v_costo;
  end if;
  select sum(x.bruto), sum(x.neto), sum(x.costo) into v_bruto, v_neto, v_costo
    from public.fn_items_devueltos_neto(v_hoy - 1, v_hoy + 1, array[p1, p2, p3, pc]) x;
  if round(v_bruto, 2) <> 1210 or round(v_neto, 2) <> 1000 or round(v_costo, 2) <> 700 then
    raise exception 'fn_items_devueltos_neto: bruto % neto % costo % (esperado 1210 / 1000 / 700)', v_bruto, v_neto, v_costo;
  end if;

  -- 2. fn_resumen_skus: margen neto por producto.
  for r in
    select rs.producto_id, rs.ingresos, rs.ingresos_netos, rs.iva_ventas, rs.devoluciones,
           rs.costo_ventas, rs.margen_pesos, rs.margen_pct
      from public.fn_resumen_skus(v_hoy - 1, v_hoy + 1) rs
     where rs.producto_id in (p1, p2, p3, pc)
  loop
    if r.producto_id = p1 and (r.ingresos, r.devoluciones, r.ingresos_netos, r.costo_ventas, r.margen_pesos, r.margen_pct)
         is distinct from (2420::numeric, 1210::numeric, 1000::numeric, 700::numeric, 300::numeric, 30.0::numeric) then
      raise exception 'P1: % (esperado 2420/1210/1000/700/300/30.0)', r;
    elsif r.producto_id = p2 and (r.ingresos, r.ingresos_netos, r.costo_ventas, r.margen_pesos, r.margen_pct)
         is distinct from (1105::numeric, 1000::numeric, 800::numeric, 200::numeric, 20.0::numeric) then
      raise exception 'P2: % (esperado 1105/1000/800/200/20.0)', r;
    elsif r.producto_id = p3 and (r.ingresos, r.ingresos_netos, r.costo_ventas, r.margen_pesos, r.margen_pct)
         is distinct from (1500::numeric, 1500::numeric, 1200::numeric, 300::numeric, 20.0::numeric) then
      raise exception 'P3: % (esperado 1500/1500/1200/300/20.0)', r;
    elsif r.producto_id = pc and (r.ingresos, r.ingresos_netos, r.costo_ventas, r.margen_pesos, r.margen_pct)
         is distinct from (1573::numeric, 1300::numeric, 1100::numeric, 200::numeric, 15.4::numeric) then
      raise exception 'Combo: % (esperado 1573/1300/1100/200/15.4)', r;
    end if;
  end loop;

  raise notice 'OK · margen neto de IVA: helpers y fn_resumen_skus dan lo esperado (margen total 1000 = 20,8 %% sobre 4800 netos).';
end $$;

rollback;
