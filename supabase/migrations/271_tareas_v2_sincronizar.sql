-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  271 · Tareas v2: sincronización, parte 2 (la función principal)    ║
-- ║  (Etapa 1 · bloque D)                                                ║
-- ║                                                                     ║
-- ║  fn_tareas_sincronizar(fecha, turno opcional) arma la agenda de un   ║
-- ║  día desde la rutina vigente y el cronograma:                        ║
-- ║   · limpia y reasigna (270);                                         ║
-- ║   · pone las notas "Cubre a…";                                       ║
-- ║   · refresca el contenido desde la rutina en lo que nadie tocó (lo   ║
-- ║     editado a mano se respeta);                                      ║
-- ║   · da de alta lo que falta, sin duplicar (correrla dos veces no     ║
-- ║     cambia nada la segunda) y sin recrear lo reasignado a mano;      ║
-- ║   · ajusta los participantes de las grupales.                        ║
-- ║  Nunca toca turnos que ya terminaron ni lo empezado o cerrado.       ║
-- ║                                                                     ║
-- ║  Todavía nadie la llama (lo hace la 272). Requiere la 270.           ║
-- ║  Última línea del archivo: "notify pgrst, 'reload schema';"          ║
-- ╚════════════════════════════════════════════════════════════════════╝

set local lock_timeout = '5s';

-- Una tarea de rutina por (plantilla, día, persona a la que le tocó):
-- así reasignar a mano no hace que se recree la del titular.
-- Antes, las reasignadas a mano que chocan pasan a ser de su dueño actual.
update public.tareas_turno t
   set empleado_rutina_id = t.empleado_id
 where t.asignacion_manual and t.plantilla_id is not null and t.empleado_rutina_id is not null
   and exists (select 1 from public.tareas_turno x
                where x.id <> t.id and x.plantilla_id = t.plantilla_id and x.fecha = t.fecha
                  and x.empleado_rutina_id = t.empleado_rutina_id);

create unique index if not exists tareas_turno_plantilla_fecha_rutina_uq
  on public.tareas_turno (plantilla_id, fecha, empleado_rutina_id)
  where plantilla_id is not null and empleado_rutina_id is not null;

create or replace function public.fn_tareas_sincronizar(p_fecha date, p_turno_id integer default null)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer := 0; v_m integer;
begin
  -- Una sola sincronización por día a la vez (cron, pantallas, cronograma).
  perform pg_advisory_xact_lock(hashtext('tareas:' || p_fecha::text));
  perform public.fn_tareas_sync_preparar(p_fecha, p_turno_id);
  v_n := public.fn_tareas_sync_reasignar(p_fecha, p_turno_id);

  -- Notas "Cubre a…" de la rutina (no en lo asignado a mano ni sobre una
  -- nota escrita por alguien).
  update public.tareas_turno t
     set notas = o.notas
    from tmp_sync_o o
   where t.fecha = p_fecha and t.plantilla_id = o.plantilla_id and t.empleado_id = o.empleado_id
     and t.estado in ('pendiente', 'en_curso') and not t.asignacion_manual
     and (t.notas is null or t.notas like 'Cubre %' or t.notas like 'Sin cronograma%')
     and public.fn_tarea_fin_turno(t.fecha, t.turno_id) > now()
     and t.notas is distinct from o.notas;

  -- Contenido desde la rutina vigente, solo en lo que nadie editó.
  update public.tareas_turno t
     set titulo = p.titulo, descripcion = p.descripcion, prioridad = p.prioridad,
         requiere_evidencia = p.requiere_evidencia, hora = p.hora_resuelta,
         duracion_min = p.duracion_min, ventana_min = p.ventana_min,
         tipo_actividad = p.tipo_actividad, checklist = p.checklist,
         area = p.area, avisar_atraso_min = p.avisar_atraso_min,
         checklist_estado = case when t.checklist is distinct from p.checklist
                                 then '[]'::jsonb else t.checklist_estado end
    from tmp_sync_p p
   where t.fecha = p_fecha and t.plantilla_id = p.id
     and t.estado = 'pendiente' and t.iniciada_at is null and t.contenido_tocado_at is null
     and t.evidencia_url is null and t.rechazos_count = 0
     and public.fn_tarea_fin_turno(t.fecha, t.turno_id) > now()
     and (t.titulo, t.descripcion, t.prioridad, t.requiere_evidencia, t.hora, t.duracion_min,
          t.ventana_min, t.tipo_actividad, t.checklist, t.area, t.avisar_atraso_min)
         is distinct from
         (p.titulo, p.descripcion, p.prioridad, p.requiere_evidencia, p.hora_resuelta, p.duracion_min,
          p.ventana_min, p.tipo_actividad, p.checklist, p.area, p.avisar_atraso_min);

  -- Altas individuales que faltan (no se recrea lo que ya existe o se movió).
  insert into public.tareas_turno (
    plantilla_id, titulo, descripcion, empleado_id, empleado_rutina_id, turno_id, fecha,
    prioridad, requiere_evidencia, estado, modo, usuario_id, notas,
    hora, duracion_min, ventana_min, tipo_actividad, checklist, area, avisar_atraso_min)
  select p.id, p.titulo, p.descripcion, o.empleado_id, o.empleado_id, p.turno_id, p_fecha,
         p.prioridad, p.requiere_evidencia, 'pendiente', 'individual', p.usuario_id, o.notas,
         p.hora_resuelta, p.duracion_min, p.ventana_min, p.tipo_actividad, p.checklist,
         p.area, p.avisar_atraso_min
  from tmp_sync_o o
  join tmp_sync_p p on p.id = o.plantilla_id
  where p.modo = 'individual' and not p.privada
    and public.fn_tarea_fin_turno(p_fecha, p.turno_id) > now()
    and not exists (select 1 from public.tareas_turno x
                     where x.fecha = p_fecha and x.plantilla_id = p.id
                       and (x.empleado_id = o.empleado_id or x.empleado_rutina_id = o.empleado_id))
  on conflict do nothing;
  get diagnostics v_m = row_count;
  v_n := v_n + v_m;

  -- Grupales y privadas: una sola fila por plantilla y día.
  insert into public.tareas_turno (
    plantilla_id, titulo, descripcion, empleado_id, turno_id, fecha,
    prioridad, requiere_evidencia, estado, modo, usuario_id,
    hora, duracion_min, ventana_min, tipo_actividad, checklist, area, avisar_atraso_min)
  select p.id, p.titulo, p.descripcion, null, p.turno_id, p_fecha,
         p.prioridad, p.requiere_evidencia, 'pendiente', p.modo, p.usuario_id,
         p.hora_resuelta, p.duracion_min, p.ventana_min, p.tipo_actividad, p.checklist,
         p.area, p.avisar_atraso_min
  from tmp_sync_p p
  where (p.modo = 'grupal' or p.privada)
    and public.fn_tarea_fin_turno(p_fecha, p.turno_id) > now()
    and (p.privada or exists (select 1 from tmp_sync_o o where o.plantilla_id = p.id))
    and not exists (select 1 from public.tareas_turno x
                     where x.fecha = p_fecha and x.plantilla_id = p.id and x.empleado_id is null)
  on conflict do nothing;
  get diagnostics v_m = row_count;
  v_n := v_n + v_m;

  -- Participantes de las grupales abiertas: sacar a quien ya no le toca
  -- (solo si nadie la empezó, y nunca a quien la inició) y sumar a quien falta.
  delete from public.tareas_turno_participantes pp
   using public.tareas_turno t
   where pp.tarea_id = t.id
     and t.fecha = p_fecha and t.empleado_id is null and t.plantilla_id is not null
     and (p_turno_id is null or t.turno_id = p_turno_id)
     and t.estado = 'pendiente' and t.iniciada_at is null and not t.asignacion_manual
     and public.fn_tarea_fin_turno(t.fecha, t.turno_id) > now()
     and exists (select 1 from tmp_sync_o o where o.plantilla_id = t.plantilla_id)
     and not exists (select 1 from tmp_sync_o o
                      where o.plantilla_id = t.plantilla_id and o.empleado_id = pp.empleado_id);
  get diagnostics v_m = row_count;
  v_n := v_n + v_m;

  insert into public.tareas_turno_participantes (tarea_id, empleado_id)
  select t.id, o.empleado_id
  from tmp_sync_o o
  join tmp_sync_p p on p.id = o.plantilla_id and p.modo = 'grupal'
  join public.tareas_turno t
    on t.plantilla_id = o.plantilla_id and t.fecha = p_fecha and t.empleado_id is null
  where t.estado in ('pendiente', 'en_curso') and not t.asignacion_manual and not t.privada
    and public.fn_tarea_fin_turno(t.fecha, t.turno_id) > now()
  on conflict do nothing;
  get diagnostics v_m = row_count;
  v_n := v_n + v_m;

  return v_n;
end;
$$;

revoke execute on function public.fn_tareas_sincronizar(date, integer) from public, anon, authenticated;

do $$
begin
  if to_regclass('public.tareas_turno_plantilla_fecha_rutina_uq') is null
     or not exists (select 1 from pg_proc where proname = 'fn_tareas_sincronizar') then
    raise exception '271: falta el índice o la función.';
  end if;
end $$;

notify pgrst, 'reload schema';
