-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  276 · Tareas v2: crear una tarea puntual y editarla                ║
-- ║  (Etapa 1 · bloque E)                                                ║
-- ║                                                                     ║
-- ║   · fn_tarea_validar_horario(turno, hora, duración): interna. La     ║
-- ║     hora y el fin tienen que caer dentro del turno (la noche cruza   ║
-- ║     la medianoche); duración mayor a 0.                              ║
-- ║   · fn_tarea_crear_puntual(...): NUEVA. Encargada o admin; privadas  ║
-- ║     solo admin (sin asignados). Se asigna a personas o a un puesto   ║
-- ║     (le toca a quien está en el cronograma; sigue los francos como   ║
-- ║     la rutina). "Cada uno" = una por persona; "Grupal" = una con     ║
-- ║     participantes. Devuelve los ids creados. Evento "creada".        ║
-- ║   · fn_tarea_editar(tarea, cambios jsonb): NUEVA. Título, detalle,   ║
-- ║     hora, duración, prioridad, área, foto, checklist, aviso, tipo y  ║
-- ║     notas. Queda "editada a mano" y en el registro (antes/después).  ║
-- ║                                                                     ║
-- ║  Requiere la 275. Se puede correr de nuevo.                          ║
-- ║  Última línea del archivo: "notify pgrst, 'reload schema';"          ║
-- ╚════════════════════════════════════════════════════════════════════╝

do $$
begin
  if to_regprocedure('public.fn_tarea_cancelar(uuid,text)') is null then
    raise exception '276: falta la 275.';
  end if;
end $$;

create or replace function public.fn_tarea_validar_horario(p_turno_id integer, p_hora time, p_duracion_min integer)
returns void language plpgsql stable set search_path = public as $$
declare v_tp record; v_largo integer; v_desde integer;
begin
  if p_duracion_min is not null and p_duracion_min <= 0 then
    raise exception 'La duración tiene que ser mayor a 0.';
  end if;
  if p_hora is null then return; end if;
  select hora_inicio, hora_fin into v_tp from public.turnos_plantilla where id = p_turno_id;
  if v_tp.hora_inicio is null then raise exception 'Turno inexistente.'; end if;
  v_largo := ((extract(epoch from (v_tp.hora_fin - v_tp.hora_inicio))::integer / 60) + 1440) % 1440;
  if v_largo = 0 then v_largo := 1440; end if;
  v_desde := ((extract(epoch from (p_hora - v_tp.hora_inicio))::integer / 60) + 1440) % 1440;
  if v_desde >= v_largo or v_desde + coalesce(p_duracion_min, 0) > v_largo then
    raise exception 'El horario tiene que quedar dentro del turno (% a %).',
      to_char(v_tp.hora_inicio, 'HH24:MI'), to_char(v_tp.hora_fin, 'HH24:MI');
  end if;
end $$;

create or replace function public.fn_tarea_crear_puntual(
  p_fecha date, p_turno_id integer, p_titulo text,
  p_descripcion text default null, p_hora time default null, p_duracion_min integer default null,
  p_empleado_ids integer[] default null, p_roles_puesto text[] default null,
  p_modo public.modo_tarea default 'individual', p_prioridad public.prioridad_tarea default 'media',
  p_area public.tarea_area default null, p_privada boolean default false,
  p_requiere_evidencia boolean default false, p_checklist text[] default '{}',
  p_tipo_actividad public.tipo_actividad_tarea default 'puntual', p_avisar_atraso_min integer default null)
returns uuid[] language plpgsql security definer set search_path = public as $$
declare
  v_titulo text := nullif(btrim(p_titulo), ''); v_ids uuid[] := '{}'; v_id uuid;
  v_personas integer[]; v_emp integer; v_hoy date := public.fn_tareas_hoy();
begin
  if not (public.fn_tiene_permiso('tareas_gestion') or public.fn_tiene_permiso('tareas_admin')) then
    raise exception 'Solo la encargada o un administrador pueden crear tareas.';
  end if;
  if p_privada and not public.fn_tiene_permiso('tareas_admin') then
    raise exception 'Solo un administrador crea tareas privadas.';
  end if;
  if v_titulo is null or length(v_titulo) > 200 then
    raise exception 'El título es obligatorio (hasta 200 caracteres).';
  end if;
  if not exists (select 1 from public.turnos_plantilla where id = p_turno_id and activo) then
    raise exception 'Elegí un turno activo.';
  end if;
  if p_fecha is null or p_fecha > v_hoy + 60
     or public.fn_tarea_fin_turno(p_fecha, p_turno_id) <= now() then
    raise exception 'Ese turno ya terminó o la fecha está fuera de rango.';
  end if;
  perform public.fn_tarea_validar_horario(p_turno_id, p_hora, p_duracion_min);
  if p_avisar_atraso_min is not null and p_avisar_atraso_min < 0 then
    raise exception 'El aviso de atraso no puede ser negativo.';
  end if;

  if p_privada then
    v_personas := '{}';
  elsif coalesce(cardinality(p_empleado_ids), 0) > 0 then
    if exists (select 1 from unnest(p_empleado_ids) x(id)
                where not exists (select 1 from public.empleados e where e.id = x.id and e.activo)) then
      raise exception 'Hay personas elegidas que no existen o no están activas.';
    end if;
    select array_agg(distinct x) into v_personas from unnest(p_empleado_ids) x;
  elsif coalesce(cardinality(p_roles_puesto), 0) > 0 then
    select array_agg(q.empleado_id) into v_personas
      from public.fn_a_quien_le_toca(p_fecha, p_turno_id, p_roles_puesto) q;
    if v_personas is null then
      raise exception 'No hay nadie de ese puesto en el cronograma de ese turno: elegí una persona.';
    end if;
    if p_modo = 'individual' then v_personas := v_personas[1:1]; end if;
  else
    raise exception 'Elegí a quién se le asigna (personas o puesto).';
  end if;

  if p_privada or p_modo = 'grupal' then
    insert into public.tareas_turno (titulo, descripcion, empleado_id, turno_id, fecha, hora, duracion_min,
      prioridad, requiere_evidencia, estado, modo, usuario_id, tipo_actividad, checklist, area,
      privada, avisar_atraso_min, roles_puesto, asignacion_manual)
    values (v_titulo, nullif(btrim(p_descripcion), ''), null, p_turno_id, p_fecha, p_hora, p_duracion_min,
      p_prioridad, p_requiere_evidencia, 'pendiente', p_modo, auth.uid(), p_tipo_actividad,
      coalesce(p_checklist, '{}'), p_area, p_privada, p_avisar_atraso_min, p_roles_puesto,
      coalesce(cardinality(p_empleado_ids), 0) > 0)
    returning id into v_id;
    insert into public.tareas_turno_participantes (tarea_id, empleado_id)
    select v_id, x from unnest(v_personas) x;
    v_ids := array[v_id];
  else
    foreach v_emp in array v_personas loop
      insert into public.tareas_turno (titulo, descripcion, empleado_id, turno_id, fecha, hora, duracion_min,
        prioridad, requiere_evidencia, estado, modo, usuario_id, tipo_actividad, checklist, area,
        privada, avisar_atraso_min, roles_puesto, asignacion_manual)
      values (v_titulo, nullif(btrim(p_descripcion), ''), v_emp, p_turno_id, p_fecha, p_hora, p_duracion_min,
        p_prioridad, p_requiere_evidencia, 'pendiente', 'individual', auth.uid(), p_tipo_actividad,
        coalesce(p_checklist, '{}'), p_area, false, p_avisar_atraso_min,
        case when coalesce(cardinality(p_empleado_ids), 0) = 0 then p_roles_puesto end, false)
      returning id into v_id;
      v_ids := v_ids || v_id;
    end loop;
  end if;

  foreach v_id in array v_ids loop
    perform public.fn_tarea_evento('creada', v_id, null, null,
      (select jsonb_strip_nulls(jsonb_build_object('titulo', t.titulo, 'fecha', t.fecha, 'turno_id', t.turno_id,
         'hora', t.hora, 'duracion_min', t.duracion_min, 'empleado_id', t.empleado_id,
         'roles_puesto', t.roles_puesto, 'modo', t.modo, 'privada', t.privada))
         from public.tareas_turno t where t.id = v_id),
      null, 'app');
  end loop;
  return v_ids;
end $$;

create or replace function public.fn_tarea_editar(p_tarea_id uuid, p_cambios jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_t public.tareas_turno; v_n public.tareas_turno; v_antes jsonb; v_despues jsonb;
  v_permitidas text[] := array['titulo', 'descripcion', 'hora', 'duracion_min', 'prioridad', 'area',
    'requiere_evidencia', 'checklist', 'avisar_atraso_min', 'tipo_actividad', 'notas'];
begin
  perform public.fn_tarea_puede_gestionar(p_tarea_id);
  if p_cambios is null or jsonb_typeof(p_cambios) <> 'object' or p_cambios = '{}'::jsonb then
    raise exception 'No hay cambios.';
  end if;
  if exists (select 1 from jsonb_object_keys(p_cambios) k where k <> all(v_permitidas)) then
    raise exception 'Hay campos que no se pueden editar acá.';
  end if;
  select * into v_t from public.tareas_turno where id = p_tarea_id for update;
  if v_t.estado not in ('pendiente', 'en_curso', 'vencida') then
    raise exception 'Solo se editan tareas abiertas (estado actual: %).', v_t.estado;
  end if;
  v_n := jsonb_populate_record(v_t, p_cambios);
  if nullif(btrim(v_n.titulo), '') is null or length(v_n.titulo) > 200 then
    raise exception 'El título es obligatorio (hasta 200 caracteres).';
  end if;
  perform public.fn_tarea_validar_horario(v_t.turno_id, v_n.hora, v_n.duracion_min);

  select jsonb_object_agg(k, to_jsonb(v_t) -> k), jsonb_object_agg(k, to_jsonb(v_n) -> k)
    into v_antes, v_despues
    from unnest(v_permitidas) k where (to_jsonb(v_t) -> k) is distinct from (to_jsonb(v_n) -> k);
  if v_antes is null then return; end if;

  update public.tareas_turno set
    titulo = btrim(v_n.titulo), descripcion = v_n.descripcion, hora = v_n.hora,
    duracion_min = v_n.duracion_min, prioridad = v_n.prioridad, area = v_n.area,
    requiere_evidencia = v_n.requiere_evidencia, checklist = coalesce(v_n.checklist, '{}'),
    checklist_estado = case when v_n.checklist is distinct from v_t.checklist then '[]'::jsonb
                            else checklist_estado end,
    avisar_atraso_min = v_n.avisar_atraso_min, tipo_actividad = v_n.tipo_actividad, notas = v_n.notas,
    contenido_tocado_at = case when v_antes - 'notas' <> '{}'::jsonb
                               then coalesce(contenido_tocado_at, now()) else contenido_tocado_at end
  where id = p_tarea_id;
  perform public.fn_tarea_evento('editada', p_tarea_id, null, v_antes, v_despues, null, 'app');
end $$;

revoke execute on function public.fn_tarea_validar_horario(integer, time, integer) from public, anon, authenticated;
revoke execute on function public.fn_tarea_crear_puntual(date, integer, text, text, time, integer, integer[], text[],
  public.modo_tarea, public.prioridad_tarea, public.tarea_area, boolean, boolean, text[],
  public.tipo_actividad_tarea, integer) from public, anon;
revoke execute on function public.fn_tarea_editar(uuid, jsonb) from public, anon;
grant execute on function public.fn_tarea_crear_puntual(date, integer, text, text, time, integer, integer[], text[],
  public.modo_tarea, public.prioridad_tarea, public.tarea_area, boolean, boolean, text[],
  public.tipo_actividad_tarea, integer) to authenticated;
grant execute on function public.fn_tarea_editar(uuid, jsonb) to authenticated;

do $$
begin
  if (select count(*) from pg_proc where proname in ('fn_tarea_crear_puntual', 'fn_tarea_editar',
        'fn_tarea_validar_horario')) <> 3 then
    raise exception '276: faltan funciones (o hay duplicadas).';
  end if;
end $$;

notify pgrst, 'reload schema';
