-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  PRUEBA · RLS de la ficha de proveedores (mig 258)                  ║
-- ║                                                                     ║
-- ║  Pegar entero en el SQL Editor, DESPUÉS de correr la 258.           ║
-- ║  Cubre: la policy vieja using(true) ya no está; el cajero (rol      ║
-- ║  real 'cajero') ve los proveedores pero no los crea, edita, borra   ║
-- ║  ni les completa el CUIT; con compras, pedidos, configuracion,      ║
-- ║  proveedores o finanzas (uno solo por vez) se crea, se completa el  ║
-- ║  CUIT, se edita y se borra; admin también.                          ║
-- ║  Termina en ROLLBACK: no deja nada.                                 ║
-- ║  Si pasa, la última línea de Messages dice                          ║
-- ║  "✔✔✔ RLS PROVEEDORES OK".                                         ║
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
  v_cajero uuid := gen_random_uuid();
  v_escribe uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_proveedor integer;
  v_id integer;
  v_permiso text;
  n int;
  ok boolean;
begin
  -- 0. La migración corrió: dos policies y ninguna de escritura abierta.
  select count(*) into n from pg_policies
  where schemaname = 'public' and tablename = 'proveedores'
    and cmd <> 'SELECT' and (qual = 'true' or with_check = 'true');
  if n > 0 then
    raise exception 'FALLO 0a: proveedores tiene % policy(s) de escritura abiertas (falta la 258)', n;
  end if;
  select count(*) into n from pg_policies
  where schemaname = 'public' and tablename = 'proveedores';
  if n <> 2 then
    raise exception 'FALLO 0b: proveedores tiene % policies, se esperaban 2', n;
  end if;
  if not exists (select 1 from public.roles where codigo = 'cajero') then
    raise exception 'FALLO 0c: no está el rol cajero';
  end if;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
    updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
         u.email, 'x', now(), '{"provider":"email","providers":["email"]}', '{}',
         now(), now(), '', '', '', ''
    from (values (v_cajero, 'test.rlsprov.cajero@test.local'),
                 (v_escribe, 'test.rlsprov.escribe@test.local'),
                 (v_admin, 'test.rlsprov.admin@test.local')) as u(id, email);
  insert into public.roles (codigo, nombre, es_sistema, permisos) values
    ('test_rlsprov', 'TEST RLS proveedores', false, array['mi_panel'])
  on conflict (codigo) do update set permisos = excluded.permisos;
  insert into public.usuarios (id, email, nombre, rol, activo) values
    (v_cajero, 'test.rlsprov.cajero@test.local', 'TEST Cajero', 'cajero', true),
    (v_escribe, 'test.rlsprov.escribe@test.local', 'TEST Escribe', 'test_rlsprov', true),
    (v_admin, 'test.rlsprov.admin@test.local', 'TEST Admin', 'admin', true)
  on conflict (id) do update set rol = excluded.rol, activo = true;

  insert into public.proveedores (nombre, condicion_pago)
    values ('TEST Proveedor RLS', 'contado') returning id into v_proveedor;

  -- 1. Cajero: lee, pero no escribe.
  perform pg_temp.como_usuario(v_cajero);
  select count(*) into n from public.proveedores where id = v_proveedor;
  if n <> 1 then raise exception 'FALLO 1a: el cajero no ve el proveedor'; end if;

  ok := false;
  begin
    insert into public.proveedores (nombre) values ('TEST Alta del cajero');
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FALLO 1b: el cajero pudo crear un proveedor'; end if;

  update public.proveedores set condicion_pago = 'TEST 90 días' where id = v_proveedor;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALLO 1c: el cajero editó el proveedor'; end if;

  -- Igual que completarCuitProveedor: sin permiso no toca filas y no da error.
  update public.proveedores set cuit = '20111111112'
    where id = v_proveedor and cuit is null;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALLO 1d: el cajero completó el CUIT'; end if;

  delete from public.proveedores where id = v_proveedor;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALLO 1e: el cajero borró el proveedor'; end if;

  perform set_config('role', 'none', true);
  select count(*) into n from public.proveedores
  where id = v_proveedor and condicion_pago = 'contado' and cuit is null;
  if n <> 1 then raise exception 'FALLO 1f: el proveedor cambió después del cajero'; end if;

  -- 2. Cada permiso de escritura, solo: crea, completa el CUIT, edita y borra.
  foreach v_permiso in array
    array['compras', 'pedidos', 'configuracion', 'proveedores', 'finanzas']
  loop
    perform set_config('role', 'none', true);
    update public.roles set permisos = array[v_permiso] where codigo = 'test_rlsprov';

    perform pg_temp.como_usuario(v_escribe);
    insert into public.proveedores (nombre)
      values ('TEST Alta con ' || v_permiso) returning id into v_id;
    if v_id is null then
      raise exception 'FALLO 2a: con % no pudo crear el proveedor', v_permiso;
    end if;

    update public.proveedores set cuit = '20111111112' where id = v_id and cuit is null;
    get diagnostics n = row_count;
    if n <> 1 then raise exception 'FALLO 2b: con % no completó el CUIT', v_permiso; end if;

    update public.proveedores set condicion_pago = 'TEST 30 días' where id = v_id;
    get diagnostics n = row_count;
    if n <> 1 then raise exception 'FALLO 2c: con % no editó el proveedor', v_permiso; end if;

    delete from public.proveedores where id = v_id;
    get diagnostics n = row_count;
    if n <> 1 then raise exception 'FALLO 2d: con % no borró el proveedor', v_permiso; end if;
  end loop;

  -- 3. Sin ningún permiso de escritura (solo mi_panel), igual que el cajero.
  perform set_config('role', 'none', true);
  update public.roles set permisos = array['mi_panel', 'recepcion']
    where codigo = 'test_rlsprov';
  perform pg_temp.como_usuario(v_escribe);
  update public.proveedores set condicion_pago = 'TEST' where id = v_proveedor;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALLO 3: con recepción editó el proveedor'; end if;

  -- 4. Admin escribe siempre.
  perform pg_temp.como_usuario(v_admin);
  update public.proveedores set condicion_pago = 'TEST admin' where id = v_proveedor;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FALLO 4: admin no pudo editar el proveedor'; end if;

  perform set_config('role', 'none', true);
  raise notice '✔✔✔ RLS PROVEEDORES OK';
end $$;

rollback;
