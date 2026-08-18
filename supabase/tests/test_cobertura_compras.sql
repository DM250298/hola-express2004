-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  TEST · Compras por cobertura (migraciones 151 + 152)               ║
-- ║                                                                     ║
-- ║  Correr COMPLETO en el SQL Editor de Supabase, DESPUÉS de aplicar   ║
-- ║  la 151 y la 152. Todo corre dentro de una transacción que termina  ║
-- ║  ROLLBACK: no deja usuarios, productos, ventas ni pedidos.          ║
-- ║  Es seguro correrlo contra la base de producción.                   ║
-- ║                                                                     ║
-- ║  Si algo falla, corta con "TEST FALLÓ: ..." y el rollback es        ║
-- ║  automático. Si pasa todo, la última línea de Messages dice         ║
-- ║  "✔✔✔ TODOS LOS TESTS PASARON (rollback aplicado)".                 ║
-- ║                                                                     ║
-- ║  Son los MISMOS 10 escenarios de lib/compras/cobertura.test.ts      ║
-- ║  (espejo TS del motor): si un caso cambia acá, cambiarlo allá.      ║
-- ║  Config del proveedor de prueba: objetivo 12 · seguridad 2 ·        ║
-- ║  frecuencia 5 → punto = vd × 7, objetivo = vd × 12.                 ║
-- ╚════════════════════════════════════════════════════════════════════╝

begin;

-- Helper temporal (muere con la transacción): simula el usuario logueado
-- seteando el claim JWT que lee auth.uid().
create function pg_temp.como_usuario(p_uid uuid) returns void
language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end $f$;

do $$
declare
  v_user uuid := gen_random_uuid();
  v_prov integer;
  v_turno integer;
  v_venta integer;
  v_venta_anulada integer;
  -- productos de prueba (uno por caso)
  v_p1 integer;   -- stock suficiente
  v_p2 integer;   -- en el punto → sugiere hasta objetivo
  v_p3 integer;   -- tránsito descuenta
  v_p4 integer;   -- recepción parcial → solo lo pendiente
  v_p5 integer;   -- cancelado → tránsito 0
  v_p6 integer;   -- sin ventas → gris, sin sugerencia
  v_p6b integer;  -- crítico sin ventas → piso stock_minimo
  v_p7 integer;   -- stock negativo
  v_p8 integer;   -- sobrestock
  v_p9 integer;   -- presentación x6
  v_p10 integer;  -- por kg (decimales)
  v_combo integer;    -- combo (fuera del listado)
  v_comp integer;     -- componente del combo (hereda velocity)
  v_p12 integer;  -- borrador pendiente
  v_ped integer;
  v_num numeric;
  v_num2 numeric;
  v_num3 numeric;
  v_bool boolean;
  v_txt text;
  v_n integer;
begin
  raise notice '━━ SETUP ━━';

  -- Usuario de prueba con permisos de compras + costos
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
    updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  values
    ('00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated',
     'test.cobertura@test.local', 'x', now(), '{"provider":"email","providers":["email"]}',
     '{}', now(), now(), '', '', '', '');

  insert into public.roles (codigo, nombre, es_sistema, permisos)
  values ('test_cobertura', 'Test cobertura', false, '{compras,pedidos,costos}')
  on conflict (codigo) do nothing;

  insert into public.usuarios (id, email, nombre, rol, activo)
  values (v_user, 'test.cobertura@test.local', 'Test Cobertura', 'test_cobertura', true)
  on conflict (id) do update set rol = 'test_cobertura', activo = true;

  -- Proveedor con config propia: objetivo 12 días, seguridad 2, frecuencia 5
  insert into public.proveedores (nombre, dias_entrega,
    dias_cobertura_objetivo, dias_seguridad, frecuencia_reposicion_dias)
  values ('Test Cobertura SA', 2, 12, 2, 5)
  returning id into v_prov;

  -- Productos (ventas 60 u en 30 días → vd 2 → punto 14, objetivo 24)
  insert into public.productos (nombre, precio_venta, stock_actual, stock_minimo, activo, proveedor_id)
  values ('TC P1 suficiente', 100, 40, 5, true, v_prov) returning id into v_p1;
  insert into public.productos (nombre, precio_venta, stock_actual, stock_minimo, activo, proveedor_id)
  values ('TC P2 en el punto', 100, 14, 5, true, v_prov) returning id into v_p2;
  insert into public.productos (nombre, precio_venta, stock_actual, stock_minimo, activo, proveedor_id)
  values ('TC P3 transito', 100, 8, 5, true, v_prov) returning id into v_p3;
  insert into public.productos (nombre, precio_venta, stock_actual, stock_minimo, activo, proveedor_id)
  values ('TC P4 parcial', 100, 0, 5, true, v_prov) returning id into v_p4;
  insert into public.productos (nombre, precio_venta, stock_actual, stock_minimo, activo, proveedor_id)
  values ('TC P5 cancelado', 100, 40, 5, true, v_prov) returning id into v_p5;
  insert into public.productos (nombre, precio_venta, stock_actual, stock_minimo, activo, proveedor_id)
  values ('TC P6 sin ventas', 100, 3, 5, true, v_prov) returning id into v_p6;
  insert into public.productos (nombre, precio_venta, stock_actual, stock_minimo, activo, proveedor_id, es_critico)
  values ('TC P6b critico', 100, 2, 10, true, v_prov, true) returning id into v_p6b;
  insert into public.productos (nombre, precio_venta, stock_actual, stock_minimo, activo, proveedor_id)
  values ('TC P7 negativo', 100, -4, 5, true, v_prov) returning id into v_p7;
  insert into public.productos (nombre, precio_venta, stock_actual, stock_minimo, activo, proveedor_id)
  values ('TC P8 sobrestock', 100, 100, 5, true, v_prov) returning id into v_p8;
  insert into public.productos (nombre, precio_venta, stock_actual, stock_minimo, activo, proveedor_id)
  values ('TC P9 caja x6', 100, 14, 5, true, v_prov) returning id into v_p9;
  insert into public.productos (nombre, precio_venta, stock_actual, stock_minimo, activo, proveedor_id, venta_por_peso)
  values ('TC P10 por kg', 100, 2.5, 0, true, v_prov, true) returning id into v_p10;
  insert into public.productos (nombre, precio_venta, stock_actual, stock_minimo, activo, proveedor_id, tipo)
  values ('TC Combo', 100, 0, 0, true, v_prov, 'combo') returning id into v_combo;
  insert into public.productos (nombre, precio_venta, stock_actual, stock_minimo, activo, proveedor_id)
  values ('TC Componente', 100, 40, 5, true, v_prov) returning id into v_comp;
  insert into public.productos (nombre, precio_venta, stock_actual, stock_minimo, activo, proveedor_id)
  values ('TC P12 borrador', 100, 14, 5, true, v_prov) returning id into v_p12;

  -- Backdatear TODO el seed: recién insertados, los productos calificarían
  -- como "producto nuevo" (created_at < 30 días) y la rama crítico/nuevo
  -- les sugeriría compra al de "sin ventas" (P6). La rama sin ventas se
  -- cubre con P6b vía es_critico.
  update public.productos
     set created_at = now() - interval '90 days'
   where id in (v_p1, v_p2, v_p3, v_p4, v_p5, v_p6, v_p6b, v_p7, v_p8,
                v_p9, v_p10, v_combo, v_comp, v_p12);

  -- Combo: 1 combo = 2 componentes
  insert into public.producto_componentes (producto_id, componente_id, cantidad)
  values (v_combo, v_comp, 2);

  -- Presentación caja x6 para P9 + costos para el chequeo de gate
  insert into public.proveedor_producto (proveedor_id, producto_id, costo, es_principal, multiplo_compra)
  values (v_prov, v_p9, 90, true, 6);
  insert into public.costos_producto (producto_id, precio_costo)
  values (v_p9, 100)
  on conflict (producto_id) do update set precio_costo = 100;

  -- Ventas: turno + una venta completada hace 1 día con 60 u de cada producto
  -- con historial (y 45,5 kg del de peso; 30 combos → 60 u del componente).
  insert into public.caja_turnos (usuario_id, monto_apertura)
  values (v_user, 0) returning id into v_turno;

  insert into public.ventas (turno_id, usuario_id, fecha, total, medio_pago, estado)
  values (v_turno, v_user, now() - interval '1 day', 0, 'efectivo', 'completada')
  returning id into v_venta;

  insert into public.items_venta (venta_id, producto_id, cantidad, precio_unitario, subtotal)
  values
    (v_venta, v_p1, 60, 100, 6000),
    (v_venta, v_p2, 60, 100, 6000),
    (v_venta, v_p3, 60, 100, 6000),
    (v_venta, v_p4, 60, 100, 6000),
    (v_venta, v_p5, 60, 100, 6000),
    (v_venta, v_p7, 60, 100, 6000),
    (v_venta, v_p8, 60, 100, 6000),
    (v_venta, v_p9, 60, 100, 6000),
    (v_venta, v_p10, 45.5, 100, 4550),
    (v_venta, v_combo, 30, 100, 3000),
    (v_venta, v_p12, 60, 100, 6000);

  -- Venta ANULADA con cantidad enorme: no debe contar en la velocity
  insert into public.ventas (turno_id, usuario_id, fecha, total, medio_pago, estado)
  values (v_turno, v_user, now() - interval '1 day', 0, 'efectivo', 'anulada')
  returning id into v_venta_anulada;
  insert into public.items_venta (venta_id, producto_id, cantidad, precio_unitario, subtotal)
  values (v_venta_anulada, v_p1, 999, 100, 99900);

  -- Pedidos:
  -- P3: OC enviada por 6 (tránsito pleno)
  insert into public.pedidos (proveedor_id, usuario_id, estado, total)
  values (v_prov, v_user, 'enviado', 600) returning id into v_ped;
  insert into public.items_pedido (pedido_id, producto_id, cantidad_pedida, precio_costo, subtotal)
  values (v_ped, v_p3, 6, 100, 600);

  -- P4: OC de 30, recibidas 18 → pendiente 12 (recepcion_parcial)
  insert into public.pedidos (proveedor_id, usuario_id, estado, total)
  values (v_prov, v_user, 'enviado', 3000) returning id into v_ped;
  insert into public.items_pedido (pedido_id, producto_id, cantidad_pedida, cantidad_recibida, precio_costo, subtotal)
  values (v_ped, v_p4, 30, 18, 100, 3000);
  update public.pedidos set estado = 'recepcion_parcial' where id = v_ped;

  -- P5: OC cancelada por 50 → NO cuenta
  insert into public.pedidos (proveedor_id, usuario_id, estado, total)
  values (v_prov, v_user, 'borrador', 5000) returning id into v_ped;
  insert into public.items_pedido (pedido_id, producto_id, cantidad_pedida, precio_costo, subtotal)
  values (v_ped, v_p5, 50, 100, 5000);
  update public.pedidos set estado = 'cancelado' where id = v_ped;

  -- P12: OC en borrador por 7 → NO suma tránsito, sí avisa
  insert into public.pedidos (proveedor_id, usuario_id, estado, total)
  values (v_prov, v_user, 'borrador', 700) returning id into v_ped;
  insert into public.items_pedido (pedido_id, producto_id, cantidad_pedida, precio_costo, subtotal)
  values (v_ped, v_p12, 7, 100, 700);

  perform pg_temp.como_usuario(v_user);
  raise notice 'OK · seed listo (proveedor %, 15 productos)', v_prov;

  raise notice '━━ CASOS ━━';

  -- Caso 1 · stock suficiente (y la venta anulada NO cuenta)
  select f.venta_diaria, f.punto_reposicion, f.cantidad_sugerida, f.requiere_compra
    into v_num, v_num2, v_num3, v_bool
    from public.fn_sugerencias_compra(v_prov) f where f.producto_id = v_p1;
  if v_num <> 2 or v_num2 <> 14 or v_num3 <> 0 or v_bool then
    raise exception 'TEST FALLÓ: P1 esperaba vd=2 punto=14 sug=0 sin requerir; dio vd=% punto=% sug=% req=%',
      v_num, v_num2, v_num3, v_bool;
  end if;
  raise notice 'OK · Caso 1: stock suficiente → sugerido 0 (anulada excluida) ✔';

  -- Caso 2 · en el punto → hasta el objetivo
  select f.stock_objetivo, f.cantidad_sugerida, f.requiere_compra, f.clase_abc
    into v_num, v_num2, v_bool, v_txt
    from public.fn_sugerencias_compra(v_prov) f where f.producto_id = v_p2;
  if not v_bool or v_num <> 24 or v_num2 <> 10 then
    raise exception 'TEST FALLÓ: P2 esperaba objetivo=24 sug=10 requiriendo; dio obj=% sug=% req=%',
      v_num, v_num2, v_bool;
  end if;
  if v_txt is null then
    raise exception 'TEST FALLÓ: P2 vendió con ingresos y su clase ABC vino NULL';
  end if;
  raise notice 'OK · Caso 2: debajo del punto → sugiere 10 (clase %) ✔', v_txt;

  -- Caso 3 · tránsito descuenta
  select f.stock_en_transito, f.cantidad_sugerida into v_num, v_num2
    from public.fn_sugerencias_compra(v_prov) f where f.producto_id = v_p3;
  if v_num <> 6 or v_num2 <> 10 then
    raise exception 'TEST FALLÓ: P3 esperaba transito=6 sug=10 (24−8−6); dio transito=% sug=%', v_num, v_num2;
  end if;
  raise notice 'OK · Caso 3: tránsito 6 descontado → sugiere 10 ✔';

  -- Caso 4 · recepción parcial → solo lo pendiente
  select f.stock_en_transito, f.cantidad_sugerida into v_num, v_num2
    from public.fn_sugerencias_compra(v_prov) f where f.producto_id = v_p4;
  if v_num <> 12 or v_num2 <> 12 then
    raise exception 'TEST FALLÓ: P4 esperaba pendiente=12 sug=12 (24−0−12); dio pendiente=% sug=%', v_num, v_num2;
  end if;
  raise notice 'OK · Caso 4: parcial 30−18 → pendiente 12 ✔';

  -- Caso 5 · cancelado no cuenta
  select f.stock_en_transito, f.requiere_compra into v_num, v_bool
    from public.fn_sugerencias_compra(v_prov) f where f.producto_id = v_p5;
  if v_num <> 0 or v_bool then
    raise exception 'TEST FALLÓ: P5 cancelado esperaba transito=0 sin requerir; dio transito=% req=%', v_num, v_bool;
  end if;
  raise notice 'OK · Caso 5: OC cancelada → tránsito 0 ✔';

  -- Caso 6 · sin ventas → días NULL, sin sugerencia
  select f.dias_stock, f.cantidad_sugerida, f.requiere_compra into v_num, v_num2, v_bool
    from public.fn_sugerencias_compra(v_prov) f where f.producto_id = v_p6;
  if v_num is not null or v_num2 <> 0 or v_bool then
    raise exception 'TEST FALLÓ: P6 sin ventas esperaba dias NULL sug=0; dio dias=% sug=% req=%', v_num, v_num2, v_bool;
  end if;
  raise notice 'OK · Caso 6: sin ventas → días NULL, sugerido 0 ✔';

  -- Caso 6b · crítico sin ventas → piso stock_minimo
  select f.cantidad_sugerida, f.requiere_compra into v_num, v_bool
    from public.fn_sugerencias_compra(v_prov) f where f.producto_id = v_p6b;
  if not v_bool or v_num <> 8 then
    raise exception 'TEST FALLÓ: P6b crítico esperaba sug=8 (mín 10 − stock 2); dio sug=% req=%', v_num, v_bool;
  end if;
  raise notice 'OK · Caso 6b: crítico sin ventas → piso del mínimo, sugiere 8 ✔';

  -- Caso 7 · stock negativo
  select f.cantidad_sugerida, f.dias_stock into v_num, v_num2
    from public.fn_sugerencias_compra(v_prov) f where f.producto_id = v_p7;
  if v_num <> 28 or v_num2 >= 0 then
    raise exception 'TEST FALLÓ: P7 esperaba sug=28 (24+4) y días negativos; dio sug=% dias=%', v_num, v_num2;
  end if;
  raise notice 'OK · Caso 7: stock −4 → repone 28 ✔';

  -- Caso 8 · sobrestock → sugerido 0 (el flag visual es del motor TS)
  select f.dias_stock, f.cantidad_sugerida, f.requiere_compra into v_num, v_num2, v_bool
    from public.fn_sugerencias_compra(v_prov) f where f.producto_id = v_p8;
  if v_num <> 50 or v_num2 <> 0 or v_bool then
    raise exception 'TEST FALLÓ: P8 esperaba 50 días y sug=0; dio dias=% sug=% req=%', v_num, v_num2, v_bool;
  end if;
  raise notice 'OK · Caso 8: 50 días de stock → sugerido 0 ✔';

  -- Caso 9 · presentación x6 → redondea hacia arriba (+ gate de costos OK)
  select f.cantidad_sugerida, f.cantidad_sugerida_redondeada, f.multiplo_compra
    into v_num, v_num2, v_num3
    from public.fn_sugerencias_compra(v_prov) f where f.producto_id = v_p9;
  if v_num <> 10 or v_num2 <> 12 or v_num3 <> 6 then
    raise exception 'TEST FALLÓ: P9 esperaba sug=10 → 12 (caja x6); dio sug=% red=% mult=%', v_num, v_num2, v_num3;
  end if;
  select f.ultimo_costo into v_num
    from public.fn_sugerencias_compra(v_prov) f where f.producto_id = v_p9;
  if v_num is distinct from 90 then
    raise exception 'TEST FALLÓ: P9 con permiso costos esperaba ultimo_costo=90; dio %', v_num;
  end if;
  raise notice 'OK · Caso 9: necesidad 10 → 2 cajas = 12 u (costo visible con permiso) ✔';

  -- Caso 10 · por kg → decimales intactos
  select f.venta_diaria, f.cantidad_sugerida, f.cantidad_sugerida_redondeada
    into v_num, v_num2, v_num3
    from public.fn_sugerencias_compra(v_prov) f where f.producto_id = v_p10;
  if v_num <> 1.517 or v_num2 <> 15.704 or v_num3 <> 15.704 then
    raise exception 'TEST FALLÓ: P10 esperaba vd=1,517 sug=15,704 sin entero; dio vd=% sug=% red=%',
      v_num, v_num2, v_num3;
  end if;
  raise notice 'OK · Caso 10: por kg → 15,704 kg con decimales ✔';

  -- Combos · el combo queda afuera; el componente hereda la velocity
  select count(*) into v_n
    from public.fn_sugerencias_compra(v_prov) f where f.producto_id = v_combo;
  if v_n <> 0 then
    raise exception 'TEST FALLÓ: el combo no debe aparecer en las sugerencias (apareció % veces)', v_n;
  end if;
  select f.venta_30d, f.clase_abc into v_num, v_txt
    from public.fn_sugerencias_compra(v_prov) f where f.producto_id = v_comp;
  if v_num <> 60 then
    raise exception 'TEST FALLÓ: componente esperaba venta_30d=60 (30 combos × 2); dio %', v_num;
  end if;
  if v_txt is not null then
    raise exception 'TEST FALLÓ: componente sin ventas propias esperaba clase ABC NULL; dio %', v_txt;
  end if;
  raise notice 'OK · Combos: combo excluido, componente hereda 60 u (ABC NULL) ✔';

  -- Borradores · avisan pero no descuentan
  select f.borrador_pendiente, f.stock_en_transito, f.cantidad_sugerida
    into v_num, v_num2, v_num3
    from public.fn_sugerencias_compra(v_prov) f where f.producto_id = v_p12;
  if v_num <> 7 or v_num2 <> 0 or v_num3 <> 10 then
    raise exception 'TEST FALLÓ: P12 esperaba borrador=7 transito=0 sug=10; dio borrador=% transito=% sug=%',
      v_num, v_num2, v_num3;
  end if;
  raise notice 'OK · Borrador: avisa 7 u sin descontar la sugerencia ✔';

  raise notice '━━ V2 (mig 152) ━━';

  -- Calendario · fn_dias_hasta_entrega (fechas fijas: 17/8/2026 es lunes)
  select public.fn_dias_hasta_entrega(
    array[1,3,5]::smallint[], array[2,4,6]::smallint[], date '2026-08-17')
    into v_num;
  if v_num <> 1 then
    raise exception 'TEST FALLÓ: lunes con toma L/X/V y entrega M/J/S esperaba 1 día; dio %', v_num;
  end if;
  select public.fn_dias_hasta_entrega(
    array[1,3,5]::smallint[], array[2,4,6]::smallint[], date '2026-08-18')
    into v_num;
  if v_num <> 2 then
    raise exception 'TEST FALLÓ: martes esperaba 2 días (pide miércoles, entrega jueves); dio %', v_num;
  end if;
  select public.fn_dias_hasta_entrega(
    array[1]::smallint[], array[1]::smallint[], date '2026-08-17')
    into v_num;
  if v_num <> 7 then
    raise exception 'TEST FALLÓ: toma y entrega el mismo día esperaba 7; dio %', v_num;
  end if;
  select public.fn_dias_hasta_entrega(null, array[2]::smallint[], date '2026-08-17')
    into v_num;
  if v_num is not null then
    raise exception 'TEST FALLÓ: sin días de toma esperaba NULL; dio %', v_num;
  end if;
  raise notice 'OK · Calendario: 1 / 2 / 7 días y NULL sin calendario ✔';

  -- Calendario · manda sobre la frecuencia fija en fn_sugerencias_compra
  update public.proveedores
     set dias_toma_pedido = array[1,3,5]::smallint[],
         dias_entrega_semana = array[2,4,6]::smallint[]
   where id = v_prov;
  select f.frecuencia_reposicion_dias into v_num
    from public.fn_sugerencias_compra(v_prov) f where f.producto_id = v_p2;
  select public.fn_dias_hasta_entrega(
    array[1,3,5]::smallint[], array[2,4,6]::smallint[], current_date)
    into v_num2;
  if v_num is distinct from v_num2 then
    raise exception 'TEST FALLÓ: con calendario cargado esperaba frecuencia=% (días hasta entrega); dio %',
      v_num2, v_num;
  end if;
  update public.proveedores
     set dias_toma_pedido = null, dias_entrega_semana = null
   where id = v_prov;
  raise notice 'OK · El calendario reemplaza a la frecuencia fija (% días) ✔', v_num2;

  -- Sugerido persistido · fn_actualizar_pedido conserva las columnas nuevas
  insert into public.pedidos (proveedor_id, usuario_id, estado, total)
  values (v_prov, v_user, 'borrador', 0) returning id into v_ped;
  perform public.fn_actualizar_pedido(
    v_ped, v_prov, null, null, 'enviado',
    jsonb_build_array(jsonb_build_object(
      'producto_id', v_p1,
      'cantidad_pedida', 12,
      'precio_costo', 100,
      'cantidad_sugerida', 10,
      'motivo_ajuste', 'Bonificación 3x2')));
  select ip.cantidad_sugerida, ip.motivo_ajuste into v_num, v_txt
    from public.items_pedido ip where ip.pedido_id = v_ped;
  if v_num <> 10 or v_txt <> 'Bonificación 3x2' then
    raise exception 'TEST FALLÓ: fn_actualizar_pedido esperaba sugerida=10 y motivo; dio sugerida=% motivo=%',
      v_num, v_txt;
  end if;
  -- Segunda edición SIN los campos: quedan NULL (no inventa datos viejos)
  perform public.fn_actualizar_pedido(
    v_ped, v_prov, null, null, 'enviado',
    jsonb_build_array(jsonb_build_object(
      'producto_id', v_p1, 'cantidad_pedida', 15, 'precio_costo', 100)));
  select ip.cantidad_sugerida into v_num
    from public.items_pedido ip where ip.pedido_id = v_ped;
  if v_num is not null then
    raise exception 'TEST FALLÓ: edición sin sugerida esperaba NULL; dio %', v_num;
  end if;
  raise notice 'OK · fn_actualizar_pedido persiste sugerido + motivo ✔';

end $$;

rollback;

do $$ begin
  raise notice '✔✔✔ TODOS LOS TESTS PASARON (rollback aplicado)';
end $$;
