-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 253 · Acciones de la agenda por turno (RPCs)             ║
-- ║                                                                     ║
-- ║  tareas_turno solo lo escribe `tareas_gestion` (RLS, mig 158): el   ║
-- ║  empleado opera por RPC. Se agregan, con la misma regla de permiso  ║
-- ║  que fn_completar_tarea (gestión, el responsable o un participante):║
-- ║   · fn_iniciar_tarea     pendiente/vencida → en_curso, registra     ║
-- ║                          quién y cuándo                             ║
-- ║   · fn_omitir_tarea      → cancelada con motivo obligatorio         ║
-- ║   · fn_trasladar_tarea   crea la instancia en el turno siguiente    ║
-- ║                          (trasladada_de/trasladada_a) y cancela la  ║
-- ║                          original; devuelve el id nuevo             ║
-- ║   · fn_reabrir_tarea     completada/cancelada/vencida → pendiente,  ║
-- ║                          SOLO gestión                               ║
-- ║  Y se reemite fn_marcar_tareas_vencidas para no vencer a las 06:00  ║
-- ║  la noche que arrancó ayer y todavía está en curso.                 ║
-- ║  Las canceladas no cuentan en fn_cumplimiento_tareas (mig 158).     ║
-- ║  REQUIERE: mig 251. Primero PRUEBA, después PRODUCCIÓN.             ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─── Helper privado: ¿puede operar esta tarea? ──────────────────────────
create or replace function public.fn_tarea_puede_operar(p_tarea_id uuid)
returns integer language plpgsql stable security definer set search_path = public as $$
declare v_t record; v_emp integer;
begin
  select id, empleado_id into v_t from public.tareas_turno where id = p_tarea_id;
  if v_t.id is null then raise exception 'Tarea inexistente.'; end if;
  select id into v_emp from public.empleados where usuario_id = auth.uid();
  if public.fn_tiene_permiso('tareas_gestion') then return v_emp; end if;
  if v_t.empleado_id is not null then
    if v_emp is null or v_emp <> v_t.empleado_id then
      raise exception 'Sin permiso para operar esta tarea.';
    end if;
  elsif v_emp is null or not exists (
      select 1 from public.tareas_turno_participantes p
      where p.tarea_id = p_tarea_id and p.empleado_id = v_emp) then
    raise exception 'Sin permiso para operar esta tarea.';
  end if;
  return v_emp;
end $$;
revoke execute on function public.fn_tarea_puede_operar(uuid) from public;

-- ─── fn_iniciar_tarea ───────────────────────────────────────────────────
create or replace function public.fn_iniciar_tarea(p_tarea_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_emp integer; v_estado public.estado_tarea_turno;
begin
  v_emp := public.fn_tarea_puede_operar(p_tarea_id);
  select estado into v_estado from public.tareas_turno where id = p_tarea_id;
  if v_estado not in ('pendiente', 'vencida') then
    raise exception 'La tarea no se puede iniciar en su estado actual (%).', v_estado;
  end if;
  update public.tareas_turno
    set estado = 'en_curso', iniciada_por = v_emp, iniciada_at = now()
    where id = p_tarea_id;
end $$;
grant execute on function public.fn_iniciar_tarea(uuid) to authenticated;

-- ─── fn_omitir_tarea ────────────────────────────────────────────────────
create or replace function public.fn_omitir_tarea(p_tarea_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare v_estado public.estado_tarea_turno;
begin
  perform public.fn_tarea_puede_operar(p_tarea_id);
  if p_motivo is null or length(btrim(p_motivo)) < 5 then
    raise exception 'Indicá el motivo para omitir la tarea (mínimo 5 caracteres).';
  end if;
  select estado into v_estado from public.tareas_turno where id = p_tarea_id;
  if v_estado not in ('pendiente', 'en_curso', 'vencida') then
    raise exception 'La tarea no se puede omitir en su estado actual (%).', v_estado;
  end if;
  update public.tareas_turno
    set estado = 'cancelada', motivo_omision = btrim(p_motivo)
    where id = p_tarea_id;
end $$;
grant execute on function public.fn_omitir_tarea(uuid, text) to authenticated;

-- ─── fn_reabrir_tarea (solo gestión) ────────────────────────────────────
create or replace function public.fn_reabrir_tarea(p_tarea_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_t record;
begin
  if not public.fn_tiene_permiso('tareas_gestion') then
    raise exception 'Solo gestión puede reabrir una tarea.';
  end if;
  select * into v_t from public.tareas_turno where id = p_tarea_id;
  if v_t.id is null then raise exception 'Tarea inexistente.'; end if;
  if v_t.estado not in ('completada', 'cancelada', 'vencida') then
    raise exception 'La tarea ya está abierta (%).', v_t.estado;
  end if;
  if v_t.trasladada_a is not null then
    raise exception 'La tarea fue trasladada al turno siguiente: operá sobre la nueva.';
  end if;
  update public.tareas_turno
    set estado = 'pendiente', completada_por = null, completada_at = null,
        evidencia_url = null, motivo_omision = null,
        iniciada_por = null, iniciada_at = null
    where id = p_tarea_id;
end $$;
grant execute on function public.fn_reabrir_tarea(uuid) to authenticated;

-- ─── fn_trasladar_tarea → turno siguiente ───────────────────────────────
-- Turno siguiente = el próximo activo por hora_inicio (cíclico). Si el
-- actual cruza medianoche (noche), el siguiente es del día +1; si la tarea
-- no tiene turno, va al mismo día sin turno.
create or replace function public.fn_trasladar_tarea(p_tarea_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_t record; v_emp integer; v_fecha date; v_nuevo uuid;
  v_sig_id integer; v_nombre_sig text;
begin
  v_emp := public.fn_tarea_puede_operar(p_tarea_id);
  select * into v_t from public.tareas_turno where id = p_tarea_id;
  if v_t.estado not in ('pendiente', 'en_curso', 'vencida') then
    raise exception 'La tarea no se puede trasladar en su estado actual (%).', v_t.estado;
  end if;
  if v_t.trasladada_a is not null then
    raise exception 'La tarea ya fue trasladada.';
  end if;

  v_fecha := v_t.fecha;
  if v_t.turno_id is not null then
    with ordenados as (
      select tp.id, tp.nombre, row_number() over (order by tp.hora_inicio) as n,
             count(*) over () as total
      from public.turnos_plantilla tp where tp.activo or tp.id = v_t.turno_id
    ), actual as (
      select n from ordenados where id = v_t.turno_id
    )
    select o.id, o.nombre::text into v_sig_id, v_nombre_sig
    from ordenados o, actual a
    where o.n = (a.n % o.total) + 1 and o.id <> v_t.turno_id;
    if v_sig_id is null then
      raise exception 'No hay un turno siguiente activo.';
    end if;
    if exists (select 1 from public.turnos_plantilla where id = v_t.turno_id and cruza_medianoche) then
      v_fecha := v_t.fecha + 1;
    end if;
  end if;

  insert into public.tareas_turno (
    plantilla_id, titulo, descripcion, empleado_id, turno_id, fecha,
    prioridad, requiere_evidencia, estado, modo, usuario_id, notas,
    hora, duracion_min, ventana_min, tipo_actividad, checklist,
    fijada, trasladada_de
  ) values (
    null, v_t.titulo, v_t.descripcion, v_t.empleado_id,
    coalesce(v_sig_id, v_t.turno_id), v_fecha,
    v_t.prioridad, v_t.requiere_evidencia, 'pendiente', v_t.modo, v_t.usuario_id,
    'Trasladada desde el turno anterior (' || to_char(v_t.fecha, 'DD/MM') || ')',
    null, v_t.duracion_min, v_t.ventana_min, v_t.tipo_actividad, v_t.checklist,
    true, v_t.id
  ) returning id into v_nuevo;

  insert into public.tareas_turno_participantes (tarea_id, empleado_id)
  select v_nuevo, empleado_id from public.tareas_turno_participantes
  where tarea_id = v_t.id on conflict do nothing;

  update public.tareas_turno
    set estado = 'cancelada', trasladada_a = v_nuevo,
        motivo_omision = coalesce(motivo_omision,
          'Trasladada al turno ' || coalesce(v_nombre_sig, 'siguiente') ||
          ' del ' || to_char(v_fecha, 'DD/MM'))
    where id = v_t.id;

  perform public.fn_auditar(auth.uid(), 'trasladar_tarea', 'tareas_turno', null,
    jsonb_build_object('tarea_id', v_t.id, 'nueva_id', v_nuevo, 'fecha', v_fecha,
                       'turno_id', coalesce(v_sig_id, v_t.turno_id), 'empleado_id', v_emp));
  return v_nuevo;
end $$;
grant execute on function public.fn_trasladar_tarea(uuid) to authenticated;

-- ─── fn_marcar_tareas_vencidas v2 ───────────────────────────────────────
-- El cron corre 06:00 AR: la noche de ayer sigue viva hasta su hora_fin.
create or replace function public.fn_marcar_tareas_vencidas()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_n integer;
  v_ahora timestamp := timezone('America/Argentina/Buenos_Aires', now());
  v_hoy date := v_ahora::date;
begin
  update public.tareas_turno t
    set estado = 'vencida'
    from (select t2.id from public.tareas_turno t2
          left join public.turnos_plantilla tp on tp.id = t2.turno_id
          where t2.estado in ('pendiente', 'en_curso')
            and (t2.fecha < v_hoy - 1
                 or (t2.fecha = v_hoy - 1
                     and not (coalesce(tp.cruza_medianoche, false)
                              and v_ahora::time < tp.hora_fin)))) x
    where t.id = x.id;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke execute on function public.fn_marcar_tareas_vencidas() from public;
grant execute on function public.fn_marcar_tareas_vencidas() to service_role;

notify pgrst, 'reload schema';

-- Chequeo T1 (debe dar 0 filas):
-- select proname, count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
-- where n.nspname='public' and proname like 'fn_%' group by proname having count(*)>1;
