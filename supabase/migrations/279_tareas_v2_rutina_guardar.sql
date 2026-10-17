-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  279 · Tareas v2: guardar la rutina (Etapa 1 · bloque F)            ║
-- ║                                                                     ║
-- ║   · fn_rutina_guardar(id, datos, aplicar, asignados): crea o edita   ║
-- ║     una tarea de la rutina. Encargada o admin.                       ║
-- ║      - aplicar = 'manana' (por defecto): hoy sigue la versión de     ║
-- ║        antes; 'hoy': rige desde hoy (solo en lo que nadie tocó).     ║
-- ║      - la hora se guarda como minutos desde el inicio del turno;     ║
-- ║        horario dentro del turno, duración mayor a 0.                 ║
-- ║      - recurrencia, vigencia y privada: solo el administrador.       ║
-- ║        Las privadas, solo el administrador.                          ║
-- ║      - evento "creada"/"editada" con antes y después.                ║
-- ║   · fn_rutina_resincronizar(desde): interna; vuelve a armar los días ║
-- ║     ya generados (hasta hoy + 7) con la versión vigente.             ║
-- ║                                                                     ║
-- ║  Los asignados fijos (alcance "empleados") cambian enseguida.        ║
-- ║  Requiere la 278. Se puede correr de nuevo.                          ║
-- ║  Última línea del archivo: "notify pgrst, 'reload schema';"          ║
-- ╚════════════════════════════════════════════════════════════════════╝

do $$
begin
  if to_regprocedure('public.fn_tarea_validar_horario(integer,time,integer)') is null then
    raise exception '279: falta la 276.';
  end if;
end $$;

create or replace function public.fn_rutina_version(r public.tareas_recurrentes)
returns jsonb language sql immutable as $$
  select to_jsonb(r) - array['id', 'created_at', 'updated_at', 'updated_by', 'cambios_desde',
                             'version_anterior', 'codigo', 'usuario_id']
$$;

create or replace function public.fn_rutina_resincronizar(p_desde date)
returns void language plpgsql security definer set search_path = public as $$
declare d date;
begin
  for d in select g::date from generate_series(p_desde, public.fn_tareas_hoy() + 7, interval '1 day') g loop
    if exists (select 1 from public.tareas_turno t where t.fecha = d) then
      perform public.fn_tareas_sincronizar(d);
    end if;
  end loop;
end $$;

create or replace function public.fn_rutina_guardar(
  p_id uuid, p_datos jsonb, p_aplicar text default 'manana', p_asignados integer[] default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_admin boolean := public.fn_tiene_permiso('tareas_admin');
  v_hoy date := public.fn_tareas_hoy(); v_desde date;
  v_old public.tareas_recurrentes; v_new public.tareas_recurrentes;
  v_gestion_ok text[] := array['titulo', 'descripcion', 'turno_id', 'dias_semana', 'prioridad',
    'requiere_evidencia', 'modo', 'alcance', 'roles_puesto', 'hora', 'minutos_desde_inicio', 'duracion_min',
    'tipo_actividad', 'checklist', 'area', 'avisar_atraso_min'];
  v_admin_ok text[] := array['tipo_recurrencia', 'dia_mes', 'cada_n_dias', 'fecha_base',
    'vigencia_desde', 'vigencia_hasta', 'privada'];
  v_inicio time; v_antes jsonb; v_despues jsonb; v_asig_antes integer[]; v_id uuid;
begin
  if not (v_admin or public.fn_tiene_permiso('tareas_gestion')) then
    raise exception 'Solo la encargada o un administrador editan la rutina.';
  end if;
  if p_aplicar not in ('hoy', 'manana') then raise exception 'Elegí si aplica desde hoy o desde mañana.'; end if;
  if p_datos is null or jsonb_typeof(p_datos) <> 'object' then raise exception 'Faltan los datos.'; end if;
  if exists (select 1 from jsonb_object_keys(p_datos) k where k <> all(v_gestion_ok || v_admin_ok)) then
    raise exception 'Hay campos que no se pueden editar acá.';
  end if;
  v_desde := case when p_aplicar = 'hoy' then v_hoy else v_hoy + 1 end;

  if p_id is null then
    v_new := jsonb_populate_record(null::public.tareas_recurrentes,
      '{"activa":true,"tipo_recurrencia":"dias_semana","dias_semana":[0,1,2,3,4,5,6],"prioridad":"media",
        "modo":"individual","alcance":"puesto","roles_puesto":[],"checklist":[],"tipo_actividad":"puntual",
        "privada":false,"requiere_evidencia":false}'::jsonb || (p_datos - 'hora'));
    if not v_admin and exists (select 1 from jsonb_object_keys(p_datos) k where k = any(v_admin_ok)
                                 and k <> 'privada') then
      raise exception 'La recurrencia y la vigencia las cambia un administrador.';
    end if;
  else
    select * into v_old from public.tareas_recurrentes where id = p_id for update;
    if v_old.id is null then raise exception 'La tarea de la rutina no existe.'; end if;
    if v_old.privada and not v_admin then raise exception 'Sin permiso para esta tarea.'; end if;
    v_new := jsonb_populate_record(v_old, p_datos - 'hora');
    if not v_admin and exists (select 1 from jsonb_object_keys(p_datos) k where k = any(v_admin_ok)
         and (to_jsonb(v_old) -> k) is distinct from (to_jsonb(v_new) -> k)) then
      raise exception 'La recurrencia, la vigencia y "privada" las cambia un administrador.';
    end if;
  end if;
  if v_new.privada and not v_admin then raise exception 'Solo un administrador crea tareas privadas.'; end if;

  -- Validaciones
  select hora_inicio into v_inicio from public.turnos_plantilla where id = v_new.turno_id and activo;
  if v_inicio is null then raise exception 'Elegí un turno activo.'; end if;
  if p_datos ? 'hora' then
    v_new.minutos_desde_inicio := case when p_datos ->> 'hora' is null then null else
      ((extract(epoch from ((p_datos ->> 'hora')::time - v_inicio))::integer / 60) + 1440) % 1440 end;
  end if;
  v_new.hora := null;
  if nullif(btrim(v_new.titulo), '') is null or length(v_new.titulo) > 200 then
    raise exception 'El título es obligatorio (hasta 200 caracteres).';
  end if;
  v_new.titulo := btrim(v_new.titulo);
  perform public.fn_tarea_validar_horario(v_new.turno_id,
    case when v_new.minutos_desde_inicio is not null
         then (v_inicio + make_interval(mins => v_new.minutos_desde_inicio))::time end,
    v_new.duracion_min);
  if v_new.tipo_recurrencia = 'dias_semana' and (coalesce(cardinality(v_new.dias_semana), 0) = 0
       or exists (select 1 from unnest(v_new.dias_semana) x where x not between 0 and 6)) then
    raise exception 'Elegí al menos un día de la semana.';
  end if;
  if (v_new.tipo_recurrencia = 'dia_mes' and v_new.dia_mes is null)
     or (v_new.tipo_recurrencia = 'cada_n_dias' and v_new.cada_n_dias is null) then
    raise exception 'Falta el día del mes o cada cuántos días.';
  end if;
  if v_new.vigencia_hasta < v_new.vigencia_desde then raise exception 'La vigencia termina antes de empezar.'; end if;
  if not v_new.privada and v_new.alcance = 'puesto' and coalesce(cardinality(v_new.roles_puesto), 0) = 0 then
    raise exception 'Elegí al menos un puesto.';
  end if;
  if not v_new.privada and v_new.alcance = 'empleados' and coalesce(cardinality(p_asignados), 0) = 0
     and (p_asignados is not null or p_id is null
          or not exists (select 1 from public.tareas_recurrentes_asignados a where a.plantilla_id = p_id)) then
    raise exception 'Elegí a quién se le asigna.';
  end if;

  if p_id is null then
    v_new.id := gen_random_uuid();
    v_new.vigencia_desde := coalesce(v_new.vigencia_desde, v_desde);
    v_new.usuario_id := auth.uid(); v_new.created_at := now();
    v_new.updated_at := now(); v_new.updated_by := auth.uid();
    v_new.cambios_desde := null; v_new.version_anterior := null; v_new.codigo := null;
    insert into public.tareas_recurrentes select v_new.*;
    v_id := v_new.id;
    v_antes := null; v_despues := public.fn_rutina_version(v_new);
  else
    v_id := p_id;
    select jsonb_object_agg(k, public.fn_rutina_version(v_old) -> k),
           jsonb_object_agg(k, public.fn_rutina_version(v_new) -> k)
      into v_antes, v_despues
      from jsonb_object_keys(public.fn_rutina_version(v_new)) k
     where (public.fn_rutina_version(v_old) -> k) is distinct from (public.fn_rutina_version(v_new) -> k);
    if v_antes is not null then
      v_new.version_anterior := case when v_old.cambios_desde > v_hoy and v_old.version_anterior is not null
                                     then v_old.version_anterior else public.fn_rutina_version(v_old) end;
      v_new.cambios_desde := v_desde;
      v_new.updated_at := now(); v_new.updated_by := auth.uid();
      update public.tareas_recurrentes r set
        titulo = v_new.titulo, descripcion = v_new.descripcion, turno_id = v_new.turno_id,
        dias_semana = v_new.dias_semana, prioridad = v_new.prioridad, requiere_evidencia = v_new.requiere_evidencia,
        modo = v_new.modo, alcance = v_new.alcance, roles_puesto = v_new.roles_puesto, hora = null,
        minutos_desde_inicio = v_new.minutos_desde_inicio, duracion_min = v_new.duracion_min,
        tipo_actividad = v_new.tipo_actividad, checklist = v_new.checklist, area = v_new.area,
        avisar_atraso_min = v_new.avisar_atraso_min, tipo_recurrencia = v_new.tipo_recurrencia,
        dia_mes = v_new.dia_mes, cada_n_dias = v_new.cada_n_dias, fecha_base = v_new.fecha_base,
        vigencia_desde = v_new.vigencia_desde, vigencia_hasta = v_new.vigencia_hasta, privada = v_new.privada,
        version_anterior = v_new.version_anterior, cambios_desde = v_new.cambios_desde,
        updated_at = v_new.updated_at, updated_by = v_new.updated_by
      where r.id = p_id;
    end if;
  end if;

  if p_asignados is not null then
    select array_agg(empleado_id order by empleado_id) into v_asig_antes
      from public.tareas_recurrentes_asignados where plantilla_id = v_id;
    if v_asig_antes is distinct from (select array_agg(distinct x order by x) from unnest(p_asignados) x) then
      delete from public.tareas_recurrentes_asignados where plantilla_id = v_id;
      insert into public.tareas_recurrentes_asignados (plantilla_id, empleado_id)
      select distinct v_id, x from unnest(p_asignados) x
      join public.empleados e on e.id = x and e.activo;
      v_antes := coalesce(v_antes, '{}') || jsonb_build_object('asignados', v_asig_antes);
      v_despues := coalesce(v_despues, '{}') || jsonb_build_object('asignados',
        (select array_agg(empleado_id order by empleado_id) from public.tareas_recurrentes_asignados where plantilla_id = v_id));
    end if;
  end if;

  if v_despues is not null then
    perform public.fn_tarea_evento(case when p_id is null then 'creada' else 'editada' end::public.tarea_evento_tipo,
      null, v_id, v_antes, v_despues,
      case when p_aplicar = 'hoy' then 'Aplica desde hoy' else 'Aplica desde mañana' end, 'app');
    perform public.fn_rutina_resincronizar(v_desde);
  end if;
  return v_id;
end $$;

revoke execute on function public.fn_rutina_version(public.tareas_recurrentes) from public, anon, authenticated;
revoke execute on function public.fn_rutina_resincronizar(date) from public, anon, authenticated;
revoke execute on function public.fn_rutina_guardar(uuid, jsonb, text, integer[]) from public, anon;
grant execute on function public.fn_rutina_guardar(uuid, jsonb, text, integer[]) to authenticated;

do $$
begin
  if (select count(*) from pg_proc where proname in ('fn_rutina_version', 'fn_rutina_resincronizar',
        'fn_rutina_guardar')) <> 3 then
    raise exception '279: faltan funciones (o hay duplicadas).';
  end if;
end $$;

notify pgrst, 'reload schema';
