-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  Test · mig 321 · fn_resultado_periodo (Finanzas › Tablero neto)      ║
-- ║                                                                        ║
-- ║  Correr en el SQL Editor DESPUÉS de la 321. Todo dentro de una         ║
-- ║  transacción que se deshace: no deja datos. Si algo falla, aborta     ║
-- ║  con el mensaje del assert. Caso chico: una venta 21 % (2×P1 a 1210,  ║
-- ║  costo 700), una exenta (3×P3 a 500, costo 400), una devolución de    ║
-- ║  1×P1 y una venta anulada que no debe contar.                         ║
-- ║                                                                        ║
-- ║  Como la base ya tiene ventas de hoy, compara la DIFERENCIA entre la  ║
-- ║  llamada de antes y la de después de insertar el caso.                ║
-- ║  Supone régimen Responsable Inscripto (si no, avisa y no compara).    ║
-- ║  Como `postgres` fn_tiene_permiso devuelve false: se setean los       ║
-- ║  claims de un usuario admin.                                          ║
-- ╚══════════════════════════════════════════════════════════════════════╝

begin;

do $$
declare
  v_uid uuid;
  v_turno integer;
  v_hoy date := (now() at time zone 'America/Argentina/La_Rioja')::date;
  p1 integer; p3 integer;
  v1 integer; v2 integer; v3 integer;
  i1 integer; i2 integer; i3 integer;
  d1 integer; id1 integer;
  antes jsonb; despues jsonb;
  v_sin_permiso boolean := false;
begin
  if public.fn_regimen_iva() <> 'responsable_inscripto' then
    raise notice 'Régimen % : el test compara números de Responsable Inscripto, no se ejecuta.',
      public.fn_regimen_iva();
    return;
  end if;

  -- Sin claims (postgres) no tiene el permiso finanzas: debe rechazar.
  begin
    perform public.fn_resultado_periodo(v_hoy, v_hoy);
  exception when insufficient_privilege then
    v_sin_permiso := true;
  end;
  if not v_sin_permiso then
    raise exception 'fn_resultado_periodo no exigió el permiso finanzas';
  end if;

  select u.id into v_uid from public.usuarios u where u.rol = 'admin' limit 1;
  if v_uid is null then raise exception 'No hay usuario admin para el test.'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid)::text, true);
  select t.id into v_turno from public.caja_turnos t order by t.id desc limit 1;
  if v_turno is null then raise exception 'No hay turnos de caja para colgar las ventas del test.'; end if;

  antes := public.fn_resultado_periodo(v_hoy - 1, v_hoy + 1);

  insert into public.productos (nombre, precio_venta, stock_actual, iva_venta, iva_compra, controlar_stock)
    values ('T321 P1 21%', 1210, 10, 21, 21, true) returning id into p1;
  insert into public.productos (nombre, precio_venta, stock_actual, iva_venta, iva_compra, controlar_stock)
    values ('T321 P3 exento', 500, 10, 0, 0, true) returning id into p3;
  insert into public.costos_producto (producto_id, precio_costo) values (p1, 700), (p3, 400);

  insert into public.ventas (turno_id, usuario_id, total, medio_pago, estado)
    values (v_turno, v_uid, 2420, 'efectivo', 'completada') returning id into v1;
  insert into public.ventas (turno_id, usuario_id, total, medio_pago, estado)
    values (v_turno, v_uid, 1500, 'efectivo', 'completada') returning id into v2;
  insert into public.ventas (turno_id, usuario_id, total, medio_pago, estado)
    values (v_turno, v_uid, 2420, 'efectivo', 'anulada') returning id into v3;
  insert into public.items_venta (venta_id, producto_id, cantidad, precio_unitario, subtotal)
    values (v1, p1, 2, 1210, 2420) returning id into i1;
  insert into public.items_venta (venta_id, producto_id, cantidad, precio_unitario, subtotal)
    values (v2, p3, 3, 500, 1500) returning id into i2;
  insert into public.items_venta (venta_id, producto_id, cantidad, precio_unitario, subtotal)
    values (v3, p1, 2, 1210, 2420) returning id into i3;
  insert into public.costos_item_venta (item_venta_id, costo_unitario)
    values (i1, 700), (i2, 400), (i3, 700);

  insert into public.devoluciones (venta_id, turno_id, usuario_id, tipo_reembolso, total_devuelto)
    values (v1, v_turno, v_uid, 'efectivo', 1210) returning id into d1;
  insert into public.items_devolucion (devolucion_id, item_venta_id, producto_id, cantidad, precio_unitario, subtotal, destino)
    values (d1, i1, p1, 1, 1210, 1210, 'stock') returning id into id1;
  insert into public.costos_item_devolucion (item_devolucion_id, costo_unitario) values (id1, 700);

  despues := public.fn_resultado_periodo(v_hoy - 1, v_hoy + 1);

  -- Diferencias esperadas: brutas +3920 · tickets +2 · netas +2500 (2000 + 1500 − 1000)
  -- · IVA +210 (420 − 210) · devoluciones +1210 · CMV +1900 (1400 + 1200 − 700).
  if (despues->>'ventas_brutas')::numeric - (antes->>'ventas_brutas')::numeric <> 3920 then
    raise exception 'ventas_brutas: % → % (esperado +3920)', antes->>'ventas_brutas', despues->>'ventas_brutas';
  end if;
  if (despues->>'tickets')::integer - (antes->>'tickets')::integer <> 2 then
    raise exception 'tickets: % → % (esperado +2)', antes->>'tickets', despues->>'tickets';
  end if;
  if (despues->>'ventas_netas')::numeric - (antes->>'ventas_netas')::numeric <> 2500 then
    raise exception 'ventas_netas: % → % (esperado +2500)', antes->>'ventas_netas', despues->>'ventas_netas';
  end if;
  if (despues->>'iva')::numeric - (antes->>'iva')::numeric <> 210 then
    raise exception 'iva: % → % (esperado +210)', antes->>'iva', despues->>'iva';
  end if;
  if (despues->>'devoluciones')::numeric - (antes->>'devoluciones')::numeric <> 1210 then
    raise exception 'devoluciones: % → % (esperado +1210)', antes->>'devoluciones', despues->>'devoluciones';
  end if;
  if (despues->>'cmv')::numeric - (antes->>'cmv')::numeric <> 1900 then
    raise exception 'cmv: % → % (esperado +1900)', antes->>'cmv', despues->>'cmv';
  end if;
  if jsonb_typeof(despues->'dias') <> 'array' then
    raise exception 'dias no es un array: %', despues->'dias';
  end if;

  raise notice 'OK · fn_resultado_periodo: brutas +3920, netas +2500, IVA +210, devoluciones +1210, CMV +1900 (margen del caso 600 = 24 %% sobre neto).';
end $$;

rollback;
