-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  PRUEBA · Agenda de tareas por turno (migraciones 251 a 253)        ║
-- ║                                                                     ║
-- ║  Pegar entero en el SQL Editor (menos de 200 líneas). Cubre:        ║
-- ║  materialización con hora / minutos desde inicio / continua,        ║
-- ║  idempotencia, edición de rutina con vigencia (pendiente se mueve,  ║
-- ║  completada no), cambio de horario del turno, permisos del          ║
-- ║  empleado (iniciar propia sí, ajena no, omitir sin motivo no,       ║
-- ║  reabrir no), traslado (mañana→tarde mismo día, noche→mañana +1),   ║
-- ║  reabrir/omitir de gestión. Termina en ROLLBACK: no deja nada.      ║
-- ║  Si pasa, la última línea de Messages dice "✔✔✔ AGENDA OK".         ║
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
  v_caja uuid := gen_random_uuid();
  v_e1 integer; v_e2 integer; v_e3 integer;
  v_man integer; v_tar integer; v_noc integer;
  v_p1 uuid := gen_random_uuid(); v_p2 uuid := gen_random_uuid();
  v_p3 uuid := gen_random_uuid(); v_p4 uuid := gen_random_uuid();
  v_hoy date := (timezone('America/Argentina/Buenos_Aires', now()))::date;
  n1 int; n2 int; n3 int; v uuid; v_man_id uuid; nuevo uuid; ok boolean;
  v_ini_man time; v_fin_man time;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
    updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
         u.email, 'x', now(), '{"provider":"email","providers":["email"]}', '{}',
         now(), now(), '', '', '', ''
    from (values (v_admin, 'test.agenda.admin@test.local'),
                 (v_caja, 'test.agenda.caja@test.local')) as u(id, email);
  insert into public.roles (codigo, nombre, es_sistema, permisos)
  values ('test_agenda_caja', 'TEST Caja', false, array['mi_panel'])
  on conflict (codigo) do update set permisos = excluded.permisos;
  insert into public.usuarios (id, email, nombre, rol, activo) values
    (v_admin, 'test.agenda.admin@test.local', 'TEST Admin', 'admin', true),
    (v_caja, 'test.agenda.caja@test.local', 'TEST Caja', 'test_agenda_caja', true)
  on conflict (id) do update set rol = excluded.rol, activo = true;
  insert into public.empleados (legajo, nombre, apellido, usuario_id, rol_operativo, activo)
    values ('TAG-1', 'TEST Camila', 'A', v_caja, 'cajero', true) returning id into v_e1;
  insert into public.empleados (legajo, nombre, apellido, rol_operativo, activo)
    values ('TAG-2', 'TEST Sonia', 'A', 'encargado', true) returning id into v_e2;
  insert into public.empleados (legajo, nombre, apellido, rol_operativo, activo)
    values ('TAG-3', 'TEST Noe', 'A', 'cajero', true) returning id into v_e3;
  select id, hora_inicio, hora_fin into v_man, v_ini_man, v_fin_man from public.turnos_plantilla where nombre = 'manana';
  select id into v_tar from public.turnos_plantilla where nombre = 'tarde';
  select id into v_noc from public.turnos_plantilla where nombre = 'noche';

  perform pg_temp.como_usuario(v_admin);

  -- Cronograma: Camila a la mañana, Noe a la noche, hoy y mañana.
  insert into public.horarios_asignados (empleado_id, turno_id, fecha, estado)
  select v_e1, v_man, d, 'planificado' from generate_series(v_hoy, v_hoy + 1, interval '1 day') d
  on conflict (empleado_id, fecha) do update set turno_id = excluded.turno_id, estado = 'planificado';
  insert into public.horarios_asignados (empleado_id, turno_id, fecha, estado)
  select v_e3, v_noc, d, 'planificado' from generate_series(v_hoy, v_hoy + 1, interval '1 day') d
  on conflict (empleado_id, fecha) do update set turno_id = excluded.turno_id, estado = 'planificado';

  -- Plantillas de prueba asignadas a personas fijas (no interfieren con las reales por puesto).
  insert into public.tareas_recurrentes (id, titulo, turno_id, dias_semana, alcance, modo, hora, duracion_min, ventana_min)
    values (v_p1, 'TEST Producción', v_man, '{0,1,2,3,4,5,6}', 'empleados', 'individual', '07:20', 40, 60);
  insert into public.tareas_recurrentes (id, titulo, turno_id, dias_semana, alcance, modo, minutos_desde_inicio, duracion_min)
    values (v_p2, 'TEST Recibir turno', v_man, '{0,1,2,3,4,5,6}', 'empleados', 'individual', 0, 15);
  insert into public.tareas_recurrentes (id, titulo, turno_id, dias_semana, alcance, modo, tipo_actividad)
    values (v_p3, 'TEST Atención', v_man, '{0,1,2,3,4,5,6}', 'empleados', 'grupal', 'continua');
  insert into public.tareas_recurrentes (id, titulo, turno_id, dias_semana, alcance, modo, hora, duracion_min)
    values (v_p4, 'TEST Limpieza nocturna', v_noc, '{0,1,2,3,4,5,6}', 'empleados', 'individual', '01:00', 30);
  insert into public.tareas_recurrentes_asignados (plantilla_id, empleado_id) values
    (v_p1, v_e1), (v_p2, v_e1), (v_p3, v_e1), (v_p4, v_e3);

  -- A. Materialización e idempotencia (solo contamos las de prueba).
  perform public.fn_materializar_tareas_turno(v_hoy);
  select count(*) into n1 from public.tareas_turno where plantilla_id in (v_p1, v_p2, v_p3, v_p4) and fecha = v_hoy;
  perform public.fn_materializar_tareas_turno(v_hoy);
  select count(*) into n2 from public.tareas_turno where plantilla_id in (v_p1, v_p2, v_p3, v_p4) and fecha = v_hoy;
  perform public.fn_materializar_tareas_turno(v_hoy + 1);
  select count(*) into n3 from public.tareas_turno where plantilla_id in (v_p1, v_p2, v_p3, v_p4) and fecha = v_hoy + 1;
  if n1 <> 4 or n2 <> 4 or n3 <> 4 then
    raise exception 'PRUEBA FALLÓ: A esperaba 4/4/4 instancias, dio %/%/%', n1, n2, n3;
  end if;
  if (select hora from public.tareas_turno where plantilla_id = v_p2 and fecha = v_hoy) <> v_ini_man then
    raise exception 'PRUEBA FALLÓ: A minutos_desde_inicio no resolvió la hora del turno';
  end if;
  if (select tipo_actividad from public.tareas_turno where plantilla_id = v_p3 and fecha = v_hoy) <> 'continua' then
    raise exception 'PRUEBA FALLÓ: A tipo_actividad no se copió';
  end if;
  raise notice 'OK · A materialización + idempotencia';

  -- B. Completar hoy, editar la rutina: la pendiente de mañana se mueve, la completada no.
  select id into v from public.tareas_turno where plantilla_id = v_p1 and fecha = v_hoy;
  select id into v_man_id from public.tareas_turno where plantilla_id = v_p1 and fecha = v_hoy + 1;
  perform public.fn_completar_tarea(v);
  update public.tareas_recurrentes set hora = '08:00', titulo = 'TEST Producción v2', vigencia_desde = v_hoy where id = v_p1;
  perform public.fn_materializar_tareas_turno(v_hoy);
  perform public.fn_materializar_tareas_turno(v_hoy + 1);
  if (select hora from public.tareas_turno where id = v) <> '07:20'::time or (select estado from public.tareas_turno where id = v) <> 'completada' then
    raise exception 'PRUEBA FALLÓ: B la completada fue modificada';
  end if;
  if (select hora from public.tareas_turno where id = v_man_id) <> '08:00'::time or (select titulo from public.tareas_turno where id = v_man_id) <> 'TEST Producción v2' then
    raise exception 'PRUEBA FALLÓ: B la pendiente de mañana no tomó la rutina nueva';
  end if;
  raise notice 'OK · B vigencia de la rutina';

  -- C. Cambiar el horario del turno mueve la tarea "desde el inicio".
  update public.turnos_plantilla set hora_inicio = v_ini_man + interval '1 hour' where id = v_man;
  perform public.fn_materializar_tareas_turno(v_hoy + 1);
  if (select hora from public.tareas_turno where plantilla_id = v_p2 and fecha = v_hoy + 1) <> v_ini_man + interval '1 hour' then
    raise exception 'PRUEBA FALLÓ: C el cambio de turno no movió la tarea';
  end if;
  update public.turnos_plantilla set hora_inicio = v_ini_man where id = v_man;
  raise notice 'OK · C horario de turno';

  -- D. Empleado: inicia la propia, no la ajena; no omite sin motivo; no reabre.
  perform pg_temp.como_usuario(v_caja);
  select id into v from public.tareas_turno where plantilla_id = v_p2 and fecha = v_hoy;
  perform public.fn_iniciar_tarea(v);
  if (select estado from public.tareas_turno where id = v) <> 'en_curso' or (select iniciada_por from public.tareas_turno where id = v) <> v_e1 then
    raise exception 'PRUEBA FALLÓ: D iniciar';
  end if;
  ok := false;
  begin perform public.fn_iniciar_tarea((select id from public.tareas_turno where plantilla_id = v_p4 and fecha = v_hoy)); exception when others then ok := true; end;
  if not ok then raise exception 'PRUEBA FALLÓ: D pudo iniciar una ajena'; end if;
  ok := false;
  begin perform public.fn_omitir_tarea(v, 'x'); exception when others then ok := true; end;
  if not ok then raise exception 'PRUEBA FALLÓ: D omitió sin motivo'; end if;
  ok := false;
  begin perform public.fn_reabrir_tarea(v); exception when others then ok := true; end;
  if not ok then raise exception 'PRUEBA FALLÓ: D el empleado pudo reabrir'; end if;
  raise notice 'OK · D permisos del empleado';

  -- E. La en curso no la toca la rutina (paso 2b).
  perform pg_temp.como_usuario(v_admin);
  update public.tareas_recurrentes set hora = '06:30' where id = v_p2;
  perform public.fn_materializar_tareas_turno(v_hoy);
  if (select hora from public.tareas_turno where id = v) <> v_ini_man then
    raise exception 'PRUEBA FALLÓ: E la en curso fue modificada';
  end if;
  raise notice 'OK · E en curso intacta';

  -- F. Traslado: mañana → tarde (mismo día); noche → mañana (día +1); no se recrea.
  nuevo := public.fn_trasladar_tarea(v);
  if (select estado from public.tareas_turno where id = v) <> 'cancelada' or (select trasladada_a from public.tareas_turno where id = v) <> nuevo then
    raise exception 'PRUEBA FALLÓ: F original sin cancelar/enlazar';
  end if;
  if (select fecha from public.tareas_turno where id = nuevo) <> v_hoy or (select turno_id from public.tareas_turno where id = nuevo) <> v_tar then
    raise exception 'PRUEBA FALLÓ: F traslado de mañana no fue a tarde del mismo día';
  end if;
  select id into v from public.tareas_turno where plantilla_id = v_p4 and fecha = v_hoy;
  nuevo := public.fn_trasladar_tarea(v);
  if (select fecha from public.tareas_turno where id = nuevo) <> v_hoy + 1 or (select turno_id from public.tareas_turno where id = nuevo) <> v_man then
    raise exception 'PRUEBA FALLÓ: F traslado de noche no fue a mañana del día siguiente';
  end if;
  perform public.fn_materializar_tareas_turno(v_hoy);
  if (select count(*) from public.tareas_turno where plantilla_id = v_p2 and fecha = v_hoy) <> 1 then
    raise exception 'PRUEBA FALLÓ: F materializar recreó la trasladada';
  end if;
  raise notice 'OK · F traslado con trazabilidad';

  -- G. Gestión reabre y omite con motivo.
  select id into v from public.tareas_turno where plantilla_id = v_p1 and fecha = v_hoy;
  perform public.fn_reabrir_tarea(v);
  if (select estado from public.tareas_turno where id = v) <> 'pendiente' then raise exception 'PRUEBA FALLÓ: G reabrir'; end if;
  perform public.fn_omitir_tarea(v, 'TEST sin insumos');
  if (select estado from public.tareas_turno where id = v) <> 'cancelada' then raise exception 'PRUEBA FALLÓ: G omitir'; end if;
  raise notice 'OK · G reabrir / omitir';

  raise notice '';
  raise notice '✔✔✔ AGENDA OK (rollback aplicado)';
end;
$$;

rollback;
