-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  PRUEBA RÁPIDA · Conteo por tareas (migraciones 222 a 228)          ║
-- ║                                                                     ║
-- ║  Versión corta de test_conteo_tareas.sql para pegar en el SQL       ║
-- ║  Editor sin que la recorte (menos de 200 líneas). Cubre el circuito ║
-- ║  entero: alcance → vista previa → abrir con tareas → contar →       ║
-- ║  cobertura → cerrar tarea → diferencias. Termina en ROLLBACK: no    ║
-- ║  deja nada. Correr SIN una sesión de conteo abierta.                ║
-- ║  Si pasa, la última línea de Messages dice "✔✔✔ PRUEBA RÁPIDA OK".  ║
-- ╚════════════════════════════════════════════════════════════════════╝
begin;

create function pg_temp.como_usuario(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end $f$;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_emp1 uuid := gen_random_uuid();
  v_emp2 uuid := gen_random_uuid();
  v_raiz integer; v_s integer; v_g1 integer; v_e1 integer; v_dep integer;
  v_prov integer;
  v_p1 integer; v_p2 integer; v_p3 integer;
  v_sesion public.conteo_sesiones;
  v_a integer; v_g integer; v_libre integer;
  v_res jsonb; v_ids integer[]; v_txt text; v_n integer;
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
    from (values (v_admin, 'test.rapido.admin@test.local'),
                 (v_emp1, 'test.rapido.emp1@test.local'),
                 (v_emp2, 'test.rapido.emp2@test.local')) as u(id, email);
  insert into public.roles (codigo, nombre, es_sistema, permisos)
  values ('test_rapido_staff', 'TEST Staff', false, array['inventario'])
  on conflict (codigo) do update set permisos = excluded.permisos;
  insert into public.usuarios (id, email, nombre, rol, activo) values
    (v_admin, 'test.rapido.admin@test.local', 'TEST Admin', 'admin', true),
    (v_emp1, 'test.rapido.emp1@test.local', 'TEST Emp 1', 'test_rapido_staff', true),
    (v_emp2, 'test.rapido.emp2@test.local', 'TEST Emp 2', 'test_rapido_staff', true)
  on conflict (id) do update set rol = excluded.rol, nombre = excluded.nombre, activo = true;

  -- Mapa: TEST S › TEST G1 › TEST E1 · TEST DEP. Proveedor y 3 productos.
  select id into v_raiz from public.ubicaciones where tipo = 'sucursal' order by id limit 1;
  insert into public.ubicaciones (parent_id, tipo, nombre, orden) values (v_raiz, 'sector', 'TEST S', 900) returning id into v_s;
  insert into public.ubicaciones (parent_id, tipo, nombre, orden) values (v_s, 'gondola', 'TEST G1', 1) returning id into v_g1;
  insert into public.ubicaciones (parent_id, tipo, nombre, orden) values (v_g1, 'estante', 'TEST E1', 1) returning id into v_e1;
  insert into public.ubicaciones (parent_id, tipo, nombre, orden) values (v_s, 'gondola', 'TEST DEP', 2) returning id into v_dep;
  insert into public.proveedores (nombre) values ('TEST Prov') returning id into v_prov;
  insert into public.productos (nombre, precio_venta, stock_actual, stock_minimo, activo, controlar_stock, proveedor_id)
  values ('TEST R P1 en E1', 100, 10, 0, true, true, v_prov) returning id into v_p1;
  insert into public.productos (nombre, precio_venta, stock_actual, stock_minimo, activo, controlar_stock, proveedor_id)
  values ('TEST R P2 en E1 y DEP', 100, 10, 0, true, true, null) returning id into v_p2;
  insert into public.productos (nombre, precio_venta, stock_actual, stock_minimo, activo, controlar_stock, proveedor_id)
  values ('TEST R P3 sin ubicar', 100, 10, 0, true, true, null) returning id into v_p3;
  insert into public.producto_ubicacion (producto_id, ubicacion_id, es_principal, orden) values
    (v_p1, v_e1, true, 1), (v_p2, v_e1, true, 2), (v_p2, v_dep, false, 0);

  raise notice '━━ 1 · ALCANCE Y VISTA PREVIA ━━';
  perform pg_temp.como_usuario(v_admin);
  select array_agg(a.producto_id order by a.orden) into v_ids
    from public.fn_conteo_alcance(jsonb_build_object('proveedor_ids', jsonb_build_array(v_prov))) a;
  if v_ids is distinct from array[v_p1] then
    raise exception 'PRUEBA FALLÓ: el proveedor debía dar solo P1 (dio %)', v_ids;
  end if;
  select array_agg(a.producto_id order by a.orden) into v_ids
    from public.fn_conteo_alcance(jsonb_build_object('ubicacion_ids', jsonb_build_array(v_g1))) a;
  if v_ids is distinct from array[v_p1, v_p2] then
    raise exception 'PRUEBA FALLÓ: el área G1 debía dar P1, P2 (dio %)', v_ids;
  end if;
  v_res := public.fn_conteo_previsualizar_tareas(jsonb_build_array(
    jsonb_build_object('nombre', 'TEST Prov', 'responsables', jsonb_build_array(v_emp1, v_emp2),
      'criterios', jsonb_build_object('proveedor_ids', jsonb_build_array(v_prov))),
    jsonb_build_object('nombre', 'TEST G1', 'responsables', jsonb_build_array(v_emp2),
      'criterios', jsonb_build_object('ubicacion_ids', jsonb_build_array(v_g1)))));
  -- Un solo producto para dos personas: queda una sola parte (la otra no recibe nada).
  if (v_res->'tareas'->0->>'productos')::integer <> 1 or (v_res->'tareas'->0->>'partes')::integer <> 1
     or (v_res->'tareas'->1->>'productos')::integer <> 1 or (v_res->'tareas'->1->>'ya_asignados')::integer <> 1
     or (v_res->'tareas'->1->>'con_otros_lugares')::integer <> 1 then
    raise exception 'PRUEBA FALLÓ: vista previa inesperada: %', v_res;
  end if;
  if exists (select 1 from public.conteo_sesiones where estado <> 'cerrada') then
    raise exception 'PRUEBA FALLÓ: la vista previa dejó una sesión guardada';
  end if;
  raise notice 'OK · alcance por proveedor y por área; vista previa exacta y sin dejar rastros';

  raise notice '━━ 2 · ABRIR, CONTAR Y RECLAMOS ━━';
  select * into v_sesion from public.fn_abrir_sesion_conteo('TEST rápido', 5000, jsonb_build_array(
    jsonb_build_object('nombre', 'TEST Prov', 'responsables', jsonb_build_array(v_emp1),
      'criterios', jsonb_build_object('proveedor_ids', jsonb_build_array(v_prov))),
    jsonb_build_object('nombre', 'TEST G1', 'responsables', jsonb_build_array(v_emp2),
      'criterios', jsonb_build_object('ubicacion_ids', jsonb_build_array(v_g1))),
    jsonb_build_object('nombre', 'TEST Libre', 'responsable_user_id', null)));
  select id into v_a from public.conteo_zonas where sesion_id = v_sesion.id and nombre = 'TEST Prov';
  select id into v_g from public.conteo_zonas where sesion_id = v_sesion.id and nombre = 'TEST G1';
  select id into v_libre from public.conteo_zonas where sesion_id = v_sesion.id and nombre = 'TEST Libre';
  select string_agg(zp.producto_id::text, ',' order by zp.orden) into v_txt
    from public.conteo_zona_productos zp where zp.zona_id = v_g;
  if v_txt <> v_p2::text then
    raise exception 'PRUEBA FALLÓ: a G1 le debía quedar solo P2 (P1 es de la lista), quedó %', v_txt;
  end if;

  execute 'set local role authenticated';
  perform pg_temp.como_usuario(v_emp1);
  perform public.fn_iniciar_zona(v_a);
  perform public.fn_registrar_conteo(v_a, v_p1, 7);
  begin
    perform public.fn_registrar_conteo(v_a, v_p2, 1);
    raise exception 'PRUEBA FALLÓ: la lista aceptó un producto que no es suyo';
  exception when others then
    if sqlerrm like 'PRUEBA FALLÓ%' then raise; end if;
    if sqlerrm not like '%no está en la lista%' then raise; end if;
  end;
  perform pg_temp.como_usuario(v_emp2);
  perform public.fn_iniciar_zona(v_g);
  perform public.fn_registrar_conteo(v_g, v_p2, 4);
  begin
    perform public.fn_registrar_conteo(v_g, v_p1, 1);
    raise exception 'PRUEBA FALLÓ: el área aceptó un producto de una lista';
  exception when others then
    if sqlerrm like 'PRUEBA FALLÓ%' then raise; end if;
    if sqlerrm not like '%se cuenta en la tarea%' then raise; end if;
  end;
  perform public.fn_registrar_conteo(v_g, v_p3, 2);  -- suelto, encontrado en la góndola
  raise notice 'OK · la base hace cumplir el alcance; lo encontrado en el lugar se carga';

  raise notice '━━ 3 · AVANCE, COBERTURA Y MAPA ━━';
  perform pg_temp.como_usuario(v_admin);
  select a.en_lista * 100 + a.contados * 10 + a.contados_lista into v_n
    from public.fn_conteo_avance(v_sesion.id) a where a.zona_id = v_g;
  if v_n <> 121 then
    raise exception 'PRUEBA FALLÓ: avance de G1 esperado 1/2/1, dio %', v_n;
  end if;
  select string_agg(c.producto_id || ':' || c.ubicacion || ':' || c.motivo, ',') into v_txt
    from public.fn_conteo_cobertura(v_sesion.id) c;
  if v_txt is distinct from v_p2 || ':TEST S › TEST DEP:sin_tarea' then
    raise exception 'PRUEBA FALLÓ: P2 debía figurar a medias (falta el depósito), dio %', v_txt;
  end if;
  perform public.fn_reasignar_tarea_conteo(v_libre, v_emp1);
  v_res := public.fn_agregar_tareas_conteo(v_sesion.id, jsonb_build_array(
    jsonb_build_object('nombre', 'TEST DEP', 'criterios', jsonb_build_object('ubicacion_ids', jsonb_build_array(v_dep)))));
  if (v_res->0->>'productos')::integer <> 1 then
    raise exception 'PRUEBA FALLÓ: la tarea del depósito debía traer solo P2, dio %', v_res;
  end if;
  select count(*) into v_n from public.fn_conteo_cobertura(v_sesion.id);
  if v_n <> 0 then
    raise exception 'PRUEBA FALLÓ: con el depósito en una tarea abierta no debía avisar, avisó %', v_n;
  end if;
  perform pg_temp.como_usuario(v_emp2);
  perform public.fn_cerrar_zona(v_g);
  perform pg_temp.como_usuario(v_admin);
  select count(*) into v_n from public.producto_ubicacion where producto_id = v_p2;
  if v_n <> 2 then
    raise exception 'PRUEBA FALLÓ: cerrar la tarea duplicó ubicaciones de P2 (tiene %)', v_n;
  end if;
  if not exists (select 1 from public.producto_ubicacion where producto_id = v_p3 and ubicacion_id = v_g1 and es_principal) then
    raise exception 'PRUEBA FALLÓ: P3 apareció en G1 y debía quedar ubicado ahí';
  end if;
  select d.total_contado into v_n from public.fn_conteo_diferencias(v_sesion.id) d where d.producto_id = v_p1;
  if v_n <> 7 then
    raise exception 'PRUEBA FALLÓ: P1 debía tener 7 contados, dio %', v_n;
  end if;
  raise notice 'OK · avance, aviso de conteo a medias, agregar tarea, mapa sin duplicados, diferencias';

  execute 'reset role';
  raise notice '';
  raise notice '✔✔✔ PRUEBA RÁPIDA OK (rollback aplicado)';
end;
$$;

rollback;
