-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  287 · Tareas v2: rutina del Anexo A, turno noche    (23–07)        ║
-- ║                                                                     ║
-- ║   · Carga las 15 tareas del Anexo A de este turno (códigos N01–N15) ║
-- ║     con horario (minutos desde el inicio del turno), duración, área, ║
-- ║     puesto y prioridad (● = alta, con aviso a los 15 min; el resto   ║
-- ║     media). "Todo el turno" = recordatorio (no se marca).            ║
-- ║   · Todo al vendedor de turno (Cajero/a).                            ║
-- ║   · Saca de la rutina las tareas viejas de este turno (no se borran);║
-- ║     las que encajaban quedaron como pasos de checklist.              ║
-- ║   · Todo rige DESDE MAÑANA: la agenda de hoy no cambia. Al final     ║
-- ║     rearma la agenda de mañana (y los días ya generados).            ║
-- ║  Requiere la 284. Se puede correr de nuevo (no duplica).             ║
-- ║  Última línea del archivo: "notify pgrst, 'reload schema';"          ║
-- ╚════════════════════════════════════════════════════════════════════╝

do $$
begin
  if not exists (select 1 from pg_proc where proname = 'fn_rutina_resincronizar')
     or not exists (select 1 from pg_proc where proname = 'fn_calcular_evaluacion' and prosrc like '%no_se_pudo%') then
    raise exception '287: faltan migraciones anteriores (279 o 284).';
  end if;
end $$;

create or replace function pg_temp.fn_anexo(
  p_codigo text, p_turno text, p_desde text, p_hasta text, p_area public.tarea_area,
  p_titulo text, p_alta boolean, p_roles text[], p_modo public.modo_tarea, p_checklist text[])
returns void language plpgsql as $$
declare v_t record; v_ini integer; v_fin integer; v_id uuid;
begin
  if exists (select 1 from public.tareas_recurrentes where codigo = p_codigo) then return; end if;
  select id, hora_inicio into v_t from public.turnos_plantilla where nombre::text = p_turno;
  if v_t.id is null then raise exception 'No existe el turno %.', p_turno; end if;
  if p_desde is not null then
    v_ini := ((extract(epoch from (p_desde::time - v_t.hora_inicio))::integer / 60) + 1440) % 1440;
    v_fin := case when p_hasta is null then v_ini + 15
                  else ((extract(epoch from (p_hasta::time - v_t.hora_inicio))::integer / 60) + 1440) % 1440 end;
    if v_fin = 0 then v_fin := 1440; end if;
  end if;
  insert into public.tareas_recurrentes (
    titulo, turno_id, minutos_desde_inicio, duracion_min, tipo_actividad, area, prioridad,
    avisar_atraso_min, alcance, roles_puesto, modo, checklist, codigo, vigencia_desde, activa,
    tipo_recurrencia, dias_semana, requiere_evidencia)
  values (
    p_titulo, v_t.id, v_ini, case when p_desde is not null then v_fin - v_ini end,
    (case when p_desde is null then 'continua' else 'puntual' end)::public.tipo_actividad_tarea,
    p_area, (case when p_alta then 'alta' else 'media' end)::public.prioridad_tarea,
    case when p_alta then 15 end, 'puesto', p_roles, p_modo, p_checklist, p_codigo,
    public.fn_tareas_hoy() + 1, true, 'dias_semana', '{0,1,2,3,4,5,6}', false)
  returning id into v_id;
  perform public.fn_tarea_evento('creada', null, v_id, null,
    jsonb_build_object('codigo', p_codigo, 'titulo', p_titulo), 'Carga del Anexo A (desde mañana)', 'migracion');
end $$;

select pg_temp.fn_anexo('N01', 'noche', '23:00', '23:15', 'control_seguridad', 'Traspaso con la tarde: caja chica, pedidos en curso',
  true, '{"cajero"}', 'individual', '{}');
select pg_temp.fn_anexo('N02', 'noche', '23:00', '00:00', 'atencion_caja', 'Atención con el local abierto, WhatsApp y delivery',
  true, '{"cajero"}', 'individual', '{}');
select pg_temp.fn_anexo('N03', 'noche', '23:15', '00:00', 'reposicion_limpieza', 'Reposición rápida antes de pasar a reja',
  false, '{"cajero"}', 'individual', '{}');
select pg_temp.fn_anexo('N04', 'noche', '00:00', null, 'control_seguridad', 'Pasar a atención por reja',
  true, '{"cajero"}', 'individual', '{"Recorrida visual del local; registrar incidencias"}');
select pg_temp.fn_anexo('N05', 'noche', '00:00', '01:00', 'atencion_caja', 'Delivery por reja; a la 01:00 se corta la toma de pedidos',
  true, '{"cajero"}', 'individual', '{}');
select pg_temp.fn_anexo('N06', 'noche', '01:00', null, 'control_seguridad', 'Cierre del delivery y rendición final del cadete',
  true, '{"cajero"}', 'individual', '{}');
select pg_temp.fn_anexo('N07', 'noche', '01:00', '02:30', 'reposicion_limpieza', 'Reposición profunda y frenteo de todo el local',
  true, '{"cajero"}', 'individual', '{"Informar faltantes críticos como incidencia"}');
select pg_temp.fn_anexo('N08', 'noche', '02:00', null, 'control_seguridad', 'Control de temperaturas (3 de 3)',
  true, '{"cajero"}', 'individual', '{}');
select pg_temp.fn_anexo('N09', 'noche', '02:30', '04:00', 'reposicion_limpieza', 'Limpieza a fondo: pisos, baño, depósito',
  false, '{"cajero"}', 'individual', '{}');
select pg_temp.fn_anexo('N10', 'noche', '04:00', '04:45', 'reposicion_limpieza', 'Orden de depósito, cartón atado',
  false, '{"cajero"}', 'individual', '{}');
select pg_temp.fn_anexo('N11', 'noche', '04:45', '05:45', 'control_seguridad', 'Vencimientos del sector de la noche',
  true, '{"cajero"}', 'individual', '{}');
select pg_temp.fn_anexo('N12', 'noche', '05:30', '06:30', 'produccion_fiambreria', 'Puesta a punto de fiambrería: dejar todo listo para vender',
  true, '{"cajero"}', 'individual', '{}');
select pg_temp.fn_anexo('N13', 'noche', '06:30', '06:45', 'produccion_fiambreria', 'Medialunas, 1.ª tanda',
  true, '{"cajero"}', 'individual', '{}');
select pg_temp.fn_anexo('N14', 'noche', '06:40', '07:00', 'control_seguridad', 'Cierre de turno: arqueo y novedades',
  true, '{"cajero"}', 'individual', '{"Registrar pendientes relevantes para el turno mañana"}');
select pg_temp.fn_anexo('N15', 'noche', '06:45', '07:00', 'produccion_fiambreria', 'Cierre y entrega de turno',
  false, '{"cajero"}', 'individual', '{}');

-- Las tareas viejas de este turno salen de la rutina desde mañana (con su
-- versión de hoy guardada: la agenda de hoy no cambia).
do $$
declare r record; v_turno integer;
begin
  select id into v_turno from public.turnos_plantilla where nombre::text = 'noche';
  for r in
    update public.tareas_recurrentes x
       set activa = false,
           version_anterior = case when x.cambios_desde > public.fn_tareas_hoy() and x.version_anterior is not null
                                   then x.version_anterior else public.fn_rutina_version(x) end,
           cambios_desde = public.fn_tareas_hoy() + 1,
           updated_at = now()
     where x.turno_id = v_turno and x.codigo is null and x.activa
    returning x.id
  loop
    perform public.fn_tarea_evento('quitada', null, r.id, jsonb_build_object('activa', true),
      jsonb_build_object('activa', false), 'Reemplazada por el Anexo A (desde mañana)', 'migracion');
  end loop;
end $$;

select public.fn_rutina_resincronizar(public.fn_tareas_hoy() + 1);

do $$
declare v_turno integer; v_n integer; v_viejas integer;
begin
  select id into v_turno from public.turnos_plantilla where nombre::text = 'noche';
  select count(*) into v_n from public.tareas_recurrentes where turno_id = v_turno and codigo like 'N%' and activa;
  select count(*) into v_viejas from public.tareas_recurrentes where turno_id = v_turno and codigo is null and activa;
  if v_n <> 15 or v_viejas <> 0 then
    raise exception '287: quedaron % tareas del Anexo (tienen que ser 15) y % viejas activas.', v_n, v_viejas;
  end if;
end $$;

notify pgrst, 'reload schema';
