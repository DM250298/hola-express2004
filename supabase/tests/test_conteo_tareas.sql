-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  TEST · Conteo físico: tareas con alcance (migraciones 222 a 228)   ║
-- ║                                                                     ║
-- ║  Correr COMPLETO en el SQL Editor de Supabase, DESPUÉS de aplicar   ║
-- ║  las migraciones 222 a 228 y SIN una sesión de conteo abierta (la   ║
-- ║  prueba abre la suya). Todo corre dentro de una transacción que     ║
-- ║  termina en ROLLBACK: no deja usuarios, productos ni sesiones.      ║
-- ║                                                                     ║
-- ║  Si algo falla, corta con "TEST FALLÓ: ..." y el rollback es        ║
-- ║  automático. Si pasa todo, la última línea de Messages dice         ║
-- ║  "✔✔✔ TODOS LOS TESTS PASARON (rollback aplicado)".                 ║
-- ║                                                                     ║
-- ║  Qué verifica:                                                      ║
-- ║   1. Alcance por cada criterio (área, proveedor, clase, categoría,  ║
-- ║      marca, alerta, sin ubicar) y combinados; quedan afuera combos, ║
-- ║      productos sin control de stock y ramas inactivas del mapa.     ║
-- ║   2. Vista previa: mismos números que la creación y no deja nada.   ║
-- ║   3. Reparto entre personas en tramos seguidos, sin partir estantes.║
-- ║   4. Reclamos: lo de una lista no entra en un área; dos áreas       ║
-- ║      comparten producto solo en lugares distintos (áreas anidadas). ║
-- ║   5. La base hace cumplir el alcance al registrar (sin doble carga).║
-- ║   6. Avance, reasignar, quitar, agregar tareas y reabrir la sesión. ║
-- ║   7. Cobertura: lo contado a medias y por qué.                      ║
-- ║   8. Cerrar una tarea anclada no duplica ubicaciones en el mapa.    ║
-- ║   9. El payload viejo (zona libre) y las diferencias siguen igual.  ║
-- ╚════════════════════════════════════════════════════════════════════╝

begin;

create function pg_temp.como_usuario(p_uid uuid) returns void
language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end $f$;

-- Ids de una lista, en su orden, como texto: '{3,1,2}'.
create function pg_temp.lista(p_zona integer) returns text
language sql as $f$
  select coalesce(array_agg(zp.producto_id order by zp.orden), '{}')::text
    from public.conteo_zona_productos zp where zp.zona_id = p_zona
$f$;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_emp1  uuid := gen_random_uuid();
  v_emp2  uuid := gen_random_uuid();
  v_emp3  uuid := gen_random_uuid();
  v_emp4  uuid := gen_random_uuid();
  v_raiz integer; v_s integer; v_g1 integer; v_e1 integer; v_e2 integer; v_dep integer;
  v_gi integer; v_ei integer; v_s2 integer; v_g2 integer; v_x integer; v_y integer; v_z integer;
  v_prov_a integer; v_prov_b integer; v_prov_c integer; v_cat integer; v_marca integer;
  v_p1 integer; v_p2 integer; v_p3 integer; v_p4 integer; v_p5 integer;
  v_p6 integer; v_p7 integer; v_p8 integer; v_p9 integer; v_p10 integer;
  v_q integer[] := '{}';
  v_sesion public.conteo_sesiones;
  v_a1 integer; v_a2 integer; v_ga integer; v_gb integer; v_libre integer; v_d integer; v_c integer;
  v_zonas jsonb;
  v_res jsonb;
  v_ids integer[];
  v_txt text;
  v_n integer;
  v_regla text;
  v_fecha date := current_date + 3650;  -- snapshot "más nuevo": el de la prueba
  i integer;
begin
  raise notice '━━ SETUP ━━';
  if exists (select 1 from public.conteo_sesiones where estado <> 'cerrada') then
    raise exception 'TEST FALLÓ: hay una sesión de conteo abierta. Cerrala y volvé a correr la prueba.';
  end if;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
    updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
         u.email, 'x', now(), '{"provider":"email","providers":["email"]}', '{}',
         now(), now(), '', '', '', ''
    from (values (v_admin, 'test.tareas.admin@test.local'),
                 (v_emp1,  'test.tareas.emp1@test.local'),
                 (v_emp2,  'test.tareas.emp2@test.local'),
                 (v_emp3,  'test.tareas.emp3@test.local'),
                 (v_emp4,  'test.tareas.emp4@test.local')) as u(id, email);

  insert into public.roles (codigo, nombre, es_sistema, permisos)
  values ('test_tareas_staff', 'TEST Staff Tareas', false, array['inventario'])
  on conflict (codigo) do update set permisos = excluded.permisos;

  insert into public.usuarios (id, email, nombre, rol, activo) values
    (v_admin, 'test.tareas.admin@test.local', 'TEST Admin', 'admin', true),
    (v_emp1,  'test.tareas.emp1@test.local',  'TEST Emp 1', 'test_tareas_staff', true),
    (v_emp2,  'test.tareas.emp2@test.local',  'TEST Emp 2', 'test_tareas_staff', true),
    (v_emp3,  'test.tareas.emp3@test.local',  'TEST Emp 3', 'test_tareas_staff', true),
    (v_emp4,  'test.tareas.emp4@test.local',  'TEST Emp 4', 'test_tareas_staff', true)
  on conflict (id) do update
    set rol = excluded.rol, nombre = excluded.nombre, activo = true;

  -- Mapa de prueba:
  --   TEST S  › TEST G1 › (E1, E2) · TEST DEP · TEST GI (inactiva) › TEST EI
  --   TEST S2 › TEST G2 › (X, Y, Z)
  select id into v_raiz from public.ubicaciones where tipo = 'sucursal' order by id limit 1;
  insert into public.ubicaciones (parent_id, tipo, nombre, orden)
  values (v_raiz, 'sector', 'TEST S', 900) returning id into v_s;
  insert into public.ubicaciones (parent_id, tipo, nombre, orden)
  values (v_s, 'gondola', 'TEST G1', 1) returning id into v_g1;
  insert into public.ubicaciones (parent_id, tipo, nombre, orden)
  values (v_g1, 'estante', 'TEST E1', 1) returning id into v_e1;
  insert into public.ubicaciones (parent_id, tipo, nombre, orden)
  values (v_g1, 'estante', 'TEST E2', 2) returning id into v_e2;
  insert into public.ubicaciones (parent_id, tipo, nombre, orden)
  values (v_s, 'gondola', 'TEST DEP', 2) returning id into v_dep;
  insert into public.ubicaciones (parent_id, tipo, nombre, orden, activo)
  values (v_s, 'gondola', 'TEST GI', 3, false) returning id into v_gi;
  insert into public.ubicaciones (parent_id, tipo, nombre, orden)
  values (v_gi, 'estante', 'TEST EI', 1) returning id into v_ei;
  insert into public.ubicaciones (parent_id, tipo, nombre, orden)
  values (v_raiz, 'sector', 'TEST S2', 901) returning id into v_s2;
  insert into public.ubicaciones (parent_id, tipo, nombre, orden)
  values (v_s2, 'gondola', 'TEST G2', 1) returning id into v_g2;
  insert into public.ubicaciones (parent_id, tipo, nombre, orden)
  values (v_g2, 'estante', 'TEST X', 1) returning id into v_x;
  insert into public.ubicaciones (parent_id, tipo, nombre, orden)
  values (v_g2, 'estante', 'TEST Y', 2) returning id into v_y;
  insert into public.ubicaciones (parent_id, tipo, nombre, orden)
  values (v_g2, 'estante', 'TEST Z', 3) returning id into v_z;

  insert into public.proveedores (nombre) values ('TEST Prov A') returning id into v_prov_a;
  insert into public.proveedores (nombre) values ('TEST Prov B') returning id into v_prov_b;
  insert into public.proveedores (nombre) values ('TEST Prov C') returning id into v_prov_c;
  insert into public.categorias (nombre) values ('TEST Categoría') returning id into v_cat;
  insert into public.marcas (nombre) values ('TEST Marca') returning id into v_marca;

  insert into public.productos (nombre, precio_venta, stock_actual, stock_minimo, activo, controlar_stock, proveedor_id)
  values ('TEST T P01 prov A en E1', 100, 10, 0, true, true, v_prov_a) returning id into v_p1;
  insert into public.productos (nombre, precio_venta, stock_actual, stock_minimo, activo, controlar_stock, proveedor_id)
  values ('TEST T P02 prov A en E2 y DEP', 100, 10, 0, true, true, v_prov_a) returning id into v_p2;
  insert into public.productos (nombre, precio_venta, stock_actual, stock_minimo, activo, controlar_stock, proveedor_id)
  values ('TEST T P03 prov B en E2 y en rama inactiva', 100, 10, 0, true, true, v_prov_b) returning id into v_p3;
  insert into public.productos (nombre, precio_venta, stock_actual, stock_minimo, activo, controlar_stock, proveedor_id)
  values ('TEST T P04 prov A por catálogo sin ubicar', 100, 10, 0, true, true, null) returning id into v_p4;
  insert into public.productos (nombre, precio_venta, stock_actual, stock_minimo, activo, controlar_stock, proveedor_id, categoria_id, marca_id)
  values ('TEST T P05 en DEP con categoría y marca', 100, 10, 0, true, true, v_prov_b, v_cat, v_marca) returning id into v_p5;
  insert into public.productos (nombre, precio_venta, stock_actual, stock_minimo, activo, controlar_stock, proveedor_id)
  values ('TEST T P06 combo', 100, 0, 0, true, true, v_prov_a) returning id into v_p6;
  insert into public.productos (nombre, precio_venta, stock_actual, stock_minimo, activo, controlar_stock, proveedor_id)
  values ('TEST T P07 sin control', 100, 10, 0, true, false, v_prov_a) returning id into v_p7;
  insert into public.productos (nombre, precio_venta, stock_actual, stock_minimo, activo, controlar_stock, proveedor_id)
  values ('TEST T P08 con alerta en E1', 100, 10, 0, true, true, v_prov_b) returning id into v_p8;
  insert into public.productos (nombre, precio_venta, stock_actual, stock_minimo, activo, controlar_stock, proveedor_id)
  values ('TEST T P09 prov B en E1 y DEP', 100, 10, 0, true, true, v_prov_b) returning id into v_p9;
  insert into public.productos (nombre, precio_venta, stock_actual, stock_minimo, activo, controlar_stock, proveedor_id)
  values ('TEST T P10 prov B sin ubicar', 100, 10, 0, true, true, v_prov_b) returning id into v_p10;
  -- Seis productos del proveedor C, de a dos por estante de G2 (para el reparto).
  for i in 1..6 loop
    insert into public.productos (nombre, precio_venta, stock_actual, stock_minimo, activo, controlar_stock, proveedor_id)
    values ('TEST T Q' || i || ' prov C', 100, 10, 0, true, true, v_prov_c) returning id into v_n;
    v_q := v_q || v_n;
    insert into public.producto_ubicacion (producto_id, ubicacion_id, es_principal, orden)
    values (v_n, (array[v_x, v_x, v_y, v_y, v_z, v_z])[i], true, i);
  end loop;

  insert into public.proveedor_producto (proveedor_id, producto_id) values (v_prov_a, v_p4);
  insert into public.producto_componentes (producto_id, componente_id, cantidad) values (v_p6, v_p1, 2);

  insert into public.producto_ubicacion (producto_id, ubicacion_id, es_principal, orden) values
    (v_p1, v_e1, true, 1), (v_p8, v_e1, true, 2), (v_p9, v_e1, true, 3),
    (v_p2, v_e2, true, 1), (v_p3, v_e2, true, 2),
    (v_p2, v_dep, false, 0), (v_p9, v_dep, false, 0), (v_p5, v_dep, true, 0),
    (v_p3, v_ei, false, 0);

  insert into public.metricas_sku_diarias (fecha, producto_id, clase_abc) values
    (v_fecha, v_p1, 'A'), (v_fecha, v_p2, 'A'), (v_fecha, v_p3, 'B');

  insert into public.alertas (regla_codigo, severidad, dedupe_key, entidad_tipo, entidad_id, producto_id, titulo)
  select r.codigo, 'atencion', 'test-tareas-' || v_p8, 'producto', v_p8, v_p8, 'TEST alerta'
    from public.reglas_alerta r order by (r.codigo = 'stock_desfasado') desc, r.codigo limit 1
  returning regla_codigo into v_regla;

  raise notice '━━ 1 · ALCANCE ━━';
  perform pg_temp.como_usuario(v_admin);

  if public.fn_jsonb_enteros('[1, "2", null, "x", 1.5, "3", 2]'::jsonb) <> array[1, 2, 3]
     or public.fn_jsonb_enteros('"7"'::jsonb) <> '{}'::integer[] then
    raise exception 'TEST FALLÓ: fn_jsonb_enteros debía quedarse solo con los enteros';
  end if;

  select array_agg(a.producto_id order by a.orden) into v_ids
    from public.fn_conteo_alcance(jsonb_build_object('proveedor_ids', jsonb_build_array(v_prov_a))) a;
  if v_ids is distinct from array[v_p1, v_p2, v_p4] then
    raise exception 'TEST FALLÓ: proveedor A debía dar P1, P2, P4 en ese orden (sin combo ni sin-control), dio %', v_ids;
  end if;
  raise notice 'OK · por proveedor (incluye el catálogo N:M, excluye combo y sin control de stock)';

  select array_agg(a.producto_id order by a.orden) into v_ids
    from public.fn_conteo_alcance(jsonb_build_object('ubicacion_ids', jsonb_build_array(v_g1))) a;
  if v_ids is distinct from array[v_p1, v_p8, v_p9, v_p2, v_p3] then
    raise exception 'TEST FALLÓ: el área G1 debía dar P1, P8, P9, P2, P3 (recorrido E1 → E2), dio %', v_ids;
  end if;
  select a.donde || ' | ' || coalesce(a.otros, '-') into v_txt
    from public.fn_conteo_alcance(jsonb_build_object('ubicacion_ids', jsonb_build_array(v_g1))) a
   where a.producto_id = v_p2;
  if v_txt is distinct from 'TEST S › TEST G1 › TEST E2 | TEST S › TEST DEP' then
    raise exception 'TEST FALLÓ: en G1, P2 debía figurar en E2 y avisar que también vive en DEP, dio "%"', v_txt;
  end if;
  select coalesce(a.otros, '-') into v_txt
    from public.fn_conteo_alcance(jsonb_build_object('ubicacion_ids', jsonb_build_array(v_g1))) a
   where a.producto_id = v_p3;
  if v_txt <> '-' then
    raise exception 'TEST FALLÓ: la ubicación de P3 en una rama inactiva no debía contar, dio "%"', v_txt;
  end if;
  select count(*) into v_n
    from public.fn_conteo_alcance(jsonb_build_object('ubicacion_ids', jsonb_build_array(v_gi)));
  if v_n <> 0 then
    raise exception 'TEST FALLÓ: un área inactiva no debía traer productos (trajo %)', v_n;
  end if;
  raise notice 'OK · por área: recorrido, lugares de adentro, aviso de "también vive en" y ramas inactivas afuera';

  select array_agg(a.producto_id order by a.orden) into v_ids
    from public.fn_conteo_alcance(jsonb_build_object(
      'clases_abc', jsonb_build_array('a'), 'proveedor_ids', jsonb_build_array(v_prov_a))) a;
  if v_ids is distinct from array[v_p1, v_p2] then
    raise exception 'TEST FALLÓ: clase A ∩ proveedor A debía dar P1, P2, dio %', v_ids;
  end if;
  select array_agg(a.producto_id order by a.orden) into v_ids
    from public.fn_conteo_alcance(jsonb_build_object(
      'clases_abc', jsonb_build_array('N'), 'proveedor_ids', jsonb_build_array(v_prov_a))) a;
  if v_ids is distinct from array[v_p4] then
    raise exception 'TEST FALLÓ: sin ventas ∩ proveedor A debía dar P4, dio %', v_ids;
  end if;
  select array_agg(a.producto_id order by a.orden) into v_ids
    from public.fn_conteo_alcance(jsonb_build_object('categoria_ids', jsonb_build_array(v_cat))) a;
  if v_ids is distinct from array[v_p5] then
    raise exception 'TEST FALLÓ: la categoría debía dar P5, dio %', v_ids;
  end if;
  select array_agg(a.producto_id order by a.orden) into v_ids
    from public.fn_conteo_alcance(jsonb_build_object('marca_ids', jsonb_build_array(v_marca))) a;
  if v_ids is distinct from array[v_p5] then
    raise exception 'TEST FALLÓ: la marca debía dar P5, dio %', v_ids;
  end if;
  select array_agg(a.producto_id order by a.orden) into v_ids
    from public.fn_conteo_alcance(jsonb_build_object(
      'reglas_alerta', jsonb_build_array(v_regla),
      'ubicacion_ids', jsonb_build_array(v_s))) a;
  if v_ids is distinct from array[v_p8] then
    raise exception 'TEST FALLÓ: alerta viva ∩ sector debía dar P8, dio %', v_ids;
  end if;
  select array_agg(a.producto_id order by a.orden) into v_ids
    from public.fn_conteo_alcance(jsonb_build_object(
      'ubicacion_ids', jsonb_build_array(v_e2), 'proveedor_ids', jsonb_build_array(v_prov_b))) a;
  if v_ids is distinct from array[v_p3] then
    raise exception 'TEST FALLÓ: E2 ∩ proveedor B debía dar P3, dio %', v_ids;
  end if;
  select array_agg(a.producto_id order by a.orden) into v_ids
    from public.fn_conteo_alcance(jsonb_build_object(
      'sin_ubicar', true, 'proveedor_ids', jsonb_build_array(v_prov_b))) a;
  if v_ids is distinct from array[v_p10] then
    raise exception 'TEST FALLÓ: sin ubicar ∩ proveedor B debía dar P10, dio %', v_ids;
  end if;
  raise notice 'OK · clase ABC, sin ventas, categoría, marca, alerta, sin ubicar y combinados';

  begin
    perform * from public.fn_conteo_alcance('{}'::jsonb);
    raise exception 'TEST FALLÓ: fn_conteo_alcance aceptó un criterio vacío';
  exception when others then
    if sqlerrm like 'TEST FALLÓ%' then raise; end if;
    if sqlerrm not like '%al menos un criterio%' then raise; end if;
  end;
  perform pg_temp.como_usuario(v_emp1);
  begin
    perform * from public.fn_conteo_alcance(jsonb_build_object('proveedor_ids', jsonb_build_array(v_prov_a)));
    raise exception 'TEST FALLÓ: un empleado pudo armar un alcance';
  exception when others then
    if sqlerrm like 'TEST FALLÓ%' then raise; end if;
    if sqlerrm not like '%permiso%' then raise; end if;
  end;
  begin
    perform public.fn_conteo_previsualizar_tareas('[]'::jsonb);
    raise exception 'TEST FALLÓ: un empleado pudo pedir una vista previa';
  exception when others then
    if sqlerrm like 'TEST FALLÓ%' then raise; end if;
    if sqlerrm not like '%permiso%' then raise; end if;
  end;
  raise notice 'OK · criterio vacío y empleado sin permiso rechazados';

  raise notice '━━ 2 · VISTA PREVIA Y REPARTO ━━';
  perform pg_temp.como_usuario(v_admin);
  -- 6 productos de a 2 por estante entre 2 personas: por cantidad sería 3 + 3
  -- y partiría el estante del medio. Tiene que dar 4 + 2.
  v_res := public.fn_conteo_previsualizar_tareas(jsonb_build_array(
    jsonb_build_object('nombre', 'TEST C', 'responsables', jsonb_build_array(v_emp1, v_emp2),
      'criterios', jsonb_build_object('proveedor_ids', jsonb_build_array(v_prov_c)))));
  if v_res->'tareas'->0->'por_parte' is distinct from '[4, 2]'::jsonb then
    raise exception 'TEST FALLÓ: el reparto entre 2 debía dar [4, 2] sin partir un estante, dio %', v_res->'tareas'->0;
  end if;
  v_res := public.fn_conteo_previsualizar_tareas(jsonb_build_array(
    jsonb_build_object('nombre', 'TEST C', 'responsables', jsonb_build_array(v_emp1, v_emp2, v_emp3),
      'criterios', jsonb_build_object('proveedor_ids', jsonb_build_array(v_prov_c)))));
  if v_res->'tareas'->0->'por_parte' is distinct from '[2, 2, 2]'::jsonb then
    raise exception 'TEST FALLÓ: el reparto entre 3 debía dar [2, 2, 2], dio %', v_res->'tareas'->0;
  end if;
  if (v_res->>'fecha_abc')::date <> v_fecha then
    raise exception 'TEST FALLÓ: la vista previa debía informar la fecha de la clase ABC, dio %', v_res->>'fecha_abc';
  end if;
  raise notice 'OK · reparto: tramos seguidos y el corte cae entre estantes';

  v_zonas := jsonb_build_array(
    -- emp1 repetido y un ancla que no corresponde a una lista: se ignoran.
    jsonb_build_object('nombre', 'TEST Prov A', 'ubicacion_id', v_dep,
      'responsables', jsonb_build_array(v_emp1, v_emp2, v_emp1, null, ''),
      'criterios', jsonb_build_object('proveedor_ids', jsonb_build_array(v_prov_a))),
    jsonb_build_object('nombre', 'TEST G1',
      'responsables', jsonb_build_array(v_emp3, v_emp4),
      'criterios', jsonb_build_object('ubicacion_ids', jsonb_build_array(v_g1))),
    jsonb_build_object('nombre', 'TEST Libre', 'responsable_user_id', null, 'orden', 9),
    jsonb_build_object('nombre', 'TEST DEP',
      'criterios', jsonb_build_object('ubicacion_ids', jsonb_build_array(v_dep))),
    jsonb_build_object('nombre', 'TEST Vacía',
      'criterios', jsonb_build_object('clases_abc', jsonb_build_array('A'),
                                      'proveedor_ids', jsonb_build_array(v_prov_a))));

  v_res := public.fn_conteo_previsualizar_tareas(v_zonas)->'tareas';
  if jsonb_array_length(v_res) <> 5
     or (v_res->0->>'productos')::integer <> 3 or (v_res->0->>'partes')::integer <> 2
     or (v_res->1->>'en_criterio')::integer <> 5 or (v_res->1->>'productos')::integer <> 3
     or (v_res->1->>'ya_asignados')::integer <> 2 or (v_res->1->>'con_otros_lugares')::integer <> 1
     or (v_res->2->>'libre')::boolean is not true
     or (v_res->3->>'productos')::integer <> 2
     or (v_res->4->>'productos')::integer <> 0 or (v_res->4->>'ya_asignados')::integer <> 2 then
    raise exception 'TEST FALLÓ: números de la vista previa inesperados: %', v_res;
  end if;
  if exists (select 1 from public.conteo_sesiones where estado <> 'cerrada')
     or exists (select 1 from public.conteo_zonas where nombre like 'TEST %') then
    raise exception 'TEST FALLÓ: la vista previa dejó una sesión o tareas guardadas';
  end if;
  raise notice 'OK · vista previa: cuenta lo ya asignado, avisa lo que vive en otro lado y no guarda nada';

  raise notice '━━ 3 · ABRIR CON TAREAS: RECLAMOS ━━';
  begin
    perform public.fn_abrir_sesion_conteo('TEST Tareas', 5000, v_zonas);
    raise exception 'TEST FALLÓ: se abrió una sesión con una tarea sin productos';
  exception when others then
    if sqlerrm like 'TEST FALLÓ%' then raise; end if;
    if sqlerrm not like '%sin productos%' then raise; end if;
  end;
  begin
    perform public.fn_abrir_sesion_conteo('TEST Tareas', 5000, jsonb_build_array(
      jsonb_build_object('nombre', 'TEST Libre de a dos',
        'responsables', jsonb_build_array(v_emp1, v_emp2))));
    raise exception 'TEST FALLÓ: una zona libre aceptó dos responsables';
  exception when others then
    if sqlerrm like 'TEST FALLÓ%' then raise; end if;
    if sqlerrm not like '%un solo responsable%' then raise; end if;
  end;

  select * into v_sesion
    from public.fn_abrir_sesion_conteo('TEST Tareas', 5000, v_zonas - 4);

  select count(*) into v_n from public.conteo_zonas where sesion_id = v_sesion.id;
  if v_n <> 6 then
    raise exception 'TEST FALLÓ: debían crearse 6 tareas (2 + 2 de los repartos, la libre y el depósito), hay %', v_n;
  end if;
  select id into v_a1 from public.conteo_zonas where sesion_id = v_sesion.id and nombre = 'TEST Prov A (1/2)';
  select id into v_a2 from public.conteo_zonas where sesion_id = v_sesion.id and nombre = 'TEST Prov A (2/2)';
  select id into v_ga from public.conteo_zonas where sesion_id = v_sesion.id and nombre = 'TEST G1 (1/2)';
  select id into v_gb from public.conteo_zonas where sesion_id = v_sesion.id and nombre = 'TEST G1 (2/2)';
  select id into v_libre from public.conteo_zonas where sesion_id = v_sesion.id and nombre = 'TEST Libre';
  select id into v_d from public.conteo_zonas where sesion_id = v_sesion.id and nombre = 'TEST DEP';
  if v_a1 is null or v_a2 is null or v_ga is null or v_gb is null or v_libre is null or v_d is null then
    raise exception 'TEST FALLÓ: falta alguna tarea (nombres de los repartos "(1/2)" y "(2/2)")';
  end if;

  if pg_temp.lista(v_a1) <> array[v_p1, v_p2]::text or pg_temp.lista(v_a2) <> array[v_p4]::text then
    raise exception 'TEST FALLÓ: reparto esperado [P1,P2] y [P4], dio % y %', pg_temp.lista(v_a1), pg_temp.lista(v_a2);
  end if;
  if (select responsable_user_id from public.conteo_zonas where id = v_a1) <> v_emp1
     or (select responsable_user_id from public.conteo_zonas where id = v_a2) <> v_emp2
     or (select tipo from public.conteo_zonas where id = v_a1) <> 'lista'
     or (select ubicacion_id from public.conteo_zonas where id = v_a1) is not null then
    raise exception 'TEST FALLÓ: la lista debía quedar para emp1/emp2, tipo lista y SIN ancla al mapa';
  end if;
  raise notice 'OK · lista repartida, responsables sin repetir, sin ancla';

  if pg_temp.lista(v_ga) <> array[v_p8, v_p9]::text or pg_temp.lista(v_gb) <> array[v_p3]::text then
    raise exception 'TEST FALLÓ: G1 debía repartirse [P8,P9] (E1) y [P3] (E2) — P1 y P2 son de la lista —, dio % y %',
      pg_temp.lista(v_ga), pg_temp.lista(v_gb);
  end if;
  if (select ubicacion_id from public.conteo_zonas where id = v_ga) <> v_g1
     or (select tipo from public.conteo_zonas where id = v_ga) <> 'area' then
    raise exception 'TEST FALLÓ: la tarea de un área sola debía quedar anclada al mapa y con tipo area';
  end if;
  if pg_temp.lista(v_d) <> array[v_p5, v_p9]::text then
    raise exception 'TEST FALLÓ: el depósito debía quedar con P5 y P9 (P9 también está en G1, otro lugar), dio %', pg_temp.lista(v_d);
  end if;
  if pg_temp.lista(v_libre) <> '{}' or (select criterios from public.conteo_zonas where id = v_libre) is not null then
    raise exception 'TEST FALLÓ: la zona libre (payload viejo) no debía tener lista ni criterios';
  end if;
  raise notice 'OK · reclamos: la lista excluye del área; dos áreas comparten P9 en lugares distintos; zona libre intacta';

  raise notice '━━ 4 · LA BASE HACE CUMPLIR EL ALCANCE ━━';
  execute 'set local role authenticated';
  perform pg_temp.como_usuario(v_emp1);
  select count(*) into v_n from public.conteo_zona_productos zp
    join public.conteo_zonas z on z.id = zp.zona_id where z.sesion_id = v_sesion.id;
  -- emp1 ve su tarea (2) y las que no tienen responsable: TEST DEP (2).
  if v_n <> 4 then
    raise exception 'TEST FALLÓ: RLS — emp1 debía ver 4 renglones de lista (los suyos y los de tareas libres), ve %', v_n;
  end if;
  raise notice 'OK · RLS de la lista: cada uno ve lo suyo y lo que está libre';

  perform public.fn_iniciar_zona(v_a1);
  perform public.fn_registrar_conteo(v_a1, v_p1, 10);
  begin
    perform public.fn_registrar_conteo(v_a1, v_p3, 4);
    raise exception 'TEST FALLÓ: una tarea lista aceptó un producto fuera de su lista';
  exception when others then
    if sqlerrm like 'TEST FALLÓ%' then raise; end if;
    if sqlerrm not like '%no está en la lista%' then raise; end if;
  end;
  raise notice 'OK · tarea lista: solo lo de su lista';

  perform pg_temp.como_usuario(v_emp3);
  perform public.fn_iniciar_zona(v_ga);
  perform public.fn_registrar_conteo(v_ga, v_p9, 6);
  begin
    perform public.fn_registrar_conteo(v_ga, v_p1, 3);
    raise exception 'TEST FALLÓ: un área aceptó un producto que es de una tarea lista';
  exception when others then
    if sqlerrm like 'TEST FALLÓ%' then raise; end if;
    if sqlerrm not like '%se cuenta en la tarea%' then raise; end if;
  end;
  -- P5 vive en el depósito pero apareció en la góndola: se carga (otro lugar).
  perform public.fn_registrar_conteo(v_ga, v_p5, 2);
  -- P10 no está en el mapa y apareció en la góndola: se carga.
  perform public.fn_registrar_conteo(v_ga, v_p10, 3);

  perform pg_temp.como_usuario(v_emp4);
  perform public.fn_iniciar_zona(v_gb);
  perform public.fn_registrar_conteo(v_gb, v_p3, 10);
  begin
    perform public.fn_registrar_conteo(v_gb, v_p10, 3);
    raise exception 'TEST FALLÓ: dos personas de la misma góndola cargaron el mismo producto suelto';
  exception when others then
    if sqlerrm like 'TEST FALLÓ%' then raise; end if;
    if sqlerrm not like '%ya se cargó en la tarea%' then raise; end if;
  end;
  begin
    perform public.fn_registrar_conteo(v_gb, v_p8, 1);
    raise exception 'TEST FALLÓ: se cargó un producto que es del compañero de góndola';
  exception when others then
    if sqlerrm like 'TEST FALLÓ%' then raise; end if;
    if sqlerrm not like '%se cuenta en la tarea%' then raise; end if;
  end;
  raise notice 'OK · área: guía + lo encontrado en el lugar, sin doble carga entre compañeros';

  perform pg_temp.como_usuario(v_admin);
  begin
    perform public.fn_agregar_tareas_conteo(v_sesion.id, jsonb_build_array(
      jsonb_build_object('nombre', 'TEST Sin ubicar',
        'criterios', jsonb_build_object('sin_ubicar', true,
                                        'proveedor_ids', jsonb_build_array(v_prov_b)))));
    raise exception 'TEST FALLÓ: una lista nueva se llevó un producto que ya estaba contado';
  exception when others then
    if sqlerrm like 'TEST FALLÓ%' then raise; end if;
    if sqlerrm not like '%sin productos%' then raise; end if;
  end;
  raise notice 'OK · lo ya contado no entra en una lista nueva';

  raise notice '━━ 5 · AVANCE Y GESTIÓN ━━';
  select count(*) into v_n from public.fn_conteo_avance(v_sesion.id);
  if v_n <> 6 then
    raise exception 'TEST FALLÓ: el gestor debía ver el avance de las 6 tareas, ve %', v_n;
  end if;
  select a.en_lista * 100 + a.contados * 10 + a.contados_lista into v_n
    from public.fn_conteo_avance(v_sesion.id) a where a.zona_id = v_ga;
  if v_n <> 231 then
    raise exception 'TEST FALLÓ: avance de G1 (1/2) esperado lista 2 / contados 3 / de la lista 1, dio %', v_n;
  end if;
  perform pg_temp.como_usuario(v_emp2);
  select count(*) into v_n from public.fn_conteo_avance(v_sesion.id);
  if v_n <> 3 then
    raise exception 'TEST FALLÓ: emp2 debía ver 3 tareas (la suya y las 2 sin responsable), ve %', v_n;
  end if;
  raise notice 'OK · avance por tarea, filtrado por persona';

  begin
    perform public.fn_reasignar_tarea_conteo(v_d, v_emp2);
    raise exception 'TEST FALLÓ: un empleado pudo reasignar una tarea';
  exception when others then
    if sqlerrm like 'TEST FALLÓ%' then raise; end if;
    if sqlerrm not like '%permiso%' then raise; end if;
  end;
  perform pg_temp.como_usuario(v_admin);
  perform public.fn_reasignar_tarea_conteo(v_d, v_emp2);
  if (select responsable_user_id from public.conteo_zonas where id = v_d) <> v_emp2 then
    raise exception 'TEST FALLÓ: la tarea no quedó reasignada';
  end if;
  begin
    perform public.fn_reasignar_tarea_conteo(v_ga, null);
    raise exception 'TEST FALLÓ: una tarea en curso quedó sin responsable';
  exception when others then
    if sqlerrm like 'TEST FALLÓ%' then raise; end if;
    if sqlerrm not like '%en curso%' then raise; end if;
  end;
  raise notice 'OK · reasignar: solo gestores; en curso no puede quedar libre';

  raise notice '━━ 6 · COBERTURA, QUITAR Y AGREGAR ━━';
  select count(*) into v_n from public.fn_conteo_cobertura(v_sesion.id);
  if v_n <> 0 then
    raise exception 'TEST FALLÓ: con el depósito en una tarea abierta no debía avisar nada todavía, avisó %', v_n;
  end if;

  begin
    perform public.fn_quitar_tarea_conteo(v_ga);
    raise exception 'TEST FALLÓ: se quitó una tarea con productos contados';
  exception when others then
    if sqlerrm like 'TEST FALLÓ%' then raise; end if;
    if sqlerrm not like '%ya tiene productos contados%' then raise; end if;
  end;
  perform public.fn_quitar_tarea_conteo(v_d);
  if exists (select 1 from public.conteo_zonas where id = v_d)
     or exists (select 1 from public.conteo_zona_productos where zona_id = v_d) then
    raise exception 'TEST FALLÓ: la tarea quitada dejó rastros';
  end if;

  select string_agg(c.producto_id || ':' || c.ubicacion_id || ':' || c.motivo, ',' order by c.producto_id)
    into v_txt from public.fn_conteo_cobertura(v_sesion.id) c;
  if v_txt is distinct from v_p5 || ':' || v_dep || ':sin_tarea,' || v_p9 || ':' || v_dep || ':sin_tarea' then
    raise exception 'TEST FALLÓ: sin tarea de depósito debían faltar P5 y P9 en DEP (sin_tarea), dio %', v_txt;
  end if;
  select c.ubicacion into v_txt from public.fn_conteo_cobertura(v_sesion.id) c where c.producto_id = v_p9;
  if v_txt is distinct from 'TEST S › TEST DEP' then
    raise exception 'TEST FALLÓ: el lugar que falta debía leerse "TEST S › TEST DEP", dio "%"', v_txt;
  end if;
  raise notice 'OK · cobertura: avisa lo contado a medias y dónde falta';

  -- Áreas anidadas: el sector entero contiene a G1, que ya es de otras
  -- tareas. Al sector le queda solo lo que nadie tomó: el depósito.
  v_res := public.fn_agregar_tareas_conteo(v_sesion.id, jsonb_build_array(
    jsonb_build_object('nombre', 'TEST Sector entero',
      'responsables', jsonb_build_array(v_emp2),
      'criterios', jsonb_build_object('ubicacion_ids', jsonb_build_array(v_s)))));
  select id into v_c from public.conteo_zonas where sesion_id = v_sesion.id and nombre = 'TEST Sector entero';
  -- P9 va primero: conserva el orden de su lugar principal (E1) aunque a esta
  -- tarea solo le quede el depósito. La pantalla agrupa por lugar.
  if jsonb_array_length(v_res) <> 1 or v_c is null or pg_temp.lista(v_c) <> array[v_p9, v_p5]::text then
    raise exception 'TEST FALLÓ: al sector le debían quedar P9 y P5 (solo su parte del depósito), dio %', pg_temp.lista(v_c);
  end if;
  select zp.ubicacion_ids::text || ' | ' || zp.donde into v_txt
    from public.conteo_zona_productos zp where zp.zona_id = v_c and zp.producto_id = v_p9;
  if v_txt is distinct from array[v_dep]::text || ' | TEST S › TEST DEP' then
    raise exception 'TEST FALLÓ: a P9 le debía quedar solo el depósito (E1 es de otra tarea), dio "%"', v_txt;
  end if;
  select count(*) into v_n from public.fn_conteo_cobertura(v_sesion.id);
  if v_n <> 0 then
    raise exception 'TEST FALLÓ: con el depósito otra vez en una tarea abierta no debía avisar, avisó %', v_n;
  end if;
  raise notice 'OK · tarea agregada con la sesión abierta; áreas anidadas se quedan con lo libre';

  raise notice '━━ 7 · CERRAR TAREAS: MAPA Y CONTEO A MEDIAS ━━';
  perform pg_temp.como_usuario(v_emp2);
  perform public.fn_iniciar_zona(v_c);
  perform public.fn_registrar_conteo(v_c, v_p5, 8);
  perform public.fn_cerrar_zona(v_c);   -- P9 quedó en la lista sin cargar
  perform pg_temp.como_usuario(v_emp3);
  perform public.fn_cerrar_zona(v_ga);

  perform pg_temp.como_usuario(v_admin);
  select string_agg(c.producto_id || ':' || c.motivo || ':' || c.tarea, ',') into v_txt
    from public.fn_conteo_cobertura(v_sesion.id) c;
  if v_txt is distinct from v_p9 || ':sin_contar:TEST Sector entero' then
    raise exception 'TEST FALLÓ: P9 debía figurar sin contar en "TEST Sector entero", dio %', v_txt;
  end if;
  raise notice 'OK · cobertura: distingue "nadie lo tenía" de "quedó sin cargar"';

  select count(*) into v_n from public.producto_ubicacion where producto_id = v_p9;
  if v_n <> 2 then
    raise exception 'TEST FALLÓ: P9 ya vivía en un estante de G1; cerrar la tarea no debía sumarle la góndola (tiene % ubicaciones)', v_n;
  end if;
  select count(*) into v_n from public.producto_ubicacion where producto_id = v_p5;
  if v_n <> 2 or not exists (select 1 from public.producto_ubicacion
                              where producto_id = v_p5 and ubicacion_id = v_g1 and not es_principal) then
    raise exception 'TEST FALLÓ: P5 apareció en G1 y debía sumarla como secundaria, sin tocar el sector (tiene %)', v_n;
  end if;
  if not exists (select 1 from public.producto_ubicacion
                  where producto_id = v_p10 and ubicacion_id = v_g1 and es_principal) then
    raise exception 'TEST FALLÓ: P10 no estaba en el mapa y debía quedar ubicado en G1 como principal';
  end if;
  raise notice 'OK · cerrar una tarea anclada carga el mapa sin duplicar ubicaciones';

  raise notice '━━ 8 · REVISIÓN, REABRIR Y DIFERENCIAS ━━';
  perform pg_temp.como_usuario(v_emp1);
  perform public.fn_cerrar_zona(v_a1);
  perform pg_temp.como_usuario(v_emp4);
  perform public.fn_cerrar_zona(v_gb);
  perform pg_temp.como_usuario(v_admin);
  perform public.fn_iniciar_zona(v_a2);
  perform public.fn_cerrar_zona(v_a2);
  perform public.fn_iniciar_zona(v_libre);
  perform public.fn_cerrar_zona(v_libre);
  perform public.fn_pasar_a_revision(v_sesion.id);

  begin
    perform public.fn_agregar_tareas_conteo(v_sesion.id, jsonb_build_array(
      jsonb_build_object('nombre', 'TEST tarde')));
    raise exception 'TEST FALLÓ: se agregó una tarea con la sesión en revisión';
  exception when others then
    if sqlerrm like 'TEST FALLÓ%' then raise; end if;
    if sqlerrm not like '%sesión abierta%' then raise; end if;
  end;
  perform pg_temp.como_usuario(v_emp1);
  begin
    perform public.fn_reabrir_sesion_conteo(v_sesion.id);
    raise exception 'TEST FALLÓ: un empleado pudo reabrir la sesión';
  exception when others then
    if sqlerrm like 'TEST FALLÓ%' then raise; end if;
    if sqlerrm not like '%permiso%' then raise; end if;
  end;
  perform pg_temp.como_usuario(v_admin);
  perform public.fn_reabrir_sesion_conteo(v_sesion.id);
  if (select estado from public.conteo_sesiones where id = v_sesion.id) <> 'abierta' then
    raise exception 'TEST FALLÓ: la sesión no volvió a quedar abierta';
  end if;
  v_res := public.fn_agregar_tareas_conteo(v_sesion.id, jsonb_build_array(
    jsonb_build_object('nombre', 'TEST después de reabrir', 'responsable_user_id', v_emp1)));
  raise notice 'OK · reabrir: solo gestores, y después se pueden sumar tareas';

  select d.total_contado into v_n from public.fn_conteo_diferencias(v_sesion.id) d where d.producto_id = v_p5;
  if v_n <> 10 then
    raise exception 'TEST FALLÓ: P5 debía sumar 2 (encontrado en góndola) + 8 (depósito) = 10, dio %', v_n;
  end if;
  select d.total_contado into v_n from public.fn_conteo_diferencias(v_sesion.id) d where d.producto_id = v_p9;
  if v_n <> 6 then
    raise exception 'TEST FALLÓ: P9 debía quedar con los 6 de la góndola, dio %', v_n;
  end if;
  select d.total_contado into v_n from public.fn_conteo_diferencias(v_sesion.id) d where d.producto_id = v_p2;
  if v_n is not null then
    raise exception 'TEST FALLÓ: P2 quedó en la lista sin contar y debía figurar sin contar, dio %', v_n;
  end if;
  raise notice 'OK · las diferencias suman las áreas y lo no contado queda sin contar';

  execute 'reset role';
  raise notice '';
  raise notice '✔✔✔ TODOS LOS TESTS PASARON (rollback aplicado)';
end;
$$;

rollback;
