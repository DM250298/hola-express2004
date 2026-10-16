-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  PRUEBA · Cronograma: dotación requerida + recálculo (mig 255)      ║
-- ║                                                                     ║
-- ║  Pegar entero en el SQL Editor. Cubre: unicidad de la dotación con  ║
-- ║  dia_semana null, RLS (rrhh escribe, mi_panel no), y el recálculo:  ║
-- ║  un día pasado planificado sin fichajes queda "ausente"; al pasarlo ║
-- ║  a franco y llamar fn_recalcular_asistencia_empleado la fila pasa a ║
-- ║  franco; al quitar el plan, la fila desaparece. Sin permiso falla.  ║
-- ║  Termina en ROLLBACK: no deja nada.                                 ║
-- ║  Si pasa, la última línea de Messages dice "✔✔✔ RECALCULO OK".      ║
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
  v_admin uuid := gen_random_uuid();
  v_caja uuid := gen_random_uuid();
  v_emp integer;
  v_man integer;
  v_ayer date := (timezone('America/Argentina/Buenos_Aires', now()))::date - 1;
  v_estado public.estado_asistencia;
  n int;
  ok boolean;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
    updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
         u.email, 'x', now(), '{"provider":"email","providers":["email"]}', '{}',
         now(), now(), '', '', '', ''
    from (values (v_admin, 'test.crono.admin@test.local'),
                 (v_caja, 'test.crono.caja@test.local')) as u(id, email);
  insert into public.roles (codigo, nombre, es_sistema, permisos)
  values ('test_crono_caja', 'TEST Caja', false, array['mi_panel'])
  on conflict (codigo) do update set permisos = excluded.permisos;
  insert into public.usuarios (id, email, nombre, rol, activo) values
    (v_admin, 'test.crono.admin@test.local', 'TEST Admin', 'admin', true),
    (v_caja, 'test.crono.caja@test.local', 'TEST Caja', 'test_crono_caja', true)
  on conflict (id) do update set rol = excluded.rol, activo = true;
  insert into public.empleados (legajo, nombre, apellido, usuario_id, rol_operativo, activo)
    values ('TCR-1', 'TEST Camila', 'R', v_caja, 'cajero', true) returning id into v_emp;
  select id into v_man from public.turnos_plantilla where nombre = 'manana';

  -- 1. Dotación: dos filas "todos los días" del mismo turno no pueden convivir.
  perform pg_temp.como_usuario(v_admin);
  insert into public.dotacion_requerida (turno_id, dia_semana, minimo) values (v_man, null, 2);
  insert into public.dotacion_requerida (turno_id, dia_semana, minimo) values (v_man, 0, 1);
  begin
    insert into public.dotacion_requerida (turno_id, dia_semana, minimo) values (v_man, null, 3);
    raise exception 'FALLO 1: la dotación "todos los días" se duplicó';
  exception when unique_violation then null;
  end;
  select count(*) into n from public.dotacion_requerida where turno_id = v_man;
  if n <> 2 then raise exception 'FALLO 1b: esperaba 2 filas de dotación, hay %', n; end if;

  -- 2. RLS: el cajero (mi_panel) no la ve ni la escribe.
  perform pg_temp.como_usuario(v_caja);
  select count(*) into n from public.dotacion_requerida;
  if n <> 0 then raise exception 'FALLO 2: el cajero ve % filas de dotación', n; end if;
  ok := false;
  begin
    insert into public.dotacion_requerida (turno_id, dia_semana, minimo) values (v_man, 1, 9);
  exception when insufficient_privilege or others then ok := true;
  end;
  if not ok then raise exception 'FALLO 2b: el cajero pudo escribir dotación'; end if;

  -- 3. Recálculo: ayer planificado sin fichajes → ausente.
  perform pg_temp.como_usuario(v_admin);
  insert into public.horarios_asignados (empleado_id, turno_id, fecha, estado)
    values (v_emp, v_man, v_ayer, 'planificado');
  perform public.fn_recalcular_asistencia_empleado(v_emp, v_ayer);
  select estado into v_estado from public.asistencia_diaria where empleado_id = v_emp and fecha = v_ayer;
  if v_estado is distinct from 'ausente_injustificado' then
    raise exception 'FALLO 3: esperaba ausente_injustificado, hay %', v_estado;
  end if;

  -- 4. Pasa a franco y se recalcula → la fila queda en franco (no "ausente").
  update public.horarios_asignados set estado = 'franco', turno_id = null
    where empleado_id = v_emp and fecha = v_ayer;
  perform public.fn_recalcular_asistencia_empleado(v_emp, v_ayer);
  select estado into v_estado from public.asistencia_diaria where empleado_id = v_emp and fecha = v_ayer;
  if v_estado is distinct from 'franco' then
    raise exception 'FALLO 4: esperaba franco, hay %', v_estado;
  end if;

  -- 5. Sin plan ni fichajes → la fila desaparece.
  delete from public.horarios_asignados where empleado_id = v_emp and fecha = v_ayer;
  perform public.fn_recalcular_asistencia_empleado(v_emp, v_ayer);
  select count(*) into n from public.asistencia_diaria where empleado_id = v_emp and fecha = v_ayer;
  if n <> 0 then raise exception 'FALLO 5: la fila de asistencia no se borró'; end if;

  -- 6. El cajero no puede recalcular.
  perform pg_temp.como_usuario(v_caja);
  ok := false;
  begin
    perform public.fn_recalcular_asistencia_empleado(v_emp, v_ayer);
  exception when others then ok := true;
  end;
  if not ok then raise exception 'FALLO 6: el cajero pudo recalcular asistencia'; end if;

  perform set_config('role', 'none', true);
  raise notice '✔✔✔ RECALCULO OK';
end $$;

rollback;
