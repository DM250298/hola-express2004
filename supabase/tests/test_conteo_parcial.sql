-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  PRUEBA · Conteo parcial y cíclico (migraciones 306 a 309)          ║
-- ║                                                                     ║
-- ║  Cubre: último conteo cerrado por producto → ventana en días →      ║
-- ║  tope de productos (los primeros del recorrido) → abrir con una     ║
-- ║  tarea parcial → qué falta (fn_conteo_pendientes) → una sesión      ║
-- ║  abierta NO cuenta como contado → tope por tarea con dos personas → ║
-- ║  tarea que queda vacía por la ventana. Termina en ROLLBACK: no deja ║
-- ║  nada. Correr SIN una sesión de conteo abierta. Si pasa, la última  ║
-- ║  línea de Messages dice "✔✔✔ CONTEO PARCIAL OK".                    ║
-- ╚════════════════════════════════════════════════════════════════════╝
begin;

create function pg_temp.como_usuario(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end $f$;

create function pg_temp.lista(p_zona integer) returns text language sql as $f$
  select coalesce(array_agg(zp.producto_id order by zp.orden), '{}')::text
    from public.conteo_zona_productos zp where zp.zona_id = p_zona
$f$;

-- productos/ya_contados/pendientes/limitado/en_criterio/ya_asignados/partes/por_parte
create function pg_temp.resumen(t jsonb) returns text language sql as $f$
  select concat_ws('/', t->>'productos', t->>'ya_contados', t->>'pendientes', t->>'limitado',
                   t->>'en_criterio', t->>'ya_asignados', t->>'partes', t->'por_parte')
$f$;

-- Vista previa de UNA tarea, resumida.
create function pg_temp.vp(p_tarea jsonb) returns text language sql as $f$
  select pg_temp.resumen(public.fn_conteo_previsualizar_tareas(jsonb_build_array(p_tarea))->'tareas'->0)
$f$;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_emp1 uuid := gen_random_uuid();
  v_emp2 uuid := gen_random_uuid();
  v_ma integer; v_mb integer;
  v_p integer[] := '{}';
  v_i integer; v_n integer;
  v_s1 integer; v_s2 integer; v_z integer;
  v_sesion public.conteo_sesiones;
  v_zona integer;
  v_crit_a constant jsonb := '{"clases_abc":["A"]}';
  v_txt text;
begin
  if exists (select 1 from public.conteo_sesiones where estado <> 'cerrada') then
    raise exception 'PRUEBA FALLÓ: hay una sesión de conteo abierta. Cerrala y volvé a correr.';
  end if;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
    updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
         u.email, 'x', now(), '{"provider":"email","providers":["email"]}', '{}',
         now(), now(), '', '', '', ''
    from (values (v_admin, 'test.parcial.admin@test.local'),
                 (v_emp1, 'test.parcial.emp1@test.local'),
                 (v_emp2, 'test.parcial.emp2@test.local')) as u(id, email);
  insert into public.roles (codigo, nombre, es_sistema, permisos)
  values ('test_parcial_staff', 'TEST Staff', false, array['inventario'])
  on conflict (codigo) do update set permisos = excluded.permisos;
  insert into public.usuarios (id, email, nombre, rol, activo) values
    (v_admin, 'test.parcial.admin@test.local', 'TEST Admin', 'admin', true),
    (v_emp1, 'test.parcial.emp1@test.local', 'TEST Emp 1', 'test_parcial_staff', true),
    (v_emp2, 'test.parcial.emp2@test.local', 'TEST Emp 2', 'test_parcial_staff', true)
  on conflict (id) do update set rol = excluded.rol, nombre = excluded.nombre, activo = true;

  -- 10 productos clase A sin ubicar (recorrido = por nombre: P01 … P10).
  -- P01 a P03 llevan la marca B para poder pedirlos solos.
  insert into public.marcas (nombre) values ('TEST Parcial A') returning id into v_ma;
  insert into public.marcas (nombre) values ('TEST Parcial B') returning id into v_mb;
  for v_i in 1..10 loop
    insert into public.productos (nombre, precio_venta, stock_actual, stock_minimo, activo, controlar_stock, marca_id)
    values ('TEST C P' || lpad(v_i::text, 2, '0'), 100, 10, 0, true, true,
            case when v_i <= 3 then v_mb else v_ma end)
    returning id into v_n;
    v_p := v_p || v_n;
  end loop;
  insert into public.metricas_sku_diarias (fecha, producto_id, clase_abc)
  select current_date + 3650, p, 'A' from unnest(v_p) p;

  -- Sesiones cerradas de antes: S1 hace 5 días (P01, P02, P03) y S2 hace 60 (P04).
  insert into public.conteo_sesiones (nombre, estado, abierta_por, cerrada_por, ts_apertura, ts_cierre)
  values ('TEST S1', 'cerrada', v_admin, v_admin, now() - interval '5 days 2 hours', now() - interval '5 days')
  returning id into v_s1;
  insert into public.conteo_zonas (sesion_id, nombre, responsable_user_id, estado, tipo, criterios)
  values (v_s1, 'TEST Z1', v_emp1, 'cerrada', 'lista', v_crit_a) returning id into v_z;
  insert into public.conteo_detalle (zona_id, producto_id, cantidad_contada, contado_por)
  select v_z, p, 10, v_emp1 from unnest(v_p[1:3]) p;
  insert into public.conteo_sesiones (nombre, estado, abierta_por, cerrada_por, ts_apertura, ts_cierre)
  values ('TEST S2', 'cerrada', v_admin, v_admin, now() - interval '60 days 2 hours', now() - interval '60 days')
  returning id into v_s2;
  insert into public.conteo_zonas (sesion_id, nombre, responsable_user_id, estado, tipo, criterios)
  values (v_s2, 'TEST Z2', v_emp1, 'cerrada', 'lista', v_crit_a) returning id into v_z;
  insert into public.conteo_detalle (zona_id, producto_id, cantidad_contada, contado_por)
  values (v_z, v_p[4], 10, v_emp1);

  raise notice '━━ 1 · ÚLTIMO CONTEO, VENTANA Y TOPE (vista previa) ━━';
  perform pg_temp.como_usuario(v_admin);
  select string_agg(u.producto_id || ':' || u.sesion_id, ',' order by u.producto_id) into v_txt
    from public.fn_conteo_ultimos() u where u.producto_id = any(v_p);
  if v_txt <> format('%s:%s,%s:%s,%s:%s,%s:%s', v_p[1], v_s1, v_p[2], v_s1, v_p[3], v_s1, v_p[4], v_s2) then
    raise exception 'PRUEBA FALLÓ: último conteo esperado P01-P03 en S1 y P04 en S2, dio %', v_txt;
  end if;
  v_txt := pg_temp.vp(jsonb_build_object('nombre', 'A 30', 'criterios', v_crit_a, 'sin_contar_dias', 30));
  if v_txt <> '7/3/7/false/10/0/1/[7]' then
    raise exception 'PRUEBA FALLÓ: ventana 30 días esperaba 7/3/7/false/10/0/1/[7], dio %', v_txt;
  end if;
  v_txt := pg_temp.vp(jsonb_build_object('nombre', 'A 90', 'criterios', v_crit_a, 'sin_contar_dias', 90));
  if v_txt <> '6/4/6/false/10/0/1/[6]' then
    raise exception 'PRUEBA FALLÓ: ventana 90 días esperaba 6/4/6/false/10/0/1/[6], dio %', v_txt;
  end if;
  v_txt := pg_temp.vp(jsonb_build_object('nombre', 'A todo', 'criterios', v_crit_a));
  if v_txt <> '10/0/10/false/10/0/1/[10]' then
    raise exception 'PRUEBA FALLÓ: sin ventana esperaba 10/0/10/false/10/0/1/[10], dio %', v_txt;
  end if;
  v_txt := pg_temp.vp(jsonb_build_object('nombre', 'A 2', 'criterios', v_crit_a, 'sin_contar_dias', 30, 'cantidad_max', 2));
  if v_txt <> '2/3/7/true/10/0/1/[2]' then
    raise exception 'PRUEBA FALLÓ: tope 2 esperaba 2/3/7/true/10/0/1/[2], dio %', v_txt;
  end if;
  if exists (select 1 from public.conteo_sesiones where estado <> 'cerrada') then
    raise exception 'PRUEBA FALLÓ: la vista previa dejó una sesión guardada';
  end if;
  raise notice 'OK · último conteo cerrado; la ventana saltea lo reciente y la vieja vuelve; el tope recorta';

  raise notice '━━ 2 · ABRIR CON TAREA PARCIAL Y QUÉ FALTA ━━';
  select * into v_sesion from public.fn_abrir_sesion_conteo('TEST parcial', 5000, jsonb_build_array(
    jsonb_build_object('nombre', 'TEST A parcial', 'responsables', jsonb_build_array(v_emp1),
      'criterios', v_crit_a, 'cantidad_max', 2, 'sin_contar_dias', 30)));
  select id, cantidad_max * 1000 + sin_contar_dias into v_zona, v_n
    from public.conteo_zonas where sesion_id = v_sesion.id;
  if pg_temp.lista(v_zona) <> format('{%s,%s}', v_p[4], v_p[5]) or v_n <> 2030 then
    raise exception 'PRUEBA FALLÓ: la tarea debía llevar P04 y P05 (2/30), quedó % con %', pg_temp.lista(v_zona), v_n;
  end if;
  -- C = contado en la ventana, T = en tarea abierta, U = tiene último conteo.
  select string_agg(case when p.contado_en_ventana then 'C' else '' end
                    || case when p.en_tarea_abierta then 'T' else '' end
                    || case when p.ultimo_ts is not null then 'U' else '' end, ',' order by p.orden) into v_txt
    from public.fn_conteo_pendientes(v_crit_a, 30) p;
  if v_txt <> 'CU,CU,CU,TU,T,,,,,' then
    raise exception 'PRUEBA FALLÓ: pendientes esperaba CU,CU,CU,TU,T,,,,, y dio %', v_txt;
  end if;
  raise notice 'OK · la tarea toma los primeros pendientes del recorrido; qué falta distingue contado, en curso y viejo';

  raise notice '━━ 3 · LA SESIÓN ABIERTA NO CUENTA; TOPE POR TAREA; TAREA VACÍA ━━';
  execute 'set local role authenticated';
  perform pg_temp.como_usuario(v_emp1);
  perform public.fn_iniciar_zona(v_zona);
  perform public.fn_registrar_conteo(v_zona, v_p[4], 3);
  perform pg_temp.como_usuario(v_admin);
  select count(*) filter (where p.contado_en_ventana) into v_n from public.fn_conteo_pendientes(v_crit_a, 30) p;
  if v_n <> 3 then
    raise exception 'PRUEBA FALLÓ: contar en una sesión abierta no debía sumar contados (dio %)', v_n;
  end if;
  v_txt := pg_temp.vp(jsonb_build_object('nombre', 'A 4 x2', 'responsables', jsonb_build_array(v_emp1, v_emp2),
    'criterios', v_crit_a, 'sin_contar_dias', 30, 'cantidad_max', 4));
  if v_txt <> '4/3/5/true/10/2/2/[2, 2]' then
    raise exception 'PRUEBA FALLÓ: tope 4 entre dos esperaba 4/3/5/true/10/2/2/[2, 2], dio %', v_txt;
  end if;
  v_txt := pg_temp.vp(jsonb_build_object('nombre', 'B 30', 'criterios', jsonb_build_object('marca_ids', jsonb_build_array(v_mb)),
    'sin_contar_dias', 30));
  if v_txt <> '0/3/0/false/3/0/0/[]' then
    raise exception 'PRUEBA FALLÓ: la marca B ya contada esperaba 0/3/0/false/3/0/0/[], dio %', v_txt;
  end if;
  begin
    perform public.fn_agregar_tareas_conteo(v_sesion.id, jsonb_build_array(
      jsonb_build_object('nombre', 'B 30', 'criterios', jsonb_build_object('marca_ids', jsonb_build_array(v_mb)),
        'sin_contar_dias', 30)));
    raise exception 'PRUEBA FALLÓ: una tarea vacía por la ventana tenía que rechazarse';
  exception when others then
    if sqlerrm like 'PRUEBA FALLÓ%' then raise; end if;
    if sqlerrm not like '%ya se contaron en los últimos 30 días%' then raise; end if;
  end;
  raise notice 'OK · lo contado en la sesión abierta sigue pendiente; el tope es de la tarea; la tarea vacía avisa por qué';

  execute 'reset role';
  raise notice '';
  raise notice '✔✔✔ CONTEO PARCIAL OK (rollback aplicado)';
end;
$$;

rollback;
