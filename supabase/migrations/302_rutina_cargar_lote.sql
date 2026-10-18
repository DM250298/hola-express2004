-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  302 · Rutina: cargar un lote con prueba previa (2 de 2)            ║
-- ║                                                                     ║
-- ║  fn_rutina_cargar_lote(tareas, vigencia, desactivar, aplicar):      ║
-- ║  la llama SOLO el script scripts/cargar-rutina-3-turnos.ts con la   ║
-- ║  clave de servidor (service_role). Todo en una transacción:         ║
-- ║   · guarda el lote (301), arma la agenda del día de la vigencia y   ║
-- ║     rearma los días ya generados (sin duplicar; lo empezado o       ║
-- ║     tocado a mano no se toca);                                      ║
-- ║   · simula la agenda de los 7 días desde la vigencia y la devuelve  ║
-- ║     para controlar (esa simulación siempre se deshace);             ║
-- ║   · con aplicar = false (modo prueba) deshace TODO al final.        ║
-- ║  Se frena si la vigencia ya empezó (su primer turno arrancó) y      ║
-- ║  controla que la agenda de antes de la vigencia no cambie.          ║
-- ║  Requiere la 301. Se puede correr de nuevo.                          ║
-- ║  Última línea del archivo: "notify pgrst, 'reload schema';"          ║
-- ╚════════════════════════════════════════════════════════════════════╝

do $$
begin
  if to_regprocedure('public.fn_rutina_lote_guardar(jsonb,date,text[])') is null
     or to_regprocedure('public.fn_tareas_sincronizar(date,integer)') is null then
    raise exception '302: falta la 301 (o la 271).';
  end if;
end $$;

-- Firma de la agenda de un rango (para comprobar que no cambió).
create or replace function public.fn_rutina_lote_firma(p_desde date, p_hasta date)
returns text language sql stable security definer set search_path = public as $$
  select count(*) || ':' || md5(coalesce(string_agg(t.id::text || t.estado::text || coalesce(t.empleado_id::text, '-')
           || coalesce(t.hora::text, '-') || t.titulo, ',' order by t.id), ''))
  from public.tareas_turno t where t.fecha between p_desde and p_hasta
$$;

create or replace function public.fn_rutina_cargar_lote(
  p_tareas jsonb, p_vigencia date, p_desactivar text[] default '{}', p_aplicar boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_hoy date := public.fn_tareas_hoy(); v_inicio timestamptz; v_res jsonb; v_semana jsonb;
  v_antes text; v_despues text; v_generadas integer; v_activas jsonb; v_codigos text[]; i integer;
begin
  if not public.fn_sesion_es_sistema() then
    raise exception 'Esta carga la hace solo el script del servidor.';
  end if;
  if p_vigencia is null then raise exception 'Falta la fecha desde la que rige.'; end if;
  select min(public.fn_tarea_inicio_turno(p_vigencia, tp.id)) into v_inicio
    from public.turnos_plantilla tp where tp.activo;
  if now() >= v_inicio then
    raise exception 'La vigencia del % ya empezó (su primer turno arrancó). Elegí otra fecha.',
      to_char(p_vigencia, 'DD/MM/YYYY');
  end if;
  select array_agg(x ->> 'codigo') into v_codigos from jsonb_array_elements(p_tareas) x;
  v_antes := public.fn_rutina_lote_firma(v_hoy - 1, p_vigencia - 1);

  begin
    v_res := public.fn_rutina_lote_guardar(p_tareas, p_vigencia, coalesce(p_desactivar, '{}'));
    perform public.fn_tareas_sincronizar(p_vigencia);
    perform public.fn_rutina_resincronizar(p_vigencia + 1);
    select count(*) into v_generadas from public.tareas_turno t
      join public.tareas_recurrentes r on r.id = t.plantilla_id
     where t.fecha = p_vigencia and r.codigo = any(v_codigos);
    select jsonb_object_agg(x.turno, x.n) into v_activas from (
      select tp.nombre::text as turno, count(*) as n from public.tareas_recurrentes r
        join public.turnos_plantilla tp on tp.id = r.turno_id
       where r.activa and r.codigo = any(v_codigos) group by tp.nombre) x;

    -- Simulación de la semana (siempre se deshace).
    begin
      for i in 0..6 loop perform public.fn_tareas_sincronizar(p_vigencia + i); end loop;
      select coalesce(jsonb_agg(jsonb_build_object(
               'fecha', t.fecha, 'turno', tp.nombre, 'codigo', coalesce(r.codigo, '(sin código)'),
               'titulo', t.titulo, 'modo', t.modo, 'todo_el_turno', t.todo_el_turno,
               'inicio', to_char(t.inicio_at at time zone 'America/Argentina/La_Rioja', 'DD/MM HH24:MI'),
               'fin', to_char(t.fin_at at time zone 'America/Argentina/La_Rioja', 'DD/MM HH24:MI'),
               'pasos', cardinality(t.checklist), 'foto', t.requiere_evidencia, 'aviso', t.avisar_atraso_min,
               'prioridad', t.prioridad, 'notas', t.notas,
               'quien', case when t.empleado_id is not null
                             then (select jsonb_build_array(e.nombre) from public.empleados e where e.id = t.empleado_id)
                             else (select coalesce(jsonb_agg(e.nombre order by e.nombre), '[]'::jsonb)
                                     from public.tareas_turno_participantes p
                                     join public.empleados e on e.id = p.empleado_id where p.tarea_id = t.id) end)
             order by t.fecha, tp.id, t.inicio_at, r.codigo), '[]'::jsonb)
        into v_semana
        from public.tareas_turno t
        join public.turnos_plantilla tp on tp.id = t.turno_id
        left join public.tareas_recurrentes r on r.id = t.plantilla_id
       where t.fecha between p_vigencia and p_vigencia + 6;
      raise exception using errcode = 'HX001', message = 'fin de la simulación';
    exception when sqlstate 'HX001' then null;
    end;

    v_despues := public.fn_rutina_lote_firma(v_hoy - 1, p_vigencia - 1);
    if v_despues is distinct from v_antes then
      raise exception 'La carga cambiaba la agenda de antes del %: no se guardó nada.', to_char(p_vigencia, 'DD/MM');
    end if;
    if not p_aplicar then
      raise exception using errcode = 'HX002', message = 'modo prueba';
    end if;
  exception when sqlstate 'HX002' then null;
  end;

  return v_res || jsonb_build_object(
    'modo', case when p_aplicar then 'aplicado' else 'prueba: no se guardó nada' end,
    'hoy', v_hoy, 'vigencia', p_vigencia, 'activas_por_turno', coalesce(v_activas, '{}'::jsonb),
    'agenda_vigencia_generada', v_generadas, 'agenda_previa_sin_cambios', true, 'semana', v_semana);
end;
$$;

revoke execute on function public.fn_rutina_lote_firma(date, date) from public, anon, authenticated, service_role;
revoke execute on function public.fn_rutina_cargar_lote(jsonb, date, text[], boolean) from public, anon, authenticated;
grant execute on function public.fn_rutina_cargar_lote(jsonb, date, text[], boolean) to service_role;

do $$
begin
  if to_regprocedure('public.fn_rutina_cargar_lote(jsonb,date,text[],boolean)') is null
     or has_function_privilege('authenticated', 'public.fn_rutina_cargar_lote(jsonb,date,text[],boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.fn_rutina_cargar_lote(jsonb,date,text[],boolean)', 'EXECUTE') then
    raise exception '302: fn_rutina_cargar_lote no quedó bien.';
  end if;
end $$;

notify pgrst, 'reload schema';
