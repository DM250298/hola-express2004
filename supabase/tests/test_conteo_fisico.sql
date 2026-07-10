-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  TEST · Conteo Físico por zonas (migraciones 097 + 098)             ║
-- ║                                                                     ║
-- ║  Correr COMPLETO en el SQL Editor de Supabase, DESPUÉS de aplicar   ║
-- ║  097 y 098. Todo corre dentro de una transacción que termina en     ║
-- ║  ROLLBACK: no deja usuarios, productos, sesiones ni movimientos.    ║
-- ║  Es seguro correrlo contra la base de producción.                   ║
-- ║                                                                     ║
-- ║  Si algo falla, corta con "TEST FALLÓ: ..." y el rollback es        ║
-- ║  automático. Si pasa todo, la última línea de Messages dice         ║
-- ║  "✔✔✔ TODOS LOS TESTS PASARON (rollback aplicado)".                 ║
-- ║                                                                     ║
-- ║  Qué verifica:                                                      ║
-- ║   1. Compensación: producto en 3 zonas (10+5+8) con teórico 25 y    ║
-- ║      2 ventas durante la sesión → diferencia 0.                     ║
-- ║   2. Ingresos compensados: recepción de +5 durante la sesión.       ║
-- ║   3. Conteo ciego: empleado no lee conteo_snapshot (RLS) ni         ║
-- ║      fn_conteo_diferencias (gate de permiso).                       ║
-- ║   4. FEFO: faltante de 7 con lotes de 5 (vence antes) y 10 → el     ║
-- ║      viejo queda 0/'agotado' y el nuevo queda 8.                    ║
-- ║   5. Sobrante con lote → suma al más reciente; sin lotes → NO crea  ║
-- ║      lote (stock fuera de lotes).                                   ║
-- ║   6. Reconteo: mismo usuario rechazado, otra persona OK, pendiente  ║
-- ║      bloquea el cierre.                                             ║
-- ║   7. Estados: no se cierra con zonas abiertas, ni sin revisión, ni  ║
-- ║      sin confirmar la sincronización de cajas.                      ║
-- ║   8. Ajustes SOLO por movimientos tipo 'ajuste_conteo' con          ║
-- ║      referencia a la sesión; producto no contado NO se ajusta;      ║
-- ║      contado en cero SÍ se ajusta a cero.                           ║
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
  v_admin uuid := gen_random_uuid();
  v_emp1  uuid := gen_random_uuid();
  v_emp2  uuid := gen_random_uuid();
  -- productos de prueba
  v_p1 integer; -- 3 zonas + 2 ventas → dif 0
  v_p2 integer; -- FEFO: lotes 5 y 10, faltante 7
  v_p3 integer; -- sobrante sin lotes
  v_p4 integer; -- nunca contado → no se ajusta
  v_p5 integer; -- contado en cero → se ajusta a 0
  v_p6 integer; -- ingreso de +5 compensado → dif 0
  v_p7 integer; -- controlar_stock = false → fuera del snapshot
  v_p8 integer; -- sobrante con lote → suma al lote
  v_lote_viejo integer; v_lote_nuevo integer; v_lote_p8 integer;
  v_sesion public.conteo_sesiones;
  v_z1 integer; v_z2 integer; v_z3 integer;
  v_res jsonb;
  v_n integer;
  v_num numeric;
  v_num2 numeric;
  v_txt text;
  v_estado text;
  v_bool boolean;
  v_bool2 boolean;
  v_obs text[];
begin
  raise notice '━━ SETUP ━━';

  -- Usuarios de prueba. El trigger on_auth_user_created crea la fila espejo
  -- en public.usuarios; el upsert posterior cubre el caso de que el trigger
  -- no exista y fija rol y nombre.
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
    updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  values
    ('00000000-0000-0000-0000-000000000000', v_admin, 'authenticated', 'authenticated',
     'test.conteo.admin@test.local', 'x', now(), '{"provider":"email","providers":["email"]}',
     '{}', now(), now(), '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', v_emp1, 'authenticated', 'authenticated',
     'test.conteo.emp1@test.local', 'x', now(), '{"provider":"email","providers":["email"]}',
     '{}', now(), now(), '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', v_emp2, 'authenticated', 'authenticated',
     'test.conteo.emp2@test.local', 'x', now(), '{"provider":"email","providers":["email"]}',
     '{}', now(), now(), '', '', '', '');

  -- Rol descartable con permisos CONOCIDOS: el test no depende de cómo estén
  -- configurados los roles reales de producción (códigos y permisos pueden
  -- estar personalizados desde la matriz de Configuración). El rollback lo
  -- borra. El admin usa el rol 'admin' porque fn_tiene_permiso lo bypassea
  -- hardcodeado, sin mirar la tabla roles.
  insert into public.roles (codigo, nombre, es_sistema, permisos)
  values ('test_conteo_staff', 'TEST Staff Conteo', false, array['inventario'])
  on conflict (codigo) do update set permisos = excluded.permisos;

  insert into public.usuarios (id, email, nombre, rol, activo) values
    (v_admin, 'test.conteo.admin@test.local', 'TEST Admin Conteo', 'admin', true),
    (v_emp1,  'test.conteo.emp1@test.local',  'TEST Empleada 1',   'test_conteo_staff', true),
    (v_emp2,  'test.conteo.emp2@test.local',  'TEST Empleada 2',   'test_conteo_staff', true)
  on conflict (id) do update
    set rol = excluded.rol, nombre = excluded.nombre, activo = true;

  -- Productos de prueba (los nombres con prefijo TEST no chocan con nada).
  insert into public.productos (nombre, precio_venta, stock_actual, stock_minimo, activo, controlar_stock)
  values ('TEST CONTEO P1 tres zonas', 100, 25, 0, true, true) returning id into v_p1;
  insert into public.productos (nombre, precio_venta, stock_actual, stock_minimo, activo, controlar_stock)
  values ('TEST CONTEO P2 fefo', 100, 15, 0, true, true) returning id into v_p2;
  insert into public.productos (nombre, precio_venta, stock_actual, stock_minimo, activo, controlar_stock)
  values ('TEST CONTEO P3 sobrante sin lotes', 100, 10, 0, true, true) returning id into v_p3;
  insert into public.productos (nombre, precio_venta, stock_actual, stock_minimo, activo, controlar_stock)
  values ('TEST CONTEO P4 no contado', 100, 8, 0, true, true) returning id into v_p4;
  insert into public.productos (nombre, precio_venta, stock_actual, stock_minimo, activo, controlar_stock)
  values ('TEST CONTEO P5 contado cero', 100, 4, 0, true, true) returning id into v_p5;
  insert into public.productos (nombre, precio_venta, stock_actual, stock_minimo, activo, controlar_stock)
  values ('TEST CONTEO P6 ingreso', 100, 10, 0, true, true) returning id into v_p6;
  insert into public.productos (nombre, precio_venta, stock_actual, stock_minimo, activo, controlar_stock)
  values ('TEST CONTEO P7 sin control', 100, 99, 0, true, false) returning id into v_p7;
  insert into public.productos (nombre, precio_venta, stock_actual, stock_minimo, activo, controlar_stock)
  values ('TEST CONTEO P8 sobrante con lote', 100, 5, 0, true, true) returning id into v_p8;

  -- Costos: P2 caro (para disparar el umbral de $), el resto barato.
  perform public.fn_set_costo(v_p1, 100);
  perform public.fn_set_costo(v_p2, 1000);
  perform public.fn_set_costo(v_p3, 100);
  perform public.fn_set_costo(v_p5, 100);
  perform public.fn_set_costo(v_p8, 100);
  -- P4 y P6 quedan SIN fila en costos_producto a propósito: prueba que el
  -- costo NULL no envenena el reporte ni el cierre.

  -- Lotes: P2 con lote viejo (5 u., vence antes) y nuevo (10 u.).
  insert into public.lotes (producto_id, fecha_vencimiento, cantidad_inicial, cantidad_actual, estado)
  values (v_p2, current_date + 5, 5, 5, 'activo') returning id into v_lote_viejo;
  insert into public.lotes (producto_id, fecha_vencimiento, cantidad_inicial, cantidad_actual, estado)
  values (v_p2, current_date + 30, 10, 10, 'activo') returning id into v_lote_nuevo;
  insert into public.lotes (producto_id, fecha_vencimiento, cantidad_inicial, cantidad_actual, estado)
  values (v_p8, current_date + 10, 5, 5, 'activo') returning id into v_lote_p8;

  raise notice '━━ 1 · APERTURA ━━';
  perform pg_temp.como_usuario(v_admin);
  execute 'set local role authenticated';

  -- Sin zonas → error.
  begin
    perform public.fn_abrir_sesion_conteo('TEST sin zonas', 5000, '[]'::jsonb);
    raise exception 'TEST FALLÓ: fn_abrir_sesion_conteo aceptó una sesión sin zonas';
  exception when others then
    if sqlerrm like 'TEST FALLÓ%' then raise; end if;
    if sqlerrm not like '%al menos una zona%' then raise; end if;
  end;
  raise notice 'OK · abrir sin zonas rechazado';

  select * into v_sesion from public.fn_abrir_sesion_conteo(
    'TEST Inventario', 5000,
    jsonb_build_array(
      jsonb_build_object('nombre', 'TEST Zona 1', 'responsable_user_id', v_emp1, 'orden', 0),
      jsonb_build_object('nombre', 'TEST Zona 2', 'responsable_user_id', v_emp1, 'orden', 1),
      jsonb_build_object('nombre', 'TEST Zona 3', 'responsable_user_id', null,   'orden', 2)
    ));
  select id into v_z1 from public.conteo_zonas where sesion_id = v_sesion.id and nombre = 'TEST Zona 1';
  select id into v_z2 from public.conteo_zonas where sesion_id = v_sesion.id and nombre = 'TEST Zona 2';
  select id into v_z3 from public.conteo_zonas where sesion_id = v_sesion.id and nombre = 'TEST Zona 3';

  select count(*) into v_n from public.conteo_snapshot
   where sesion_id = v_sesion.id and producto_id in (v_p1, v_p2, v_p3, v_p4, v_p5, v_p6, v_p8);
  if v_n <> 7 then
    raise exception 'TEST FALLÓ: el snapshot debía incluir los 7 productos con control (tiene %)', v_n;
  end if;
  select count(*) into v_n from public.conteo_snapshot
   where sesion_id = v_sesion.id and producto_id = v_p7;
  if v_n <> 0 then
    raise exception 'TEST FALLÓ: el snapshot incluyó un producto con controlar_stock = false';
  end if;
  raise notice 'OK · sesión abierta, snapshot correcto (incluye 7, excluye sin control)';

  -- Segunda sesión en paralelo → error.
  begin
    perform public.fn_abrir_sesion_conteo('TEST otra', 5000,
      jsonb_build_array(jsonb_build_object('nombre', 'Z', 'responsable_user_id', null)));
    raise exception 'TEST FALLÓ: se pudo abrir una segunda sesión en paralelo';
  exception when others then
    if sqlerrm like 'TEST FALLÓ%' then raise; end if;
    if sqlerrm not like '%Ya hay una sesión%' then raise; end if;
  end;
  raise notice 'OK · segunda sesión rechazada';

  raise notice '━━ 2 · MOVIMIENTOS DURANTE LA SESIÓN (ventas e ingreso simulados) ━━';
  execute 'reset role';
  -- 2 ventas de P1 (lo que haría fn_crear_venta con el stock y el historial).
  -- created_at = clock_timestamp() porque now() queda congelado al inicio de
  -- esta transacción, ANTES de ts_apertura.
  update public.productos set stock_actual = 24 where id = v_p1;
  insert into public.movimientos_stock (producto_id, tipo, cantidad, stock_anterior, stock_nuevo, referencia_id, usuario_id, nota, created_at)
  values (v_p1, 'venta', 1, 25, 24, null, v_emp1, 'TEST venta simulada 1', clock_timestamp());
  update public.productos set stock_actual = 23 where id = v_p1;
  insert into public.movimientos_stock (producto_id, tipo, cantidad, stock_anterior, stock_nuevo, referencia_id, usuario_id, nota, created_at)
  values (v_p1, 'venta', 1, 24, 23, null, v_emp1, 'TEST venta simulada 2', clock_timestamp());
  -- 1 ingreso de mercadería de P6 (+5, lo que haría fn_recibir_pedido).
  update public.productos set stock_actual = 15 where id = v_p6;
  insert into public.movimientos_stock (producto_id, tipo, cantidad, stock_anterior, stock_nuevo, referencia_id, usuario_id, nota, created_at)
  values (v_p6, 'entrada', 5, 10, 15, null, v_admin, 'TEST ingreso simulado', clock_timestamp());
  raise notice 'OK · 2 ventas de P1 y 1 ingreso de P6 registrados';

  raise notice '━━ 3 · CONTEO CIEGO (RLS) ━━';
  perform pg_temp.como_usuario(v_emp1);
  execute 'set local role authenticated';

  select count(*) into v_n from public.conteo_snapshot where sesion_id = v_sesion.id;
  if v_n <> 0 then
    raise exception 'TEST FALLÓ: un empleado pudo leer % filas de conteo_snapshot (RLS rota)', v_n;
  end if;
  begin
    perform * from public.fn_conteo_diferencias(v_sesion.id);
    raise exception 'TEST FALLÓ: un empleado pudo ejecutar fn_conteo_diferencias';
  exception when others then
    if sqlerrm like 'TEST FALLÓ%' then raise; end if;
    if sqlerrm not like '%permiso%' then raise; end if;
  end;
  begin
    perform public.fn_abrir_sesion_conteo('TEST emp', 5000,
      jsonb_build_array(jsonb_build_object('nombre', 'Z', 'responsable_user_id', null)));
    raise exception 'TEST FALLÓ: un empleado pudo abrir una sesión';
  exception when others then
    if sqlerrm like 'TEST FALLÓ%' then raise; end if;
    if sqlerrm not like '%permiso%' then raise; end if;
  end;
  raise notice 'OK · empleado no ve snapshot, ni diferencias, ni abre sesiones';

  raise notice '━━ 4 · CONTEO POR ZONAS ━━';
  -- emp2 no puede iniciar la zona de emp1.
  perform pg_temp.como_usuario(v_emp2);
  begin
    perform public.fn_iniciar_zona(v_z1);
    raise exception 'TEST FALLÓ: un usuario ajeno inició una zona con responsable';
  exception when others then
    if sqlerrm like 'TEST FALLÓ%' then raise; end if;
    if sqlerrm not like '%responsable%' then raise; end if;
  end;
  raise notice 'OK · zona con responsable protegida';

  -- Contar sin iniciar la zona → error.
  perform pg_temp.como_usuario(v_emp1);
  begin
    perform public.fn_registrar_conteo(v_z1, v_p1, 9);
    raise exception 'TEST FALLÓ: se pudo contar en una zona sin iniciar';
  exception when others then
    if sqlerrm like 'TEST FALLÓ%' then raise; end if;
    if sqlerrm not like '%no está en curso%' then raise; end if;
  end;

  perform public.fn_iniciar_zona(v_z1);
  -- Upsert: primero 9, después corrige a 10 → una sola fila con 10.
  perform public.fn_registrar_conteo(v_z1, v_p1, 9);
  perform public.fn_registrar_conteo(v_z1, v_p1, 10);
  select count(*), max(cantidad_contada) into v_n, v_num
    from public.conteo_detalle where zona_id = v_z1 and producto_id = v_p1 and not es_reconteo;
  if v_n <> 1 or v_num <> 10 then
    raise exception 'TEST FALLÓ: el upsert del conteo no reemplazó (filas=%, cantidad=%)', v_n, v_num;
  end if;
  raise notice 'OK · upsert de conteo reemplaza en vez de duplicar';

  perform public.fn_registrar_conteo(v_z1, v_p2, 8);
  perform public.fn_registrar_conteo(v_z1, v_p3, 13);
  perform public.fn_registrar_conteo(v_z1, v_p5, 0, 'vencido');
  perform public.fn_registrar_conteo(v_z1, v_p6, 15);
  perform public.fn_registrar_conteo(v_z1, v_p8, 7);

  -- Producto fuera del snapshot (sin control de stock) → rechazado.
  begin
    perform public.fn_registrar_conteo(v_z1, v_p7, 3);
    raise exception 'TEST FALLÓ: se pudo contar un producto fuera del snapshot';
  exception when others then
    if sqlerrm like 'TEST FALLÓ%' then raise; end if;
    if sqlerrm not like '%no forma parte%' then raise; end if;
  end;
  raise notice 'OK · producto sin control de stock rechazado con mensaje claro';

  perform public.fn_cerrar_zona(v_z1);

  perform public.fn_iniciar_zona(v_z2);
  perform public.fn_registrar_conteo(v_z2, v_p1, 5);
  perform public.fn_cerrar_zona(v_z2);

  -- Zona 3 sin responsable: la reclama emp2.
  perform pg_temp.como_usuario(v_emp2);
  perform public.fn_iniciar_zona(v_z3);
  select responsable_user_id::text into v_txt from public.conteo_zonas where id = v_z3;
  if v_txt <> v_emp2::text then
    raise exception 'TEST FALLÓ: la zona sin responsable no quedó reclamada por quien la inició';
  end if;
  perform public.fn_registrar_conteo(v_z3, v_p1, 8);
  raise notice 'OK · zona sin responsable reclamada y contada por otra empleada';

  raise notice '━━ 5 · REVISIÓN ━━';
  perform pg_temp.como_usuario(v_admin);
  -- Con la zona 3 abierta no se pasa a revisión ni se cierra.
  begin
    perform public.fn_pasar_a_revision(v_sesion.id);
    raise exception 'TEST FALLÓ: pasó a revisión con una zona abierta';
  exception when others then
    if sqlerrm like 'TEST FALLÓ%' then raise; end if;
    if sqlerrm not like '%sin cerrar%' then raise; end if;
  end;
  begin
    perform public.fn_cerrar_sesion_conteo(v_sesion.id, true);
    raise exception 'TEST FALLÓ: se cerró la sesión sin pasar por revisión';
  exception when others then
    if sqlerrm like 'TEST FALLÓ%' then raise; end if;
    if sqlerrm not like '%revisión%' then raise; end if;
  end;
  raise notice 'OK · zona abierta bloquea revisión y cierre';

  perform pg_temp.como_usuario(v_emp2);
  perform public.fn_cerrar_zona(v_z3);
  perform pg_temp.como_usuario(v_admin);
  perform public.fn_pasar_a_revision(v_sesion.id);

  -- Diferencias esperadas por producto.
  select diferencia, relevante into v_num, v_bool
    from public.fn_conteo_diferencias(v_sesion.id) where producto_id = v_p1;
  if v_num <> 0 or v_bool then
    raise exception 'TEST FALLÓ: P1 (3 zonas + 2 ventas) debía dar diferencia 0 no relevante, dio % (relevante=%)', v_num, v_bool;
  end if;
  raise notice 'OK · P1: 10+5+8 contra teórico 25 con 2 ventas → diferencia 0 ✔ (criterio de aceptación)';

  select diferencia, diferencia_pesos, relevante into v_num, v_num2, v_bool
    from public.fn_conteo_diferencias(v_sesion.id) where producto_id = v_p2;
  if v_num <> -7 or v_num2 <> -7000 or not v_bool then
    raise exception 'TEST FALLÓ: P2 debía dar -7 unidades / -7000 pesos relevante, dio % / %', v_num, v_num2;
  end if;
  select diferencia into v_num from public.fn_conteo_diferencias(v_sesion.id) where producto_id = v_p3;
  if v_num <> 3 then
    raise exception 'TEST FALLÓ: P3 debía dar sobrante +3, dio %', v_num;
  end if;
  select total_contado into v_num from public.fn_conteo_diferencias(v_sesion.id) where producto_id = v_p4;
  if v_num is not null then
    raise exception 'TEST FALLÓ: P4 no se contó y debía tener total_contado NULL';
  end if;
  select diferencia, observaciones into v_num, v_obs
    from public.fn_conteo_diferencias(v_sesion.id) where producto_id = v_p5;
  if v_num <> -4 or not ('vencido' = any(v_obs)) then
    raise exception 'TEST FALLÓ: P5 debía dar -4 con observación vencido (dio %, obs %)', v_num, v_obs;
  end if;
  select diferencia into v_num from public.fn_conteo_diferencias(v_sesion.id) where producto_id = v_p6;
  if v_num <> 0 then
    raise exception 'TEST FALLÓ: P6 (ingreso +5 compensado) debía dar 0, dio %', v_num;
  end if;
  raise notice 'OK · diferencias: P2 -7/-7000 relevante, P3 +3, P4 sin contar, P5 -4 (vencido), P6 compensado';

  raise notice '━━ 6 · RECONTEO ━━';
  perform public.fn_solicitar_reconteo(v_sesion.id, array[v_p2], v_emp2);

  -- Con reconteo pendiente no se cierra.
  begin
    perform public.fn_cerrar_sesion_conteo(v_sesion.id, true);
    raise exception 'TEST FALLÓ: se cerró con reconteo pendiente';
  exception when others then
    if sqlerrm like 'TEST FALLÓ%' then raise; end if;
    if sqlerrm not like '%reconteo pendiente%' then raise; end if;
  end;

  -- La misma persona que contó no puede recontar.
  perform pg_temp.como_usuario(v_emp1);
  begin
    perform public.fn_registrar_conteo(v_z1, v_p2, 8, null, true);
    raise exception 'TEST FALLÓ: la misma persona pudo recontar su propio conteo';
  exception when others then
    if sqlerrm like 'TEST FALLÓ%' then raise; end if;
    if sqlerrm not like '%distinta%' then raise; end if;
  end;
  raise notice 'OK · reconteo por el mismo usuario rechazado ✔ (criterio de aceptación)';

  -- Otra persona sí, y sin pedido previo no.
  perform pg_temp.como_usuario(v_emp2);
  begin
    perform public.fn_registrar_conteo(v_z1, v_p3, 13, null, true);
    raise exception 'TEST FALLÓ: se registró un reconteo nunca solicitado';
  exception when others then
    if sqlerrm like 'TEST FALLÓ%' then raise; end if;
    if sqlerrm not like '%no tiene reconteo solicitado%' then raise; end if;
  end;
  perform public.fn_registrar_conteo(v_z1, v_p2, 8, null, true);

  perform pg_temp.como_usuario(v_admin);
  select reconteo_pendiente into v_bool
    from public.fn_conteo_diferencias(v_sesion.id) where producto_id = v_p2;
  if v_bool then
    raise exception 'TEST FALLÓ: el reconteo registrado sigue figurando pendiente';
  end if;
  raise notice 'OK · reconteo registrado por otra persona, ya no está pendiente';

  raise notice '━━ 7 · CIERRE Y AJUSTES ━━';
  -- Sin la confirmación de sincronización de cajas no se cierra.
  begin
    perform public.fn_cerrar_sesion_conteo(v_sesion.id, false);
    raise exception 'TEST FALLÓ: se cerró sin confirmar la sincronización de cajas';
  exception when others then
    if sqlerrm like 'TEST FALLÓ%' then raise; end if;
    if sqlerrm not like '%sincronizadas%' then raise; end if;
  end;
  -- Un empleado no puede cerrar.
  perform pg_temp.como_usuario(v_emp1);
  begin
    perform public.fn_cerrar_sesion_conteo(v_sesion.id, true);
    raise exception 'TEST FALLÓ: un empleado pudo cerrar la sesión';
  exception when others then
    if sqlerrm like 'TEST FALLÓ%' then raise; end if;
    if sqlerrm not like '%permiso%' then raise; end if;
  end;
  raise notice 'OK · cierre exige permiso y checkbox de sincronización';

  perform pg_temp.como_usuario(v_admin);
  v_res := public.fn_cerrar_sesion_conteo(v_sesion.id, true);

  if (v_res->>'productos_ajustados')::integer <> 4 then
    raise exception 'TEST FALLÓ: debían ajustarse 4 productos (P2,P3,P5,P8), resumen: %', v_res;
  end if;
  if (v_res->>'faltante_unidades')::numeric <> 11
     or (v_res->>'faltante_pesos')::numeric <> 7400
     or (v_res->>'sobrante_unidades')::numeric <> 5
     or (v_res->>'sobrante_pesos')::numeric <> 500 then
    raise exception 'TEST FALLÓ: resumen esperado faltante 11u/$7400 sobrante 5u/$500, dio %', v_res;
  end if;
  raise notice 'OK · resumen del cierre: 4 ajustados, faltante 11u/$7400, sobrante 5u/$500';

  execute 'reset role';

  -- Stocks finales.
  select stock_actual into v_num from public.productos where id = v_p1;
  if v_num <> 23 then raise exception 'TEST FALLÓ: P1 debía quedar en 23, quedó %', v_num; end if;
  select stock_actual into v_num from public.productos where id = v_p2;
  if v_num <> 8 then raise exception 'TEST FALLÓ: P2 debía quedar en 8, quedó %', v_num; end if;
  select stock_actual into v_num from public.productos where id = v_p3;
  if v_num <> 13 then raise exception 'TEST FALLÓ: P3 debía quedar en 13, quedó %', v_num; end if;
  select stock_actual into v_num from public.productos where id = v_p4;
  if v_num <> 8 then raise exception 'TEST FALLÓ: P4 (no contado) debía quedar en 8, quedó %', v_num; end if;
  select stock_actual into v_num from public.productos where id = v_p5;
  if v_num <> 0 then raise exception 'TEST FALLÓ: P5 (contado cero) debía quedar en 0, quedó %', v_num; end if;
  select stock_actual into v_num from public.productos where id = v_p6;
  if v_num <> 15 then raise exception 'TEST FALLÓ: P6 debía quedar en 15, quedó %', v_num; end if;
  select stock_actual into v_num from public.productos where id = v_p8;
  if v_num <> 7 then raise exception 'TEST FALLÓ: P8 debía quedar en 7, quedó %', v_num; end if;

  -- FEFO: lote viejo agotado en 0, lote nuevo en 8.
  select cantidad_actual, estado::text into v_num, v_estado from public.lotes where id = v_lote_viejo;
  if v_num <> 0 or v_estado <> 'agotado' then
    raise exception 'TEST FALLÓ: lote viejo debía quedar 0/agotado, quedó %/%', v_num, v_estado;
  end if;
  select cantidad_actual, estado::text into v_num, v_estado from public.lotes where id = v_lote_nuevo;
  if v_num <> 8 or v_estado <> 'activo' then
    raise exception 'TEST FALLÓ: lote nuevo debía quedar 8/activo, quedó %/%', v_num, v_estado;
  end if;
  raise notice 'OK · FEFO: faltante 7 con lotes 5+10 → 0/agotado y 8/activo ✔ (criterio de aceptación)';

  -- Sobrante con lote suma al lote; sin lotes NO crea lote.
  select cantidad_actual into v_num from public.lotes where id = v_lote_p8;
  if v_num <> 7 then
    raise exception 'TEST FALLÓ: el sobrante de P8 debía sumar al lote (esperado 7, quedó %)', v_num;
  end if;
  select count(*) into v_n from public.lotes where producto_id = v_p3;
  if v_n <> 0 then
    raise exception 'TEST FALLÓ: el sobrante de P3 creó un lote y no debía';
  end if;
  raise notice 'OK · sobrante: suma al lote más reciente; sin lotes queda fuera de lotes';

  -- Movimientos de ajuste: 4, tipo ajuste_conteo, referencia a la sesión.
  select count(*) into v_n from public.movimientos_stock
   where tipo = 'ajuste_conteo' and referencia_id = v_sesion.id;
  if v_n <> 4 then
    raise exception 'TEST FALLÓ: debía haber 4 movimientos ajuste_conteo de la sesión, hay %', v_n;
  end if;
  raise notice 'OK · ajustes solo vía movimientos ajuste_conteo con sesion_id ✔ (criterio de aceptación)';

  -- Estado final de la sesión.
  select estado, sync_confirmado, (ts_cierre > ts_apertura) into v_estado, v_bool, v_bool2
    from public.conteo_sesiones where id = v_sesion.id;
  if v_estado <> 'cerrada' or not v_bool or v_bool2 is not true then
    raise exception 'TEST FALLÓ: la sesión debía quedar cerrada con sync confirmado y ts_cierre > ts_apertura';
  end if;
  raise notice 'OK · sesión cerrada, sync_confirmado registrado';

  raise notice '';
  raise notice '✔✔✔ TODOS LOS TESTS PASARON (rollback aplicado)';
end;
$$;

rollback;
