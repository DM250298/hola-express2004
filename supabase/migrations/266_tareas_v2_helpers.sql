-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  266 · Tareas v2: funciones de base                                  ║
-- ║  (Etapa 1 · bloque C)                                                ║
-- ║                                                                     ║
-- ║  Internas (la app no las llama):                                     ║
-- ║   · fn_tareas_hoy(): fecha de hoy en La Rioja.                       ║
-- ║   · fn_tarea_inicio_turno / fn_tarea_fin_turno(fecha, turno): la     ║
-- ║     noche que empieza el lunes termina el martes.                    ║
-- ║   · fn_tarea_rango(fecha, turno, hora, duración): inicio y fin       ║
-- ║     absolutos de una tarea (sin hora = todo el turno).               ║
-- ║   · fn_tareas_actor(): quién está operando (usuario, legajo, si es   ║
-- ║     gestión o administrador).                                        ║
-- ║   · fn_tarea_evento(...): ÚNICO escritor del registro de cambios. El ║
-- ║     actor sale siempre de la sesión, nunca de un parámetro.          ║
-- ║                                                                     ║
-- ║  No cambia nada visible. Requiere 260 y 264. Se puede correr de nuevo.║
-- ║  Última línea del archivo: "notify pgrst, 'reload schema';"          ║
-- ╚════════════════════════════════════════════════════════════════════╝

do $$
begin
  if to_regclass('public.tareas_eventos') is null
     or to_regprocedure('public.fn_sesion_es_sistema()') is null then
    raise exception '266: faltan la 260 o la 264.';
  end if;
end $$;

create or replace function public.fn_tareas_hoy()
returns date language sql stable as $$
  select (now() at time zone 'America/Argentina/La_Rioja')::date
$$;

-- Inicio del turno que EMPIEZA en p_fecha. Sin turno: 00:00 de ese día.
create or replace function public.fn_tarea_inicio_turno(p_fecha date, p_turno_id integer)
returns timestamptz language sql stable set search_path = public as $$
  select coalesce(
    (select (p_fecha + tp.hora_inicio) at time zone 'America/Argentina/La_Rioja'
       from public.turnos_plantilla tp where tp.id = p_turno_id),
    p_fecha::timestamp at time zone 'America/Argentina/La_Rioja')
$$;

-- Fin del turno que empieza en p_fecha (la noche termina al día siguiente).
-- Sin turno: 00:00 del día siguiente.
create or replace function public.fn_tarea_fin_turno(p_fecha date, p_turno_id integer)
returns timestamptz language sql stable set search_path = public as $$
  select coalesce(
    (select ((p_fecha + case when tp.cruza_medianoche then 1 else 0 end) + tp.hora_fin)
              at time zone 'America/Argentina/La_Rioja'
       from public.turnos_plantilla tp where tp.id = p_turno_id),
    (p_fecha + 1)::timestamp at time zone 'America/Argentina/La_Rioja')
$$;

-- Inicio y fin absolutos de una tarea. Una hora menor que el inicio de un
-- turno que cruza medianoche es del día siguiente (01:00 de la noche del
-- lunes = martes 01:00). Sin hora: todo el turno. Sin duración: 30 min.
create or replace function public.fn_tarea_rango(
  p_fecha date, p_turno_id integer, p_hora time, p_duracion_min integer,
  out inicio_at timestamptz, out fin_at timestamptz)
language plpgsql stable set search_path = public as $$
declare v_tp record;
begin
  if p_hora is null then
    inicio_at := public.fn_tarea_inicio_turno(p_fecha, p_turno_id);
    fin_at := public.fn_tarea_fin_turno(p_fecha, p_turno_id);
    return;
  end if;
  select hora_inicio, cruza_medianoche into v_tp from public.turnos_plantilla where id = p_turno_id;
  inicio_at := ((p_fecha + case when v_tp.cruza_medianoche and p_hora < v_tp.hora_inicio
                                then 1 else 0 end) + p_hora)
               at time zone 'America/Argentina/La_Rioja';
  fin_at := inicio_at + make_interval(mins => coalesce(p_duracion_min, 30));
end;
$$;

-- Quién opera. Sin sesión (sistema): todo null y sin permisos.
create or replace function public.fn_tareas_actor(
  out usuario_id uuid, out empleado_id integer, out nombre text,
  out es_gestion boolean, out es_admin boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  usuario_id := auth.uid();
  if usuario_id is null then
    es_gestion := false; es_admin := false;
    return;
  end if;
  select e.id into empleado_id from public.empleados e where e.usuario_id = auth.uid();
  select u.nombre into nombre from public.usuarios u where u.id = auth.uid();
  es_admin := public.fn_tiene_permiso('tareas_admin');
  es_gestion := es_admin or public.fn_tiene_permiso('tareas_gestion');
end;
$$;

-- Único escritor del registro. Saca la "foto del momento" de la tarea o de
-- la plantilla y el actor de la sesión. Si quien marca no es dueño de la
-- tarea, queda en en_nombre_de.
create or replace function public.fn_tarea_evento(
  p_tipo public.tarea_evento_tipo,
  p_tarea_turno_id uuid default null,
  p_tarea_recurrente_id uuid default null,
  p_antes jsonb default null,
  p_despues jsonb default null,
  p_motivo text default null,
  p_origen text default null,
  p_pedido_id bigint default null,
  p_turno_id integer default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_actor record;
  v_duenos integer[] := '{}';
  v_entidad text;
  v_fecha date;
  v_titulo text;
  v_privada boolean;
  v_plantilla uuid;
  v_turno integer;
  v_empleado integer;
begin
  select * into v_actor from public.fn_tareas_actor();
  if p_tarea_turno_id is not null then
    select t.fecha, t.titulo, t.privada, t.plantilla_id, t.turno_id, t.empleado_id
      into v_fecha, v_titulo, v_privada, v_plantilla, v_turno, v_empleado
      from public.tareas_turno t where t.id = p_tarea_turno_id;
    v_duenos := case when v_empleado is not null then array[v_empleado]
                     else coalesce((select array_agg(p.empleado_id order by p.empleado_id)
                                      from public.tareas_turno_participantes p
                                     where p.tarea_id = p_tarea_turno_id), '{}') end;
    v_entidad := 'agenda';
  elsif p_tarea_recurrente_id is not null then
    select r.titulo, r.privada, r.turno_id into v_titulo, v_privada, v_turno
      from public.tareas_recurrentes r where r.id = p_tarea_recurrente_id;
    v_entidad := 'rutina';
  elsif p_pedido_id is not null then
    v_entidad := 'pedido';
  elsif p_turno_id is not null then
    v_entidad := 'turno';
  else
    v_entidad := 'sistema';
  end if;

  insert into public.tareas_eventos (
    entidad, tipo, tarea_turno_id, tarea_recurrente_id, pedido_id, turno_id,
    fecha, titulo, privada, duenos,
    actor_usuario_id, actor_empleado_id, actor_nombre, en_nombre_de,
    antes, despues, motivo, origen)
  values (
    v_entidad, p_tipo, p_tarea_turno_id, coalesce(p_tarea_recurrente_id, v_plantilla),
    p_pedido_id, coalesce(p_turno_id, v_turno),
    v_fecha, v_titulo, coalesce(v_privada, false), v_duenos,
    v_actor.usuario_id, v_actor.empleado_id, coalesce(v_actor.nombre, 'HEX'),
    case when p_tipo in ('iniciada', 'completada', 'no_se_pudo', 'hora_corregida', 'rechazada')
              and v_actor.usuario_id is not null
              and (v_actor.empleado_id is null or not (v_actor.empleado_id = any(v_duenos)))
         then v_duenos else '{}' end,
    p_antes, p_despues, p_motivo, p_origen);
end;
$$;

revoke execute on function public.fn_tareas_hoy() from public, anon;
-- Cálculos puros: los usa el trigger de tareas_turno también en las
-- escrituras directas de la app vieja (hasta el cierre), por eso authenticated.
revoke execute on function public.fn_tarea_inicio_turno(date, integer) from public, anon;
revoke execute on function public.fn_tarea_fin_turno(date, integer) from public, anon;
revoke execute on function public.fn_tarea_rango(date, integer, time, integer) from public, anon;
grant execute on function public.fn_tarea_inicio_turno(date, integer) to authenticated, service_role;
grant execute on function public.fn_tarea_fin_turno(date, integer) to authenticated, service_role;
grant execute on function public.fn_tarea_rango(date, integer, time, integer) to authenticated, service_role;
revoke execute on function public.fn_tareas_actor() from public, anon, authenticated;
revoke execute on function public.fn_tarea_evento(public.tarea_evento_tipo, uuid, uuid, jsonb, jsonb, text, text, bigint, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.fn_tareas_hoy() to authenticated, service_role;

do $$
begin
  if to_regprocedure('public.fn_tarea_evento(public.tarea_evento_tipo,uuid,uuid,jsonb,jsonb,text,text,bigint,integer)') is null
     or to_regprocedure('public.fn_tarea_rango(date,integer,time,integer)') is null
     or to_regprocedure('public.fn_tareas_actor()') is null then
    raise exception '266: faltan funciones.';
  end if;
  if has_function_privilege('authenticated',
       'public.fn_tarea_evento(public.tarea_evento_tipo,uuid,uuid,jsonb,jsonb,text,text,bigint,integer)', 'EXECUTE') then
    raise exception '266: fn_tarea_evento quedó ejecutable desde la app.';
  end if;
end $$;

notify pgrst, 'reload schema';
