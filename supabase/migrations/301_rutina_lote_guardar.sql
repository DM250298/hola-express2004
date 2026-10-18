-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  301 · Rutina: guardar un lote de tareas por código (1 de 2)        ║
-- ║                                                                     ║
-- ║  fn_rutina_lote_guardar(tareas, vigencia, desactivar): interna. La  ║
-- ║  usa fn_rutina_cargar_lote (302), que la llama el script            ║
-- ║  scripts/cargar-rutina-3-turnos.ts. No arma la agenda.              ║
-- ║   · Valida cada tarea (turno, título, días 0–6, puesto, horario     ║
-- ║     dentro del turno). Si una falla, no se guarda ninguna.          ║
-- ║   · Crea o actualiza por código: lo que no cambió queda igual (no   ║
-- ║     duplica si se corre de nuevo). Una tarea nueva rige desde la    ║
-- ║     vigencia; un cambio también ("aplica desde", con la versión     ║
-- ║     anterior guardada para los días previos).                       ║
-- ║   · Desactiva los códigos pedidos, desde la vigencia (no borra).    ║
-- ║   · Todo queda en el registro de cambios (origen carga_rutina).     ║
-- ║  No cambia nada visible. Requiere la 279. Se puede correr de nuevo. ║
-- ║  Última línea del archivo: "notify pgrst, 'reload schema';"          ║
-- ╚════════════════════════════════════════════════════════════════════╝

do $$
begin
  if to_regprocedure('public.fn_rutina_version(public.tareas_recurrentes)') is null
     or to_regprocedure('public.fn_tarea_validar_horario(integer,time,integer)') is null then
    raise exception '301: faltan migraciones anteriores (276 o 279).';
  end if;
end $$;

create or replace function public.fn_rutina_lote_guardar(p_tareas jsonb, p_vigencia date, p_desactivar text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  t record; r record; v_tp record;
  v_old public.tareas_recurrentes; v_new public.tareas_recurrentes;
  v_hoy date := public.fn_tareas_hoy(); v_codigos text[]; v_avisos text[] := '{}';
  v_motivo text := 'Carga de la rutina de los 3 turnos (rige desde el ' || to_char(p_vigencia, 'DD/MM/YYYY') || ')';
  v_c integer := 0; v_a integer := 0; v_i integer := 0; v_d integer := 0; v_antes jsonb; v_despues jsonb;
begin
  if jsonb_typeof(p_tareas) is distinct from 'array' or jsonb_array_length(p_tareas) = 0 then
    raise exception 'El lote está vacío.';
  end if;
  select array_agg(x ->> 'codigo') into v_codigos from jsonb_array_elements(p_tareas) x;
  if exists (select 1 from unnest(v_codigos) c where nullif(btrim(c), '') is null) then
    raise exception 'Hay tareas sin código.';
  end if;
  if cardinality(v_codigos) <> (select count(distinct c) from unnest(v_codigos) c) then
    raise exception 'Hay códigos repetidos en el lote.';
  end if;
  if coalesce(p_desactivar, '{}') && v_codigos then
    raise exception 'Un código no puede cargarse y desactivarse a la vez.';
  end if;

  for t in select * from jsonb_to_recordset(p_tareas) as x(
      codigo text, turno text, titulo text, descripcion text, minutos_desde_inicio integer,
      duracion_min integer, dias_semana integer[], roles_puesto text[], modo text, prioridad text,
      area text, avisar_atraso_min integer, requiere_evidencia boolean, checklist text[])
  loop
    select id, hora_inicio into v_tp from public.turnos_plantilla where nombre::text = t.turno and activo;
    if v_tp.id is null then raise exception '%: no existe el turno %.', t.codigo, t.turno; end if;
    if nullif(btrim(t.titulo), '') is null or length(btrim(t.titulo)) > 200 then
      raise exception '%: el título está vacío o pasa de 200 caracteres.', t.codigo;
    end if;
    if coalesce(cardinality(t.dias_semana), 0) = 0
       or exists (select 1 from unnest(t.dias_semana) d where d is null or d not between 0 and 6) then
      raise exception '%: días de la semana inválidos (0 = domingo … 6 = sábado).', t.codigo;
    end if;
    if coalesce(cardinality(t.roles_puesto), 0) = 0 or not t.roles_puesto <@ array['direccion',
         'responsable_general', 'encargado', 'pivote', 'compras', 'cajero', 'fiambreria', 'otro'] then
      raise exception '%: puesto inválido (%).', t.codigo, t.roles_puesto;
    end if;
    if (t.minutos_desde_inicio is null) <> (t.duracion_min is null) then
      raise exception '%: el inicio y la duración van juntos (o ninguno, si es sin hora fija).', t.codigo;
    end if;
    begin
      perform public.fn_tarea_validar_horario(v_tp.id,
        case when t.minutos_desde_inicio is not null
             then (v_tp.hora_inicio + make_interval(mins => t.minutos_desde_inicio))::time end,
        t.duracion_min);
    exception when others then raise exception '%: %', t.codigo, sqlerrm;
    end;

    v_old := null;
    select * into v_old from public.tareas_recurrentes where codigo = t.codigo for update;
    v_new := v_old;
    v_new.titulo := btrim(t.titulo); v_new.descripcion := nullif(btrim(t.descripcion), '');
    v_new.turno_id := v_tp.id; v_new.hora := null; v_new.ventana_min := null;
    v_new.minutos_desde_inicio := t.minutos_desde_inicio; v_new.duracion_min := t.duracion_min;
    v_new.tipo_actividad := 'puntual'; v_new.checklist := coalesce(t.checklist, '{}');
    v_new.prioridad := t.prioridad::public.prioridad_tarea; v_new.area := t.area::public.tarea_area;
    v_new.requiere_evidencia := coalesce(t.requiere_evidencia, false);
    v_new.avisar_atraso_min := t.avisar_atraso_min;
    v_new.alcance := 'puesto'; v_new.roles_puesto := t.roles_puesto; v_new.modo := t.modo::public.modo_tarea;
    v_new.empleado_id := null; v_new.privada := false; v_new.activa := true;
    v_new.tipo_recurrencia := 'dias_semana'; v_new.dias_semana := t.dias_semana;
    v_new.dia_mes := null; v_new.cada_n_dias := null; v_new.fecha_base := null; v_new.vigencia_hasta := null;

    if v_old.id is null then
      v_new.id := gen_random_uuid(); v_new.codigo := t.codigo; v_new.vigencia_desde := p_vigencia;
      v_new.created_at := now(); v_new.updated_at := now();
      insert into public.tareas_recurrentes select v_new.*;
      perform public.fn_tarea_evento('creada', null, v_new.id, null,
        jsonb_build_object('codigo', t.codigo, 'titulo', v_new.titulo), v_motivo, 'carga_rutina');
      v_c := v_c + 1;
    elsif public.fn_rutina_version(v_old) is distinct from public.fn_rutina_version(v_new) then
      select jsonb_object_agg(k, public.fn_rutina_version(v_old) -> k),
             jsonb_object_agg(k, public.fn_rutina_version(v_new) -> k)
        into v_antes, v_despues
        from jsonb_object_keys(public.fn_rutina_version(v_new)) k
       where (public.fn_rutina_version(v_old) -> k) is distinct from (public.fn_rutina_version(v_new) -> k);
      update public.tareas_recurrentes x set
        titulo = v_new.titulo, descripcion = v_new.descripcion, turno_id = v_new.turno_id, hora = null,
        minutos_desde_inicio = v_new.minutos_desde_inicio, duracion_min = v_new.duracion_min, ventana_min = null,
        tipo_actividad = v_new.tipo_actividad, checklist = v_new.checklist, prioridad = v_new.prioridad,
        area = v_new.area, requiere_evidencia = v_new.requiere_evidencia, avisar_atraso_min = v_new.avisar_atraso_min,
        alcance = v_new.alcance, roles_puesto = v_new.roles_puesto, modo = v_new.modo, empleado_id = null,
        privada = false, activa = true, tipo_recurrencia = v_new.tipo_recurrencia, dias_semana = v_new.dias_semana,
        dia_mes = null, cada_n_dias = null, fecha_base = null, vigencia_hasta = null,
        version_anterior = case when v_old.cambios_desde > v_hoy and v_old.version_anterior is not null
                                then v_old.version_anterior else public.fn_rutina_version(v_old) end,
        cambios_desde = p_vigencia, updated_at = now()
      where x.id = v_old.id;
      perform public.fn_tarea_evento('editada', null, v_old.id, v_antes, v_despues, v_motivo, 'carga_rutina');
      v_a := v_a + 1;
    else
      v_i := v_i + 1;
    end if;
  end loop;

  -- Desactivar (no se borra): desde la vigencia; los días previos usan la versión de hoy.
  for r in
    update public.tareas_recurrentes x
       set activa = false,
           version_anterior = case when x.cambios_desde > v_hoy and x.version_anterior is not null
                                   then x.version_anterior else public.fn_rutina_version(x) end,
           cambios_desde = p_vigencia, updated_at = now()
     where x.codigo = any(coalesce(p_desactivar, '{}')) and x.activa
    returning x.id
  loop
    perform public.fn_tarea_evento('quitada', null, r.id, jsonb_build_object('activa', true),
      jsonb_build_object('activa', false), v_motivo, 'carga_rutina');
    v_d := v_d + 1;
  end loop;

  select coalesce(array_agg(x.c), '{}') || v_avisos into v_avisos
    from (select 'Para desactivar, no existe: ' || c as c
            from unnest(coalesce(p_desactivar, '{}')) c
           where not exists (select 1 from public.tareas_recurrentes x where x.codigo = c)) x;
  select v_avisos || coalesce(array_agg('Sigue activa y no está en el lote: '
           || coalesce(x.codigo, '(sin código)') || ' · ' || x.titulo order by x.codigo, x.titulo), '{}')
    into v_avisos
    from public.tareas_recurrentes x
   where x.activa and (x.codigo is null or not x.codigo = any(v_codigos));

  return jsonb_build_object('creadas', v_c, 'actualizadas', v_a, 'iguales', v_i, 'desactivadas', v_d,
                            'advertencias', to_jsonb(v_avisos));
end;
$$;

revoke execute on function public.fn_rutina_lote_guardar(jsonb, date, text[])
  from public, anon, authenticated, service_role;

do $$
begin
  if to_regprocedure('public.fn_rutina_lote_guardar(jsonb,date,text[])') is null
     or has_function_privilege('authenticated', 'public.fn_rutina_lote_guardar(jsonb,date,text[])', 'EXECUTE') then
    raise exception '301: fn_rutina_lote_guardar no quedó bien.';
  end if;
end $$;

notify pgrst, 'reload schema';
