-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  270 · Tareas v2: sincronización, parte 1 (preparar y reasignar)    ║
-- ║  (Etapa 1 · bloque D)                                                ║
-- ║                                                                     ║
-- ║  Funciones internas que usa la sincronización nueva (271):           ║
-- ║   · fn_tareas_sync_preparar(fecha, turno): arma la rutina vigente    ║
-- ║     del día, a quién le toca cada tarea, quién trabaja en cada turno ║
-- ║     y quién tiene franco o licencia.                                 ║
-- ║   · fn_tareas_sync_reasignar(fecha, turno), en turnos que no         ║
-- ║     terminaron y sobre tareas pendientes que nadie empezó:           ║
-- ║      1. borra las de plantillas que ya no aplican (solo de mañana en ║
-- ║         adelante, o desde el "aplica desde" de un cambio);           ║
-- ║      2. las de la rutina siguen al cronograma: si el dueño ya no le  ║
-- ║         toca, pasa a quien le toca (si la editaron a mano, viaja con ║
-- ║         lo editado; si no, se recrea);                               ║
-- ║      3. las asignadas a mano y las puntuales pasan a quien cubre si  ║
-- ║         el dueño tiene franco o licencia ese día (las puntuales por  ║
-- ║         puesto, además, si su dueño no está en el turno).            ║
-- ║     Cada movimiento queda en el registro como "reasignada" (HEX).    ║
-- ║  Nada se mueve en un turno sin gente cargada en el cronograma.       ║
-- ║                                                                     ║
-- ║  No cambia nada visible todavía (lo usa la 272). Requiere 266–269.   ║
-- ║  Última línea del archivo: "notify pgrst, 'reload schema';"          ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- Evento de la generación: actor = sistema ("HEX"), con quién lo disparó.
create or replace function public.fn_tarea_evento_sistema(
  p_tipo public.tarea_evento_tipo, p_tarea_turno_id uuid, p_antes jsonb, p_despues jsonb, p_motivo text)
returns void language sql security definer set search_path = public as $$
  insert into public.tareas_eventos (entidad, tipo, tarea_turno_id, tarea_recurrente_id, turno_id,
    fecha, titulo, privada, duenos, actor_nombre, antes, despues, motivo, origen)
  select 'agenda', p_tipo, t.id, t.plantilla_id, t.turno_id, t.fecha, t.titulo, t.privada,
         case when t.empleado_id is not null then array[t.empleado_id] else '{}' end,
         'HEX', p_antes, coalesce(p_despues, '{}'::jsonb) || jsonb_build_object('disparado_por', auth.uid()),
         p_motivo, 'generacion'
  from public.tareas_turno t where t.id = p_tarea_turno_id
$$;

create or replace function public.fn_tareas_sync_preparar(p_fecha date, p_turno_id integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  create temp table if not exists tmp_sync_p (like public.tareas_recurrentes, hora_resuelta time)
    on commit drop;
  truncate tmp_sync_p;
  insert into tmp_sync_p
  select p.*, coalesce(p.hora,
           case when p.minutos_desde_inicio is not null and tp.hora_inicio is not null
                then (tp.hora_inicio + make_interval(mins => p.minutos_desde_inicio))::time end)
  from public.fn_plantillas_tareas_dia(p_fecha) p
  left join public.turnos_plantilla tp on tp.id = p.turno_id
  where p_turno_id is null or p.turno_id = p_turno_id;

  create temp table if not exists tmp_sync_w (empleado_id integer, turno_id integer, rol text) on commit drop;
  truncate tmp_sync_w;
  insert into tmp_sync_w
  select h.empleado_id, h.turno_id, e.rol_operativo
  from public.horarios_asignados h join public.empleados e on e.id = h.empleado_id and e.activo
  where h.fecha = p_fecha and h.estado in ('planificado', 'cubierto') and h.turno_id is not null;

  create temp table if not exists tmp_sync_f (empleado_id integer primary key, nombre text) on commit drop;
  truncate tmp_sync_f;
  insert into tmp_sync_f
  select distinct on (h.empleado_id) h.empleado_id, e.nombre || coalesce(' ' || e.apellido, '')
  from public.horarios_asignados h join public.empleados e on e.id = h.empleado_id
  where h.fecha = p_fecha and h.estado in ('franco', 'licencia');

  -- A quién le toca cada plantilla (sin privadas: las hace un administrador).
  -- De mañana en adelante, las de puesto de un turno sin gente cargada se
  -- dejan para cuando se cargue el cronograma.
  create temp table if not exists tmp_sync_o (plantilla_id uuid, empleado_id integer, notas text,
    primary key (plantilla_id, empleado_id)) on commit drop;
  truncate tmp_sync_o;
  insert into tmp_sync_o
  select o.plantilla_id, o.empleado_id, o.notas
  from public.fn_asignados_tareas_dia(p_fecha) o
  join tmp_sync_p p on p.id = o.plantilla_id and not p.privada
  where p_fecha <= public.fn_tareas_hoy() or p.alcance <> 'puesto'
     or exists (select 1 from tmp_sync_w w where w.turno_id = p.turno_id);
end;
$$;

-- Reemplazo para una tarea cuyo dueño no está: alguien del mismo puesto en
-- ese turno; si no hay, el orden de cobertura. Nunca el mismo dueño ni
-- quien ya tiene esa misma tarea de la rutina ese día.
create or replace function public.fn_tareas_sync_cubre(p_tarea_id uuid, p_puesto text)
returns integer language plpgsql set search_path = public as $$
declare v integer;
begin
  select w.empleado_id into v
  from public.tareas_turno t
  join tmp_sync_w w on w.turno_id = t.turno_id and w.empleado_id <> t.empleado_id
  where t.id = p_tarea_id
    and (t.plantilla_id is null or not exists (
          select 1 from public.tareas_turno x where x.plantilla_id = t.plantilla_id
             and x.fecha = t.fecha and x.empleado_id = w.empleado_id))
  order by (w.rol = p_puesto) desc,
           case w.rol when 'pivote' then 1 when 'encargado' then 2 when 'responsable_general' then 3
                      when 'cajero' then 4 when 'fiambreria' then 5 else 6 end,
           w.empleado_id
  limit 1;
  return v;
end;
$$;

create or replace function public.fn_tareas_sync_reasignar(p_fecha date, p_turno_id integer)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_n integer := 0; v_m integer; r record; v_dest integer; v_nombre text;
  v_hoy date := public.fn_tareas_hoy();
begin
  -- 1. Plantillas que ya no aplican (o cambiaron de turno/modo/privada).
  delete from public.tareas_turno t
   where t.fecha = p_fecha and t.plantilla_id is not null
     and (p_turno_id is null or t.turno_id = p_turno_id)
     and public.fn_tarea_fin_turno(t.fecha, t.turno_id) > now()
     and t.estado = 'pendiente' and t.iniciada_at is null and t.evidencia_url is null
     and t.rechazos_count = 0 and t.contenido_tocado_at is null and not t.asignacion_manual
     and t.trasladada_de is null and t.nota_proximo_turno is null
     and not exists (select 1 from tmp_sync_p p where p.id = t.plantilla_id
                       and p.turno_id is not distinct from t.turno_id
                       and p.modo = t.modo and p.privada = t.privada)
     and (p_fecha > v_hoy or exists (select 1 from public.tareas_recurrentes x
                                      where x.id = t.plantilla_id and x.cambios_desde <= p_fecha));
  get diagnostics v_m = row_count;
  v_n := v_n + v_m;

  -- 2. Rutina individual que ya no le toca a su dueño.
  for r in
    select t.id, t.plantilla_id, t.empleado_id, t.empleado_rutina_id,
           (t.contenido_tocado_at is null and t.nota_proximo_turno is null) as intacta
    from public.tareas_turno t
    where t.fecha = p_fecha and t.plantilla_id is not null and t.modo = 'individual'
      and (p_turno_id is null or t.turno_id = p_turno_id)
      and public.fn_tarea_fin_turno(t.fecha, t.turno_id) > now()
      and t.estado = 'pendiente' and t.iniciada_at is null and t.evidencia_url is null
      and t.rechazos_count = 0 and not t.asignacion_manual and t.trasladada_de is null
      and exists (select 1 from tmp_sync_o o where o.plantilla_id = t.plantilla_id)
      and not exists (select 1 from tmp_sync_o o where o.plantilla_id = t.plantilla_id
                        and o.empleado_id = t.empleado_rutina_id)
  loop
    select o.empleado_id into v_dest from tmp_sync_o o
     where o.plantilla_id = r.plantilla_id
       and not exists (select 1 from public.tareas_turno x where x.fecha = p_fecha
                         and x.plantilla_id = r.plantilla_id
                         and (x.empleado_id = o.empleado_id or x.empleado_rutina_id = o.empleado_id))
     order by o.empleado_id limit 1;
    if r.intacta or v_dest is null then
      if r.intacta then
        perform public.fn_tarea_evento_sistema('reasignada', r.id,
          jsonb_build_object('empleado_id', r.empleado_id), null, 'Ya no le toca según el cronograma');
        delete from public.tareas_turno where id = r.id;
        v_n := v_n + 1;
      end if;
    else
      update public.tareas_turno
         set empleado_id = v_dest, empleado_rutina_id = v_dest,
             notas = (select o.notas from tmp_sync_o o where o.plantilla_id = r.plantilla_id and o.empleado_id = v_dest)
       where id = r.id;
      perform public.fn_tarea_evento_sistema('reasignada', r.id,
        jsonb_build_object('empleado_id', r.empleado_id), jsonb_build_object('empleado_id', v_dest),
        'Ya no le toca según el cronograma');
      v_n := v_n + 1;
    end if;
  end loop;

  -- 3. Asignadas a mano y puntuales: el dueño tiene franco o licencia (o,
  --    si es puntual por puesto, no está en el turno). Solo con cronograma cargado.
  for r in
    select t.id, t.turno_id, t.empleado_id, coalesce(t.roles_puesto[1], e.rol_operativo) as puesto,
           f.nombre as franco
    from public.tareas_turno t
    join public.empleados e on e.id = t.empleado_id
    left join tmp_sync_f f on f.empleado_id = t.empleado_id
    where t.fecha = p_fecha and t.empleado_id is not null
      and (p_turno_id is null or t.turno_id = p_turno_id)
      and (t.asignacion_manual or t.plantilla_id is null)
      and public.fn_tarea_fin_turno(t.fecha, t.turno_id) > now()
      and t.estado = 'pendiente' and t.iniciada_at is null and t.evidencia_url is null
      and exists (select 1 from tmp_sync_w w where w.turno_id = t.turno_id)
      and (f.empleado_id is not null
           or (t.roles_puesto is not null and not t.asignacion_manual
               and not exists (select 1 from tmp_sync_w w
                                where w.turno_id = t.turno_id and w.empleado_id = t.empleado_id)))
  loop
    v_dest := public.fn_tareas_sync_cubre(r.id, r.puesto);
    continue when v_dest is null;
    select e.nombre || coalesce(' ' || e.apellido, '') into v_nombre
      from public.empleados e where e.id = r.empleado_id;
    update public.tareas_turno set empleado_id = v_dest, notas = 'Cubre a ' || v_nombre where id = r.id;
    perform public.fn_tarea_evento_sistema('reasignada', r.id,
      jsonb_build_object('empleado_id', r.empleado_id), jsonb_build_object('empleado_id', v_dest),
      case when r.franco is not null then v_nombre || ' de franco o licencia según cronograma'
           else v_nombre || ' no está en el turno según cronograma' end);
    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$$;

revoke execute on function public.fn_tarea_evento_sistema(public.tarea_evento_tipo, uuid, jsonb, jsonb, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.fn_tareas_sync_preparar(date, integer) from public, anon, authenticated;
revoke execute on function public.fn_tareas_sync_cubre(uuid, text) from public, anon, authenticated;
revoke execute on function public.fn_tareas_sync_reasignar(date, integer) from public, anon, authenticated;

do $$
begin
  if (select count(*) from pg_proc where proname in ('fn_tarea_evento_sistema', 'fn_tareas_sync_preparar',
        'fn_tareas_sync_cubre', 'fn_tareas_sync_reasignar')) <> 4 then
    raise exception '270: faltan funciones.';
  end if;
end $$;

notify pgrst, 'reload schema';
