-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  PRUEBA · Permisos D8 y D9 (migs 256 y 257)                         ║
-- ║                                                                     ║
-- ║  Pegar entero en el SQL Editor, DESPUÉS de correr la 256 y la 257.  ║
-- ║  Cubre: cajero y fiambrero sin 'rrhh' y con 'mi_panel'; todo rol    ║
-- ║  con 'configuracion' tiene 'proveedores'; con solo 'proveedores' se ║
-- ║  edita la ficha del proveedor y se agrega, cambia y quita un        ║
-- ║  producto del catálogo; sin el permiso el catálogo no se ve ni se   ║
-- ║  escribe (RLS).                                                     ║
-- ║  Termina en ROLLBACK: no deja nada.                                 ║
-- ║  Si pasa, la última línea de Messages dice                          ║
-- ║  "✔✔✔ PERMISO PROVEEDORES OK".                                     ║
-- ╚════════════════════════════════════════════════════════════════════╝
begin;

-- Cambia de usuario Y de rol de Postgres (authenticated) para que las policies
-- RLS se apliquen de verdad: como postgres las saltearía.
create function pg_temp.como_usuario(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $f$;

do $$
declare
  v_prov uuid := gen_random_uuid();
  v_sin uuid := gen_random_uuid();
  v_proveedor integer;
  v_producto integer;
  v_id integer;
  n int;
  ok boolean;
begin
  -- 0. Las migraciones corrieron.
  select count(*) into n from public.roles
  where codigo in ('cajero', 'fiambrero')
    and ('rrhh' = any(permisos) or not ('mi_panel' = any(permisos)));
  if n > 0 then
    raise exception 'FALLO 0a: cajero/fiambrero siguen con rrhh o sin mi_panel (falta la 256)';
  end if;
  select count(*) into n from public.roles
  where 'configuracion' = any(permisos) and not ('proveedores' = any(permisos));
  if n > 0 then
    raise exception 'FALLO 0b: % rol(es) con configuracion y sin proveedores (falta la 257)', n;
  end if;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
    updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
         u.email, 'x', now(), '{"provider":"email","providers":["email"]}', '{}',
         now(), now(), '', '', '', ''
    from (values (v_prov, 'test.prov.compras@test.local'),
                 (v_sin, 'test.prov.sin@test.local')) as u(id, email);
  insert into public.roles (codigo, nombre, es_sistema, permisos) values
    ('test_prov_compras', 'TEST Compras', false, array['proveedores']),
    ('test_prov_sin', 'TEST Sin', false, array['mi_panel'])
  on conflict (codigo) do update set permisos = excluded.permisos;
  insert into public.usuarios (id, email, nombre, rol, activo) values
    (v_prov, 'test.prov.compras@test.local', 'TEST Compras', 'test_prov_compras', true),
    (v_sin, 'test.prov.sin@test.local', 'TEST Sin', 'test_prov_sin', true)
  on conflict (id) do update set rol = excluded.rol, activo = true;

  insert into public.proveedores (nombre) values ('TEST Proveedor D9')
    returning id into v_proveedor;
  select id into v_producto from public.productos order by id limit 1;
  if v_producto is null then
    raise exception 'No hay productos para probar el catálogo';
  end if;

  -- 1. Con solo 'proveedores': edita la ficha y arma el catálogo.
  perform pg_temp.como_usuario(v_prov);
  update public.proveedores set condicion_pago = 'TEST 30 días' where id = v_proveedor;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FALLO 1a: no pudo editar la ficha del proveedor'; end if;

  insert into public.proveedor_producto (proveedor_id, producto_id, costo, es_principal)
    values (v_proveedor, v_producto, 123.45, false) returning id into v_id;
  update public.proveedor_producto set costo = 150, codigo_proveedor = 'T-1' where id = v_id;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FALLO 1b: no pudo cambiar el costo del catálogo'; end if;
  select count(*) into n from public.proveedor_producto where id = v_id and costo = 150;
  if n <> 1 then raise exception 'FALLO 1c: no ve el catálogo que acaba de cargar'; end if;

  -- 2. Sin el permiso: no ve el catálogo ni escribe.
  perform pg_temp.como_usuario(v_sin);
  select count(*) into n from public.proveedor_producto where proveedor_id = v_proveedor;
  if n <> 0 then raise exception 'FALLO 2a: sin permiso ve % fila(s) del catálogo', n; end if;
  update public.proveedor_producto set costo = 1 where id = v_id;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALLO 2b: sin permiso cambió el costo del catálogo'; end if;
  ok := false;
  begin
    insert into public.proveedor_producto (proveedor_id, producto_id, costo)
      values (v_proveedor, v_producto, 1);
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FALLO 2c: sin permiso pudo agregar al catálogo'; end if;

  -- 3. Con 'proveedores' quita el producto del catálogo.
  perform pg_temp.como_usuario(v_prov);
  delete from public.proveedor_producto where id = v_id;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FALLO 3: no pudo quitar del catálogo'; end if;

  perform set_config('role', 'none', true);
  raise notice '✔✔✔ PERMISO PROVEEDORES OK';
end $$;

rollback;
