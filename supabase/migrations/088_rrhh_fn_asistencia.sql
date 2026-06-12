-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 088 · RRHH Sprint 2 — Funciones de asistencia            ║
-- ║                                                                     ║
-- ║  Toda la lógica de cálculo. Las tablas y el PIN están en la 087.    ║
-- ║                                                                     ║
-- ║   • fn_recalcular_asistencia(emp, fecha) — EL CORAZÓN. Empareja     ║
-- ║     primera/última marcación del día, resuelve turno noche (imputa  ║
-- ║     al día D), anti-rebote <3min, tardanza vs tolerancia, horas     ║
-- ║     extra (50% hábil / 100% domingo). Estados: presente, tardanza,  ║
-- ║     incompleto (impar), sin_turno, ausente_injustificado, franco,   ║
-- ║     licencia.                                                        ║
-- ║   • fn_importar_fichajes(import_id, marcaciones) — fuente principal ║
-- ║     (reloj). Matchea por reloj_id, inserta idempotente, recalcula   ║
-- ║     los días afectados (+ el anterior por turno noche).             ║
-- ║   • fn_registrar_fichaje(id, emp, pin, tipo, origen, momento) —     ║
-- ║     kiosco/manual. Idempotente por id (client uuid).                ║
-- ║   • fn_cerrar_dia_asistencia(fecha) — marca ausentes.               ║
-- ║   • fn_corregir_fichaje / fn_anular_fichaje — corrección manual.    ║
-- ║                                                                     ║
-- ║  TZ fija America/Argentina/Buenos_Aires (sin DST → UTC-3).          ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─── fn_recalcular_asistencia ────────────────────────────────────────────
create or replace function public.fn_recalcular_asistencia(
  p_empleado_id integer,
  p_fecha date
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_tz text := 'America/Argentina/Buenos_Aires';
  v_estado_hor public.estado_horario;
  v_turno_id integer;
  v_hora_ini time;
  v_hora_fin time;
  v_cruza boolean := false;
  v_tol integer := 0;
  v_win_ini timestamptz;
  v_win_fin timestamptz;
  v_ini_prog timestamptz;
  v_fin_prog timestamptz;
  v_corte_noche timestamptz := null;  -- cola del turno noche de D-1 que invade D
  v_punches timestamptz[];
  v_filt timestamptz[] := '{}';
  v_p timestamptz;
  v_last timestamptz := null;
  v_n integer;
  v_entrada timestamptz := null;
  v_salida timestamptz := null;
  v_min_trab integer := 0;
  v_min_tard integer := 0;
  v_min_turno integer;
  v_extra_min integer := 0;
  v_he50 numeric := 0;
  v_he100 numeric := 0;
  v_estado public.estado_asistencia;
  v_marc integer := 0;
  v_do_delete boolean := false;
begin
  -- 1. Horario planificado del día (+ datos del turno).
  -- left join: un día franco/licencia puede no tener turno (turno_id null).
  select h.estado, h.turno_id, t.hora_inicio, t.hora_fin, t.cruza_medianoche, t.tolerancia_min
    into v_estado_hor, v_turno_id, v_hora_ini, v_hora_fin, v_cruza, v_tol
    from public.horarios_asignados h
    left join public.turnos_plantilla t on t.id = h.turno_id
    where h.empleado_id = p_empleado_id and h.fecha = p_fecha;

  v_cruza := coalesce(v_cruza, false);
  v_tol := coalesce(v_tol, 0);

  -- Si el día ANTERIOR fue turno noche que cruza a hoy, su cola llega hasta
  -- hora_fin + 3h de HOY. Esos punches ya se imputaron a D-1; hay que excluirlos
  -- de la ventana de D para no crear un día fantasma (ej: salida 06:10 del lunes
  -- no debe contar como marcación del lunes si la noche es del domingo).
  select timezone(v_tz, (p_fecha::text || ' ' || t.hora_fin::text)::timestamp) + interval '3 hours'
    into v_corte_noche
    from public.horarios_asignados h
    join public.turnos_plantilla t on t.id = h.turno_id
    where h.empleado_id = p_empleado_id and h.fecha = p_fecha - 1
      and t.cruza_medianoche = true;

  -- 2. Franco / licencia: estado directo, sin cálculo.
  if v_estado_hor = 'franco' then
    v_estado := 'franco';
  elsif v_estado_hor = 'licencia' then
    v_estado := 'licencia';
  else
    -- 3. Ventana de marcaciones según el turno.
    if v_cruza then
      -- Turno noche: desde 2h antes del inicio (día D) hasta hora_fin + 3h de D+1.
      v_ini_prog := timezone(v_tz, (p_fecha::text || ' ' || v_hora_ini::text)::timestamp);
      v_fin_prog := timezone(v_tz, ((p_fecha + 1)::text || ' ' || v_hora_fin::text)::timestamp);
      v_win_ini  := v_ini_prog - interval '2 hours';
      v_win_fin  := v_fin_prog + interval '3 hours';
    elsif v_turno_id is not null then
      v_ini_prog := timezone(v_tz, (p_fecha::text || ' ' || v_hora_ini::text)::timestamp);
      v_fin_prog := timezone(v_tz, (p_fecha::text || ' ' || v_hora_fin::text)::timestamp);
      v_win_ini  := greatest(
        timezone(v_tz, (p_fecha::text || ' 00:00')::timestamp),
        coalesce(v_corte_noche, timezone(v_tz, (p_fecha::text || ' 00:00')::timestamp))
      );
      v_win_fin  := timezone(v_tz, ((p_fecha + 1)::text || ' 00:00')::timestamp);
    else
      -- Sin turno planificado: día calendario completo (recortado si D-1 fue noche).
      v_win_ini := greatest(
        timezone(v_tz, (p_fecha::text || ' 00:00')::timestamp),
        coalesce(v_corte_noche, timezone(v_tz, (p_fecha::text || ' 00:00')::timestamp))
      );
      v_win_fin := timezone(v_tz, ((p_fecha + 1)::text || ' 00:00')::timestamp);
    end if;

    -- 4. Marcaciones de la ventana, excluyendo las anuladas por 'correccion'.
    select array_agg(f.momento order by f.momento)
      into v_punches
      from public.fichajes f
      where f.empleado_id = p_empleado_id
        and f.tipo in ('entrada', 'salida', 'marcacion')
        and f.momento >= v_win_ini and f.momento < v_win_fin
        and not exists (
          select 1 from public.fichajes c
          where c.tipo = 'correccion' and c.fichaje_corregido_id = f.id
        );

    -- 5. Anti-rebote: colapsar marcaciones a < 3 minutos.
    foreach v_p in array coalesce(v_punches, array[]::timestamptz[]) loop
      if v_last is null or v_p - v_last >= interval '3 minutes' then
        v_filt := v_filt || v_p;
        v_last := v_p;
      end if;
    end loop;
    v_punches := v_filt;
    v_n := coalesce(array_length(v_punches, 1), 0);
    v_marc := v_n;

    if v_n = 0 then
      -- Sin marcaciones: ausente si tenía turno y el día ya pasó; si no, no hay fila.
      if v_turno_id is not null and p_fecha < (timezone(v_tz, now()))::date then
        v_estado := 'ausente_injustificado';
      else
        v_do_delete := true;
      end if;
    elsif v_n = 1 then
      v_entrada := v_punches[1];
      v_estado := 'incompleto';
    else
      v_entrada := v_punches[1];
      v_salida := v_punches[v_n];
      v_min_trab := round(extract(epoch from (v_salida - v_entrada)) / 60.0)::int;

      if v_ini_prog is not null then
        v_min_tard := greatest(
          0,
          round(extract(epoch from (v_entrada - (v_ini_prog + make_interval(mins => v_tol)))) / 60.0)::int
        );
        v_min_turno := round(extract(epoch from (v_fin_prog - v_ini_prog)) / 60.0)::int;
        v_extra_min := greatest(0, v_min_trab - v_min_turno);
        if extract(dow from p_fecha) = 0 then       -- domingo → 100%
          v_he100 := round(v_extra_min / 60.0, 2);
        else                                          -- (feriados → 100% cuando haya tabla)
          v_he50 := round(v_extra_min / 60.0, 2);
        end if;
      end if;

      if v_turno_id is null then
        v_estado := 'sin_turno';
      elsif v_min_tard > 0 then
        v_estado := 'tardanza';
      else
        v_estado := 'presente';
      end if;
    end if;
  end if;

  -- 6. Persistir (o borrar si no hubo nada).
  if v_do_delete then
    delete from public.asistencia_diaria
      where empleado_id = p_empleado_id and fecha = p_fecha;
    return;
  end if;

  insert into public.asistencia_diaria (
    empleado_id, fecha, turno_id, entrada_real, salida_real,
    minutos_trabajados, minutos_tardanza, horas_extra_50, horas_extra_100,
    estado, marcaciones, updated_at
  ) values (
    p_empleado_id, p_fecha, v_turno_id, v_entrada, v_salida,
    coalesce(v_min_trab, 0), coalesce(v_min_tard, 0), coalesce(v_he50, 0), coalesce(v_he100, 0),
    v_estado, coalesce(v_marc, 0), now()
  )
  on conflict (empleado_id, fecha) do update set
    turno_id = excluded.turno_id,
    entrada_real = excluded.entrada_real,
    salida_real = excluded.salida_real,
    minutos_trabajados = excluded.minutos_trabajados,
    minutos_tardanza = excluded.minutos_tardanza,
    horas_extra_50 = excluded.horas_extra_50,
    horas_extra_100 = excluded.horas_extra_100,
    estado = excluded.estado,
    marcaciones = excluded.marcaciones,
    updated_at = now();
end $$;
revoke execute on function public.fn_recalcular_asistencia(integer, date) from public;

-- ─── fn_importar_fichajes ────────────────────────────────────────────────
create or replace function public.fn_importar_fichajes(
  p_import_id uuid,
  p_marcaciones jsonb   -- [{ "reloj_id": int, "momento": "2026-03-01T07:05:00-03:00" }, ...]
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_tz text := 'America/Argentina/Buenos_Aires';
  v_item jsonb;
  v_reloj integer;
  v_momento timestamptz;
  v_emp_id integer;
  v_nuevas integer := 0;
  v_dup integer := 0;
  v_rc integer;
  v_sin_match integer[] := '{}';
  v_dias text[] := '{}';
  v_pair text;
  v_fecha date;
  v_n_dias integer := 0;
begin
  -- Sólo RRHH importa (la función es SECURITY DEFINER → bypassa RLS; sin este
  -- guard cualquier autenticado podría falsificar fichajes vía rpc).
  if not public.fn_tiene_permiso('rrhh') then
    raise exception 'Sin permiso.';
  end if;
  -- El import_id debe existir (lo crea el cliente con RLS gateada antes de llamar).
  if not exists (select 1 from public.importaciones_fichajes where id = p_import_id) then
    raise exception 'Importación inexistente.';
  end if;

  for v_item in select * from jsonb_array_elements(p_marcaciones) loop
    v_reloj := (v_item->>'reloj_id')::integer;
    v_momento := (v_item->>'momento')::timestamptz;

    select id into v_emp_id from public.empleados where reloj_id = v_reloj;
    if v_emp_id is null then
      if not (v_reloj = any(v_sin_match)) then
        v_sin_match := v_sin_match || v_reloj;
      end if;
      continue;
    end if;

    insert into public.fichajes (empleado_id, tipo, momento, origen, import_id)
    values (v_emp_id, 'marcacion', v_momento, 'import_reloj', p_import_id)
    on conflict (empleado_id, momento) where origen = 'import_reloj' do nothing;
    get diagnostics v_rc = row_count;
    if v_rc > 0 then v_nuevas := v_nuevas + 1; else v_dup := v_dup + 1; end if;

    -- Días afectados: el del momento y el anterior (turno noche).
    v_fecha := timezone(v_tz, v_momento)::date;
    v_pair := v_emp_id::text || '|' || v_fecha::text;
    if not (v_pair = any(v_dias)) then v_dias := v_dias || v_pair; end if;
    v_pair := v_emp_id::text || '|' || (v_fecha - 1)::text;
    if not (v_pair = any(v_dias)) then v_dias := v_dias || v_pair; end if;
  end loop;

  -- Recalcular cada (empleado, fecha) afectado.
  foreach v_pair in array v_dias loop
    perform public.fn_recalcular_asistencia(
      split_part(v_pair, '|', 1)::integer,
      split_part(v_pair, '|', 2)::date
    );
    v_n_dias := v_n_dias + 1;
  end loop;

  update public.importaciones_fichajes set
    total_marcaciones = jsonb_array_length(p_marcaciones),
    nuevas = v_nuevas,
    duplicadas = v_dup,
    sin_match = coalesce(array_length(v_sin_match, 1), 0),
    dias_recalculados = v_n_dias,
    estado = 'completada'
  where id = p_import_id;

  return jsonb_build_object(
    'nuevas', v_nuevas,
    'duplicadas', v_dup,
    'sin_match', coalesce(array_length(v_sin_match, 1), 0),
    'relojes_sin_match', (select coalesce(jsonb_agg(x), '[]'::jsonb) from unnest(v_sin_match) x),
    'dias_recalculados', v_n_dias
  );
end $$;
grant execute on function public.fn_importar_fichajes(uuid, jsonb) to authenticated;

-- ─── fn_registrar_fichaje (kiosco / manual) ──────────────────────────────
create or replace function public.fn_registrar_fichaje(
  p_id uuid,
  p_empleado_id integer,
  p_pin text,
  p_tipo public.tipo_fichaje default 'marcacion',
  p_origen public.origen_fichaje default 'kiosco',
  p_momento timestamptz default now()
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_tz text := 'America/Argentina/Buenos_Aires';
  v_emp record;
  v_fecha date;
  v_tipo public.tipo_fichaje;
  v_cnt integer;
  v_rc integer;
begin
  -- Función EXCLUSIVA del kiosco: SIEMPRE exige PIN e ignora p_origen del cliente
  -- (se fuerza 'kiosco'). Las altas/correcciones manuales del admin van por
  -- fn_corregir_fichaje / fn_anular_fichaje (gateadas por permiso 'rrhh').
  select e.id, e.nombre, e.apellido, e.foto_url, e.activo into v_emp
    from public.empleados e where e.id = p_empleado_id;
  -- Mensaje genérico: no distinguir empleado inexistente/baja de PIN malo.
  if v_emp.id is null or not v_emp.activo then
    raise exception 'PIN incorrecto.';
  end if;
  if not public.fn_validar_pin(p_empleado_id, p_pin) then
    raise exception 'PIN incorrecto.';
  end if;

  -- Tipo autodetectado por paridad en la ventana del turno (~14h), no por día
  -- calendario: así la salida post-medianoche del turno noche es 'salida' y no
  -- reinicia la paridad a las 00:00.
  select count(*) into v_cnt from public.fichajes f
    where f.empleado_id = p_empleado_id
      and f.tipo in ('entrada', 'salida', 'marcacion')
      and f.momento >= p_momento - interval '14 hours'
      and f.momento <  p_momento;
  v_tipo := case when v_cnt % 2 = 0 then 'entrada' else 'salida' end;

  -- Idempotencia robusta a concurrencia (cola offline multi-pestaña):
  insert into public.fichajes (id, empleado_id, tipo, momento, origen, usuario_id)
  values (p_id, p_empleado_id, v_tipo, p_momento, 'kiosco', null)
  on conflict (id) do nothing;
  get diagnostics v_rc = row_count;

  if v_rc = 0 then
    -- Ya estaba registrado (reintento o carrera): devolver benigno, sin recalcular.
    return jsonb_build_object('ya_registrado', true, 'empleado_id', p_empleado_id,
      'nombre', v_emp.nombre, 'apellido', v_emp.apellido, 'foto_url', v_emp.foto_url);
  end if;

  v_fecha := timezone(v_tz, p_momento)::date;
  perform public.fn_recalcular_asistencia(p_empleado_id, v_fecha);
  perform public.fn_recalcular_asistencia(p_empleado_id, v_fecha - 1);

  return jsonb_build_object('ya_registrado', false, 'empleado_id', p_empleado_id,
    'nombre', v_emp.nombre, 'apellido', v_emp.apellido, 'foto_url', v_emp.foto_url,
    'tipo', v_tipo, 'momento', p_momento);
end $$;
grant execute on function public.fn_registrar_fichaje(uuid, integer, text, public.tipo_fichaje, public.origen_fichaje, timestamptz) to authenticated;

-- ─── fn_cerrar_dia_asistencia ────────────────────────────────────────────
create or replace function public.fn_cerrar_dia_asistencia(p_fecha date)
returns integer language plpgsql security definer set search_path = public as $$
declare v_emp integer; v_n integer := 0;
begin
  -- El cron la llama con service_role (auth.uid() null → pasa). Un usuario
  -- autenticado debe tener permiso 'rrhh' (un cajero NO puede forzar cierres).
  if auth.uid() is not null and not public.fn_tiene_permiso('rrhh') then
    raise exception 'Sin permiso.';
  end if;
  for v_emp in
    select empleado_id from public.horarios_asignados
    where fecha = p_fecha and estado in ('planificado', 'cubierto')
  loop
    perform public.fn_recalcular_asistencia(v_emp, p_fecha);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke execute on function public.fn_cerrar_dia_asistencia(date) from public;
grant execute on function public.fn_cerrar_dia_asistencia(date) to authenticated, service_role;

-- ─── Corrección manual de fichajes (motivo obligatorio) ──────────────────
create or replace function public.fn_corregir_fichaje(
  p_empleado_id integer,
  p_momento timestamptz,
  p_tipo public.tipo_fichaje,
  p_motivo text
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_tz text := 'America/Argentina/Buenos_Aires'; v_fecha date;
begin
  if not public.fn_tiene_permiso('rrhh') then raise exception 'Sin permiso.'; end if;
  if p_motivo is null or btrim(p_motivo) = '' then raise exception 'El motivo es obligatorio.'; end if;
  insert into public.fichajes (empleado_id, tipo, momento, origen, usuario_id, notas)
  values (p_empleado_id, coalesce(p_tipo, 'marcacion'), p_momento, 'manual_admin', auth.uid(), p_motivo)
  returning id into v_id;
  v_fecha := timezone(v_tz, p_momento)::date;
  perform public.fn_recalcular_asistencia(p_empleado_id, v_fecha);
  perform public.fn_recalcular_asistencia(p_empleado_id, v_fecha - 1);
  return v_id;
end $$;
grant execute on function public.fn_corregir_fichaje(integer, timestamptz, public.tipo_fichaje, text) to authenticated;

create or replace function public.fn_anular_fichaje(p_fichaje_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare v_f record; v_tz text := 'America/Argentina/Buenos_Aires'; v_fecha date;
begin
  if not public.fn_tiene_permiso('rrhh') then raise exception 'Sin permiso.'; end if;
  if p_motivo is null or btrim(p_motivo) = '' then raise exception 'El motivo es obligatorio.'; end if;
  select * into v_f from public.fichajes where id = p_fichaje_id;
  if v_f.id is null then raise exception 'Fichaje inexistente.'; end if;
  insert into public.fichajes (empleado_id, tipo, momento, origen, fichaje_corregido_id, usuario_id, notas)
  values (v_f.empleado_id, 'correccion', v_f.momento, 'manual_admin', p_fichaje_id, auth.uid(), p_motivo);
  v_fecha := timezone(v_tz, v_f.momento)::date;
  perform public.fn_recalcular_asistencia(v_f.empleado_id, v_fecha);
  perform public.fn_recalcular_asistencia(v_f.empleado_id, v_fecha - 1);
end $$;
grant execute on function public.fn_anular_fichaje(uuid, text) to authenticated;

-- ─── fn_tiene_pin (¿el empleado ya tiene PIN? — sin exponer el hash) ─────
create or replace function public.fn_tiene_pin(p_empleado_id integer)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.empleado_credencial where empleado_id = p_empleado_id
  )
$$;
grant execute on function public.fn_tiene_pin(integer) to authenticated;

notify pgrst, 'reload schema';
