-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  TEST · Conteo físico: sesiones programadas (migraciones 330–333)   ║
-- ║                                                                     ║
-- ║  Correr COMPLETO en el SQL Editor de Supabase, DESPUÉS de aplicar   ║
-- ║  las migraciones 330 a 333 y SIN una sesión de conteo abierta ni    ║
-- ║  una programación real vencida (la prueba abre las suyas). Todo     ║
-- ║  corre dentro de una transacción que termina en ROLLBACK: no deja   ║
-- ║  usuarios, productos, sesiones ni programaciones.                   ║
-- ║                                                                     ║
-- ║  Si algo falla, corta con "TEST FALLÓ: ..." y el rollback es        ║
-- ║  automático. Si pasa todo, la última línea de Messages dice         ║
-- ║  "✔✔✔ TODOS LOS TESTS PASARON (rollback aplicado)".                 ║
-- ║                                                                     ║
-- ║  Qué verifica:                                                      ║
-- ║   1. Programar valida fecha (2 min a 90 días), tareas, responsables ║
-- ║      y permiso.                                                     ║
-- ║   2. La programación queda guardada y auditada; RLS: la ve quien    ║
-- ║      tiene conteo_cierre, el staff no.                              ║
-- ║   3. La apertura automática solo corre como sistema; abre la        ║
-- ║      vencida A NOMBRE DE QUIEN PROGRAMÓ (sesión, snapshot, lista)   ║
-- ║      y no deja los claims colgados.                                 ║
-- ║   4. Con otra sesión viva espera (sigue programada, con motivo) y   ║
-- ║      pasada la hora queda fallida.                                  ║
-- ║   5. "Abrir ahora": corta con sesión viva, avisa si ya se abrió y   ║
-- ║      reintenta una fallida a nombre del gestor que aprieta.         ║
-- ║   6. Reprogramar y cancelar; transiciones inválidas; el cron no     ║
-- ║      toca una cancelada.                                            ║
-- ║   7. Si quien programó ya no tiene permiso: fallida con el motivo   ║
-- ║      y sin sesión a medias.                                         ║
-- ║   8. Vista previa v2: con p_nueva simula una sesión nueva aunque la ║
-- ║      viva esté en revisión, y no deja nada.                         ║
-- ║   9. Privilegios y proceso de pg_cron.                              ║
-- ╚════════════════════════════════════════════════════════════════════╝

begin;

-- Un usuario logueado (como la app): claims en la transacción, rol normal.
create function pg_temp.como_usuario(p_uid uuid) returns void
language plpgsql as $f$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end $f$;

-- Sin usuario: lo que ve pg_cron (sin JWT).
create function pg_temp.como_sistema() returns void
language plpgsql as $f$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end $f$;

do $$
declare
  v_admin  uuid := gen_random_uuid();
  v_gestor uuid := gen_random_uuid();
  v_staff  uuid := gen_random_uuid();
  v_prov integer;
  v_p1 integer; v_p2 integer; v_p3 integer;
  v_id1 integer; v_id2 integer; v_id3 integer; v_id4 integer;
  v_ses1 integer;
  v_zonas jsonb;
  v_prog public.conteo_programaciones;
  v_sesion public.conteo_sesiones;
  v_res jsonb;
  v_n integer;
  ok boolean;
begin
  raise notice '━━ SETUP ━━';
  if exists (select 1 from public.conteo_sesiones where estado <> 'cerrada') then
    raise exception 'TEST FALLÓ: hay una sesión de conteo abierta. Cerrala y volvé a correr la prueba.';
  end if;
  if exists (select 1 from public.conteo_programaciones where estado = 'programada' and programada_para <= now()) then
    raise exception 'TEST FALLÓ: hay una programación real vencida sin abrir. Esperá a que el proceso la abra o cancelala.';
  end if;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
    updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
         u.email, 'x', now(), '{"provider":"email","providers":["email"]}', '{}',
         now(), now(), '', '', '', ''
    from (values (v_admin,  'test.prog.admin@test.local'),
                 (v_gestor, 'test.prog.gestor@test.local'),
                 (v_staff,  'test.prog.staff@test.local')) as u(id, email);

  insert into public.roles (codigo, nombre, es_sistema, permisos) values
    ('test_prog_staff',  'TEST Staff Programadas',  false, array['inventario']),
    ('test_prog_gestor', 'TEST Gestor Programadas', false, array['inventario', 'conteo_cierre'])
  on conflict (codigo) do update set permisos = excluded.permisos;

  insert into public.usuarios (id, email, nombre, rol, activo) values
    (v_admin,  'test.prog.admin@test.local',  'TEST Admin Prog',  'admin', true),
    (v_gestor, 'test.prog.gestor@test.local', 'TEST Gestor Prog', 'test_prog_gestor', true),
    (v_staff,  'test.prog.staff@test.local',  'TEST Staff Prog',  'test_prog_staff', true)
  on conflict (id) do update
    set rol = excluded.rol, nombre = excluded.nombre, activo = true;

  insert into public.proveedores (nombre) values ('TEST Prov Programadas') returning id into v_prov;
  insert into public.productos (nombre, precio_venta, stock_actual, stock_minimo, activo, controlar_stock, proveedor_id)
  values ('TEST PR P1', 100, 10, 0, true, true, v_prov) returning id into v_p1;
  insert into public.productos (nombre, precio_venta, stock_actual, stock_minimo, activo, controlar_stock, proveedor_id)
  values ('TEST PR P2', 100, 10, 0, true, true, v_prov) returning id into v_p2;
  insert into public.productos (nombre, precio_venta, stock_actual, stock_minimo, activo, controlar_stock, proveedor_id)
  values ('TEST PR P3', 100, 10, 0, true, true, v_prov) returning id into v_p3;

  -- La receta tal cual la manda el wizard (aPayloadZonas).
  v_zonas := jsonb_build_array(jsonb_build_object(
    'nombre', 'TEST Prov Programadas',
    'responsables', jsonb_build_array(v_admin),
    'responsable_user_id', v_admin,
    'criterios', jsonb_build_object('proveedor_ids', jsonb_build_array(v_prov)),
    'ubicacion_id', null,
    'orden', 0));

  raise notice '━━ 1 · PROGRAMAR: VALIDACIONES ━━';
  perform pg_temp.como_usuario(v_admin);
  ok := false;
  begin
    perform public.fn_conteo_programar_sesion('TEST pasado', 5000, v_zonas, null, now() - interval '1 minute');
  exception when others then ok := sqlerrm like 'La fecha y hora ya pasaron%'; end;
  if not ok then raise exception 'TEST FALLÓ 1a: una fecha pasada debía cortar con "ya pasaron"'; end if;
  ok := false;
  begin
    perform public.fn_conteo_programar_sesion('TEST lejos', 5000, v_zonas, null, now() + interval '91 days');
  exception when others then ok := sqlerrm like 'Como mucho 90 días%'; end;
  if not ok then raise exception 'TEST FALLÓ 1b: más de 90 días debía cortar'; end if;
  ok := false;
  begin
    perform public.fn_conteo_programar_sesion('TEST vacía', 5000, '[]'::jsonb, null, now() + interval '1 hour');
  exception when others then ok := sqlerrm like 'Armá al menos una tarea%'; end;
  if not ok then raise exception 'TEST FALLÓ 1c: sin tareas debía cortar'; end if;
  ok := false;
  begin
    perform public.fn_conteo_programar_sesion('TEST resp', 5000,
      jsonb_build_array(jsonb_build_object('nombre', 'X',
        'responsables', jsonb_build_array(gen_random_uuid()),
        'criterios', jsonb_build_object('proveedor_ids', jsonb_build_array(v_prov)))),
      null, now() + interval '1 hour');
  exception when others then ok := sqlerrm like 'Un responsable de la tarea%'; end;
  if not ok then raise exception 'TEST FALLÓ 1d: un responsable inexistente debía cortar'; end if;
  perform pg_temp.como_usuario(v_staff);
  ok := false;
  begin
    perform public.fn_conteo_programar_sesion('TEST staff', 5000, v_zonas, null, now() + interval '1 hour');
  exception when others then ok := sqlerrm like 'No tenés permiso%'; end;
  if not ok then raise exception 'TEST FALLÓ 1e: el staff no debía poder programar'; end if;
  raise notice 'OK · validaciones de programar';

  raise notice '━━ 2 · PROGRAMAR Y RLS ━━';
  perform pg_temp.como_usuario(v_admin);
  v_prog := public.fn_conteo_programar_sesion('TEST Programada 1', 7000, v_zonas, '  nota  ', now() + interval '1 hour');
  v_id1 := v_prog.id;
  if v_prog.estado <> 'programada' or v_prog.intentos <> 0 or v_prog.programada_por <> v_admin
     or v_prog.notas <> 'nota' or v_prog.umbral_pesos <> 7000 or v_prog.sesion_id is not null then
    raise exception 'TEST FALLÓ 2a: la programación no quedó como se pidió: %', to_jsonb(v_prog);
  end if;
  if not exists (select 1 from public.auditoria where accion = 'programar_conteo_sesion' and entidad_id = v_id1) then
    raise exception 'TEST FALLÓ 2b: falta la auditoría de programar';
  end if;
  perform set_config('role', 'authenticated', true);
  select count(*) into v_n from public.conteo_programaciones where id = v_id1;
  if v_n <> 1 then raise exception 'TEST FALLÓ 2c: el admin debía ver su programación'; end if;
  perform pg_temp.como_usuario(v_staff);
  perform set_config('role', 'authenticated', true);
  select count(*) into v_n from public.conteo_programaciones;
  if v_n <> 0 then raise exception 'TEST FALLÓ 2d: el staff ve % programaciones (RLS)', v_n; end if;
  perform set_config('role', 'none', true);
  raise notice 'OK · programar, auditoría y RLS';

  raise notice '━━ 3 · APERTURA AUTOMÁTICA ━━';
  perform pg_temp.como_usuario(v_admin);
  ok := false;
  begin
    perform public.fn_conteo_abrir_programadas();
  exception when others then ok := sqlerrm like 'Las sesiones programadas las abre solo el sistema%'; end;
  if not ok then raise exception 'TEST FALLÓ 3a: con usuario, la apertura automática debía rechazarse'; end if;
  perform pg_temp.como_sistema();
  v_res := public.fn_conteo_abrir_programadas();
  if (v_res->>'abiertas')::int <> 0 or (v_res->>'esperan')::int <> 0 or (v_res->>'fallidas')::int <> 0 then
    raise exception 'TEST FALLÓ 3b: sin nada vencido no debía hacer nada, hizo %', v_res;
  end if;
  update public.conteo_programaciones set programada_para = now() - interval '1 minute' where id = v_id1;
  v_res := public.fn_conteo_abrir_programadas();
  if (v_res->>'abiertas')::int <> 1 then raise exception 'TEST FALLÓ 3c: debía abrir 1, dio %', v_res; end if;
  select * into v_prog from public.conteo_programaciones where id = v_id1;
  if v_prog.estado <> 'abierta' or v_prog.sesion_id is null or v_prog.abierta_por is not null
     or v_prog.ultimo_error is not null or v_prog.intentos <> 1 or v_prog.abierta_at is null then
    raise exception 'TEST FALLÓ 3d: la programación no quedó abierta por el sistema: %', to_jsonb(v_prog);
  end if;
  v_ses1 := v_prog.sesion_id;
  select * into v_sesion from public.conteo_sesiones where id = v_ses1;
  if v_sesion.estado <> 'abierta' or v_sesion.abierta_por <> v_admin
     or v_sesion.nombre <> 'TEST Programada 1' or v_sesion.umbral_pesos <> 7000 or v_sesion.notas <> 'nota' then
    raise exception 'TEST FALLÓ 3e: la sesión no quedó a nombre de quien programó: %', to_jsonb(v_sesion);
  end if;
  select count(*) into v_n from public.conteo_snapshot where sesion_id = v_ses1;
  if v_n < 3 then raise exception 'TEST FALLÓ 3f: el snapshot debía tener al menos los 3 productos de prueba, tiene %', v_n; end if;
  select count(*) into v_n from public.conteo_zonas where sesion_id = v_ses1 and responsable_user_id = v_admin;
  if v_n <> 1 then raise exception 'TEST FALLÓ 3g: debía haber 1 tarea del admin, hay %', v_n; end if;
  select count(*) into v_n from public.conteo_zona_productos zp
    join public.conteo_zonas z on z.id = zp.zona_id where z.sesion_id = v_ses1;
  if v_n <> 3 then raise exception 'TEST FALLÓ 3h: la lista debía tener 3 productos, tiene %', v_n; end if;
  if auth.uid() is not null then raise exception 'TEST FALLÓ 3i: los claims quedaron seteados después de abrir'; end if;
  if not exists (select 1 from public.auditoria where accion = 'abrir_conteo_programado' and entidad_id = v_id1) then
    raise exception 'TEST FALLÓ 3j: falta la auditoría de la apertura automática';
  end if;
  raise notice 'OK · apertura automática a nombre de quien programó';

  raise notice '━━ 4 · ESPERA CON SESIÓN VIVA ━━';
  perform pg_temp.como_usuario(v_admin);
  v_prog := public.fn_conteo_programar_sesion('TEST Programada 2', 5000, v_zonas, null, now() + interval '1 hour');
  v_id2 := v_prog.id;
  perform pg_temp.como_sistema();
  update public.conteo_programaciones set programada_para = now() - interval '1 minute' where id = v_id2;
  v_res := public.fn_conteo_abrir_programadas();
  if (v_res->>'esperan')::int <> 1 or (v_res->>'abiertas')::int <> 0 then
    raise exception 'TEST FALLÓ 4a: con sesión viva debía esperar, dio %', v_res;
  end if;
  select * into v_prog from public.conteo_programaciones where id = v_id2;
  if v_prog.estado <> 'programada' or v_prog.intentos <> 1
     or v_prog.ultimo_error not like 'Hay otra sesión de conteo en curso%' then
    raise exception 'TEST FALLÓ 4b: debía seguir programada con el motivo de espera: %', to_jsonb(v_prog);
  end if;
  update public.conteo_programaciones set programada_para = now() - interval '2 hours' where id = v_id2;
  v_res := public.fn_conteo_abrir_programadas();
  if (v_res->>'fallidas')::int <> 1 then raise exception 'TEST FALLÓ 4c: pasada la hora de espera debía fallar, dio %', v_res; end if;
  select * into v_prog from public.conteo_programaciones where id = v_id2;
  if v_prog.estado <> 'fallida' or v_prog.intentos <> 2
     or v_prog.ultimo_error not like 'A la hora programada había otra sesión%' then
    raise exception 'TEST FALLÓ 4d: %', to_jsonb(v_prog);
  end if;
  if not exists (select 1 from public.auditoria where accion = 'fallo_conteo_programada' and entidad_id = v_id2) then
    raise exception 'TEST FALLÓ 4e: falta la auditoría del fallo';
  end if;
  raise notice 'OK · espera 60 minutos y después queda fallida';

  raise notice '━━ 5 · ABRIR AHORA ━━';
  perform pg_temp.como_usuario(v_admin);
  ok := false;
  begin
    perform public.fn_conteo_abrir_programada(v_id2);
  exception when others then ok := sqlerrm like 'Ya hay una sesión de conteo en curso%'; end;
  if not ok then raise exception 'TEST FALLÓ 5a: con sesión viva, Abrir ahora debía cortar con el mensaje de la 225'; end if;
  ok := false;
  begin
    perform public.fn_conteo_abrir_programada(v_id1);
  exception when others then ok := sqlerrm like 'Esta programación ya se abrió a las%'; end;
  if not ok then raise exception 'TEST FALLÓ 5b: una ya abierta debía avisar'; end if;
  perform set_config('role', 'none', true);
  update public.conteo_sesiones set estado = 'cerrada', ts_cierre = now(), cerrada_por = v_admin where id = v_ses1;
  perform pg_temp.como_usuario(v_gestor);
  v_sesion := public.fn_conteo_abrir_programada(v_id2);
  select * into v_prog from public.conteo_programaciones where id = v_id2;
  if v_prog.estado <> 'abierta' or v_prog.sesion_id <> v_sesion.id
     or v_prog.abierta_por <> v_gestor or v_prog.ultimo_error is not null then
    raise exception 'TEST FALLÓ 5c: %', to_jsonb(v_prog);
  end if;
  if v_sesion.abierta_por <> v_gestor then
    raise exception 'TEST FALLÓ 5d: la sesión debía quedar a nombre de quien apretó el botón';
  end if;
  raise notice 'OK · Abrir ahora: corta con sesión viva y reintenta una fallida a nombre del gestor';

  raise notice '━━ 6 · REPROGRAMAR Y CANCELAR ━━';
  perform pg_temp.como_usuario(v_admin);
  v_prog := public.fn_conteo_programar_sesion('TEST Programada 3', 5000, v_zonas, null, now() + interval '1 hour');
  v_id3 := v_prog.id;
  ok := false;
  begin
    perform public.fn_conteo_reprogramar_sesion(v_id3, now() - interval '1 hour');
  exception when others then ok := sqlerrm like 'La fecha y hora ya pasaron%'; end;
  if not ok then raise exception 'TEST FALLÓ 6a: reprogramar al pasado debía cortar'; end if;
  update public.conteo_programaciones set intentos = 3, ultimo_error = 'x', ultimo_intento_at = now() where id = v_id3;
  v_prog := public.fn_conteo_reprogramar_sesion(v_id3, now() + interval '2 hours');
  if v_prog.estado <> 'programada' or v_prog.intentos <> 0 or v_prog.ultimo_error is not null
     or v_prog.ultimo_intento_at is not null or v_prog.programada_para < now() + interval '119 minutes' then
    raise exception 'TEST FALLÓ 6b: %', to_jsonb(v_prog);
  end if;
  perform pg_temp.como_usuario(v_staff);
  ok := false;
  begin
    perform public.fn_conteo_cancelar_programacion(v_id3);
  exception when others then ok := sqlerrm like 'No tenés permiso%'; end;
  if not ok then raise exception 'TEST FALLÓ 6c: el staff no debía poder cancelar'; end if;
  perform pg_temp.como_usuario(v_admin);
  v_prog := public.fn_conteo_cancelar_programacion(v_id3);
  if v_prog.estado <> 'cancelada' or v_prog.cancelada_por <> v_admin or v_prog.cancelada_at is null then
    raise exception 'TEST FALLÓ 6d: %', to_jsonb(v_prog);
  end if;
  ok := false;
  begin
    perform public.fn_conteo_cancelar_programacion(v_id3);
  exception when others then ok := sqlerrm like 'Esta programación ya está cancelada%'; end;
  if not ok then raise exception 'TEST FALLÓ 6e: cancelar dos veces debía avisar'; end if;
  ok := false;
  begin
    perform public.fn_conteo_reprogramar_sesion(v_id3, now() + interval '1 hour');
  exception when others then ok := sqlerrm like 'Esta programación ya está cancelada%'; end;
  if not ok then raise exception 'TEST FALLÓ 6f: reprogramar una cancelada debía avisar'; end if;
  ok := false;
  begin
    perform public.fn_conteo_abrir_programada(v_id3);
  exception when others then ok := sqlerrm like 'Esta programación está cancelada%'; end;
  if not ok then raise exception 'TEST FALLÓ 6g: abrir una cancelada debía avisar'; end if;
  update public.conteo_programaciones set programada_para = now() - interval '1 minute' where id = v_id3;
  perform pg_temp.como_sistema();
  v_res := public.fn_conteo_abrir_programadas();
  if (v_res->>'abiertas')::int + (v_res->>'esperan')::int + (v_res->>'fallidas')::int <> 0 then
    raise exception 'TEST FALLÓ 6h: el proceso no debía tocar una cancelada: %', v_res;
  end if;
  raise notice 'OK · reprogramar, cancelar y transiciones inválidas';

  raise notice '━━ 7 · QUIEN PROGRAMÓ YA NO PUEDE ━━';
  perform pg_temp.como_usuario(v_gestor);
  v_prog := public.fn_conteo_programar_sesion('TEST Programada 4', 5000, v_zonas, null, now() + interval '1 hour');
  v_id4 := v_prog.id;
  perform pg_temp.como_sistema();
  update public.conteo_sesiones set estado = 'cerrada', ts_cierre = now(), cerrada_por = v_admin where id = v_sesion.id;
  update public.usuarios set activo = false where id = v_gestor;
  update public.conteo_programaciones set programada_para = now() - interval '1 minute' where id = v_id4;
  v_res := public.fn_conteo_abrir_programadas();
  if (v_res->>'fallidas')::int <> 1 then raise exception 'TEST FALLÓ 7a: %', v_res; end if;
  select * into v_prog from public.conteo_programaciones where id = v_id4;
  if v_prog.estado <> 'fallida' or v_prog.ultimo_error not like 'No tenés permiso%' then
    raise exception 'TEST FALLÓ 7b: %', to_jsonb(v_prog);
  end if;
  if exists (select 1 from public.conteo_sesiones where estado <> 'cerrada') then
    raise exception 'TEST FALLÓ 7c: una apertura fallida no debía dejar sesión';
  end if;
  if auth.uid() is not null then raise exception 'TEST FALLÓ 7d: claims colgados tras un fallo'; end if;
  update public.usuarios set activo = true where id = v_gestor;
  raise notice 'OK · usuario desactivado: fallida con el motivo, sin sesión a medias';

  raise notice '━━ 8 · VISTA PREVIA DE UNA SESIÓN NUEVA ━━';
  perform pg_temp.como_usuario(v_admin);
  v_sesion := public.fn_abrir_sesion_conteo('TEST sesión en curso', 5000, v_zonas, null);
  perform set_config('role', 'none', true);
  update public.conteo_sesiones set estado = 'en_revision' where id = v_sesion.id;
  perform pg_temp.como_usuario(v_admin);
  ok := false;
  begin
    perform public.fn_conteo_previsualizar_tareas(v_zonas);
  exception when others then ok := sqlerrm like 'La sesión está en revisión%'; end;
  if not ok then raise exception 'TEST FALLÓ 8a: sin p_nueva y con sesión en revisión debía cortar como siempre'; end if;
  v_res := public.fn_conteo_previsualizar_tareas(v_zonas, true);
  if coalesce((v_res->'tareas'->0->>'productos')::int, -1) <> 3 then
    raise exception 'TEST FALLÓ 8b: la vista previa de una sesión nueva debía dar 3 productos: %', v_res;
  end if;
  select count(*) into v_n from public.conteo_sesiones where nombre = '(vista previa)';
  if v_n <> 0 then raise exception 'TEST FALLÓ 8c: la vista previa dejó % sesiones ficticias', v_n; end if;
  select count(*) into v_n from public.conteo_sesiones where estado <> 'cerrada';
  if v_n <> 1 then raise exception 'TEST FALLÓ 8d: la sesión en revisión debía seguir siendo la única viva'; end if;
  raise notice 'OK · vista previa v2 con la sesión viva en revisión';

  raise notice '━━ 9 · PRIVILEGIOS Y PROCESO ━━';
  if has_function_privilege('authenticated', 'public.fn_conteo_abrir_programadas()', 'EXECUTE') then
    raise exception 'TEST FALLÓ 9a: la apertura automática quedó ejecutable desde la app';
  end if;
  if not has_function_privilege('authenticated', 'public.fn_conteo_programar_sesion(text,numeric,jsonb,text,timestamptz)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.fn_conteo_abrir_programada(integer)', 'EXECUTE') then
    raise exception 'TEST FALLÓ 9b: las RPC de gestión deben poder llamarse desde la app';
  end if;
  if to_regclass('cron.job') is not null then
    if not exists (select 1 from cron.job where jobname = 'hex-conteo-programado' and active) then
      raise exception 'TEST FALLÓ 9c: el proceso hex-conteo-programado no está activo';
    end if;
  end if;
  raise notice '✔✔✔ TODOS LOS TESTS PASARON (rollback aplicado)';
end $$;

rollback;
