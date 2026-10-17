-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  285 · Tareas v2: rutina del Anexo A, turno mañana   (07–15)        ║
-- ║                                                                     ║
-- ║   · Carga las 16 tareas del Anexo A de este turno (códigos M01–M16) ║
-- ║     con horario (minutos desde el inicio del turno), duración, área, ║
-- ║     puesto y prioridad (● = alta, con aviso a los 15 min; el resto   ║
-- ║     media). "Todo el turno" = recordatorio (no se marca).            ║
-- ║   · Control y seguridad → Encargada de sucursal (Sonia).             ║
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
    raise exception '285: faltan migraciones anteriores (279 o 284).';
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

select pg_temp.fn_anexo('M01', 'manana', null, null, 'atencion_caja', 'Atención y ventas a clientes',
  false, '{"cajero"}', 'individual', '{}');
select pg_temp.fn_anexo('M02', 'manana', null, null, 'atencion_caja', 'Anotar productos nuevos que sugieren los clientes',
  false, '{"cajero"}', 'individual', '{}');
select pg_temp.fn_anexo('M03', 'manana', null, null, 'produccion_fiambreria', 'Venta de fiambre y sándwiches',
  false, '{"fiambreria"}', 'individual', '{}');
select pg_temp.fn_anexo('M04', 'manana', '07:00', '07:15', 'control_seguridad', 'Traspaso con el turno noche: caja, novedades, pedidos pendientes',
  true, '{"responsable_general"}', 'individual', '{"Recibir caja y novedades de la noche","Recorrer salón, caja, fiambrería y zonas críticas (orden y limpieza)"}');
select pg_temp.fn_anexo('M05', 'manana', '07:05', '07:15', 'produccion_fiambreria', 'Exhibir pan, facturas y medialunas de las 06:30',
  false, '{"fiambreria"}', 'individual', '{}');
select pg_temp.fn_anexo('M06', 'manana', '07:30', '07:45', 'control_seguridad', 'Controlar los productos para la elaboración de los próximos días',
  true, '{"responsable_general"}', 'individual', '{}');
select pg_temp.fn_anexo('M07', 'manana', '07:30', '09:30', 'atencion_caja', 'Preparar el área de caja: exhibidor, combos, golosinas, precios',
  true, '{"cajero"}', 'individual', '{"Precios visibles y correctos","Música y ambiente acordes"}');
select pg_temp.fn_anexo('M08', 'manana', '07:30', '10:30', 'produccion_fiambreria', '1.ª tanda de producción (milanesas y sándwiches)',
  true, '{"fiambreria"}', 'individual', '{"Registrar en HEX la producción hecha"}');
select pg_temp.fn_anexo('M09', 'manana', '08:00', '10:30', 'reposicion_limpieza', 'Reposición y control de góndolas, etiquetas de precio',
  false, '{"cajero","fiambreria"}', 'grupal', '{"Conteo cíclico del sector del día"}');
select pg_temp.fn_anexo('M10', 'manana', '08:00', '15:00', 'reposicion_limpieza', 'Recepción de proveedores: remito, vencimientos, carga en HEX',
  true, '{"cajero","fiambreria"}', 'grupal', '{}');
select pg_temp.fn_anexo('M11', 'manana', '08:15', null, 'control_seguridad', 'Control de temperaturas (1 de 3)',
  true, '{"responsable_general"}', 'individual', '{}');
select pg_temp.fn_anexo('M12', 'manana', '10:30', '11:30', 'control_seguridad', 'Vencimientos: lo vencido afuera, lo que vence en 30 días a oferta o combo',
  true, '{"responsable_general"}', 'individual', '{}');
select pg_temp.fn_anexo('M13', 'manana', '11:30', null, 'control_seguridad', 'Verificar el sugerido de compras de HEX contra lo físico',
  true, '{"responsable_general"}', 'individual', '{}');
select pg_temp.fn_anexo('M14', 'manana', '14:00', '14:40', 'produccion_fiambreria', 'Limpieza de fiambrería y cocina',
  true, '{"fiambreria"}', 'individual', '{}');
select pg_temp.fn_anexo('M15', 'manana', '14:30', '14:45', 'reposicion_limpieza', 'Reponer bebidas frías para la tarde',
  false, '{"cajero","fiambreria"}', 'grupal', '{}');
select pg_temp.fn_anexo('M16', 'manana', '14:40', '15:00', 'control_seguridad', 'Cierre de turno: arqueo ciego, novedades, entrega',
  true, '{"responsable_general"}', 'individual', '{"Registrar incidencias y pendientes del turno"}');

-- Las tareas viejas de este turno salen de la rutina desde mañana (con su
-- versión de hoy guardada: la agenda de hoy no cambia).
do $$
declare r record; v_turno integer;
begin
  select id into v_turno from public.turnos_plantilla where nombre::text = 'manana';
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
  select id into v_turno from public.turnos_plantilla where nombre::text = 'manana';
  select count(*) into v_n from public.tareas_recurrentes where turno_id = v_turno and codigo like 'M%' and activa;
  select count(*) into v_viejas from public.tareas_recurrentes where turno_id = v_turno and codigo is null and activa;
  if v_n <> 16 or v_viejas <> 0 then
    raise exception '285: quedaron % tareas del Anexo (tienen que ser 16) y % viejas activas.', v_n, v_viejas;
  end if;
end $$;

notify pgrst, 'reload schema';
