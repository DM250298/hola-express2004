-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  286 · Tareas v2: rutina del Anexo A, turno tarde    (15–23)        ║
-- ║                                                                     ║
-- ║   · Carga las 13 tareas del Anexo A de este turno (códigos T01–T13) ║
-- ║     con horario (minutos desde el inicio del turno), duración, área, ║
-- ║     puesto y prioridad (● = alta, con aviso a los 15 min; el resto   ║
-- ║     media). "Todo el turno" = recordatorio (no se marca).            ║
-- ║   · Control y la merienda → Encargada de turno (Rebeca); reposición ║
-- ║     grupal entre Rebeca y el fiambrero (no hay cajero a la tarde).  ║
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
    raise exception '286: faltan migraciones anteriores (279 o 284).';
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

select pg_temp.fn_anexo('T01', 'tarde', '15:00', '15:15', 'control_seguridad', 'Traspaso con la mañana: caja, producción hecha y pendiente',
  true, '{"encargado"}', 'individual', '{}');
select pg_temp.fn_anexo('T02', 'tarde', '15:20', '17:30', 'produccion_fiambreria', '2.ª tanda de sándwiches y milanesas hasta el mínimo',
  true, '{"fiambreria"}', 'individual', '{}');
select pg_temp.fn_anexo('T03', 'tarde', '16:00', null, 'produccion_fiambreria', 'Medialunas, 2.ª tanda',
  true, '{"fiambreria"}', 'individual', '{}');
select pg_temp.fn_anexo('T04', 'tarde', '16:00', null, 'control_seguridad', 'Control de temperaturas (2 de 3)',
  true, '{"encargado"}', 'individual', '{}');
select pg_temp.fn_anexo('T05', 'tarde', '16:00', '18:00', 'atencion_caja', 'Merienda: combo merienda/mate',
  false, '{"encargado"}', 'individual', '{}');
select pg_temp.fn_anexo('T06', 'tarde', '16:30', '17:30', 'reposicion_limpieza', 'Reposición fuerte de bebidas e hielo',
  true, '{"encargado","fiambreria"}', 'grupal', '{"Guardar y reponer la mercadería recibida"}');
select pg_temp.fn_anexo('T07', 'tarde', '17:00', '18:00', 'reposicion_limpieza', 'Snacks y golosinas en góndolas de salida y caja',
  false, '{"encargado","fiambreria"}', 'grupal', '{"Precios visibles y correctos"}');
select pg_temp.fn_anexo('T08', 'tarde', '20:00', null, 'reposicion_limpieza', 'Vereda, frente y cartelera',
  false, '{"encargado","fiambreria"}', 'grupal', '{}');
select pg_temp.fn_anexo('T09', 'tarde', '21:00', null, 'control_seguridad', 'Vencimientos de fríos y abiertos',
  true, '{"encargado"}', 'individual', '{}');
select pg_temp.fn_anexo('T10', 'tarde', '21:30', '22:30', 'produccion_fiambreria', 'Cierre de fiambrería: máquina, mesadas, rotulado',
  true, '{"fiambreria"}', 'individual', '{}');
select pg_temp.fn_anexo('T11', 'tarde', '22:00', null, 'control_seguridad', 'Supervisión de la encargada: producción, mermas, faltantes',
  true, '{"encargado"}', 'individual', '{}');
select pg_temp.fn_anexo('T12', 'tarde', '22:30', '22:45', 'reposicion_limpieza', 'Basura y cartón',
  false, '{"encargado","fiambreria"}', 'grupal', '{"Salón ordenado y limpio","Depósito ordenado"}');
select pg_temp.fn_anexo('T13', 'tarde', '22:40', '23:00', 'control_seguridad', 'Cierre: arqueo, rendición de Rapipago y del cadete',
  true, '{"encargado"}', 'individual', '{"Registrar incidencias y pendientes con responsable"}');

-- Las tareas viejas de este turno salen de la rutina desde mañana (con su
-- versión de hoy guardada: la agenda de hoy no cambia).
do $$
declare r record; v_turno integer;
begin
  select id into v_turno from public.turnos_plantilla where nombre::text = 'tarde';
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
  select id into v_turno from public.turnos_plantilla where nombre::text = 'tarde';
  select count(*) into v_n from public.tareas_recurrentes where turno_id = v_turno and codigo like 'T%' and activa;
  select count(*) into v_viejas from public.tareas_recurrentes where turno_id = v_turno and codigo is null and activa;
  if v_n <> 13 or v_viejas <> 0 then
    raise exception '286: quedaron % tareas del Anexo (tienen que ser 13) y % viejas activas.', v_n, v_viejas;
  end if;
end $$;

notify pgrst, 'reload schema';
