-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  277 · Tareas v2: mover en la agenda, corregir horas, checklist y   ║
-- ║  nota para el próximo turno (Etapa 1 · bloque E)                     ║
-- ║                                                                     ║
-- ║   · fn_agenda_mover(tarea, inicio, fin, sin_hora, área, asignados):  ║
-- ║     encargada o admin. Cambia horario, área o a quién (individual:   ║
-- ║     una persona; grupal: los participantes). Lo asignado a mano se   ║
-- ║     libera solo con franco o licencia (270).                         ║
-- ║   · fn_tarea_corregir_hora(tarea, 'iniciada'|'completada', hora):    ║
-- ║     encargada o admin; la encargada no corrige lo que marcó ella.    ║
-- ║     Guarda la hora original la primera vez.                          ║
-- ║   · fn_tarea_checklist_paso(tarea, paso, hecho) y                    ║
-- ║     fn_tarea_nota(tarea, nota): quien puede operar la tarea.         ║
-- ║  Todo queda en el registro. Requiere la 276. Se puede correr de      ║
-- ║  nuevo. Última línea del archivo: "notify pgrst, 'reload schema';"   ║
-- ╚════════════════════════════════════════════════════════════════════╝

do $$
begin
  if to_regprocedure('public.fn_tarea_editar(uuid,jsonb)') is null then
    raise exception '277: falta la 276.';
  end if;
end $$;

create or replace function public.fn_agenda_mover(
  p_tarea_id uuid, p_inicio_at timestamptz default null, p_fin_at timestamptz default null,
  p_sin_hora boolean default false, p_area public.tarea_area default null,
  p_asignados integer[] default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_t record; v_hora time := null; v_dur integer := null; v_antes jsonb := '{}'; v_despues jsonb := '{}';
  v_part integer[]; v_nuevos integer[];
begin
  perform public.fn_tarea_puede_gestionar(p_tarea_id);
  select * into v_t from public.tareas_turno where id = p_tarea_id for update;
  if v_t.estado not in ('pendiente', 'vencida') or v_t.iniciada_at is not null then
    raise exception 'Solo se mueven tareas que nadie empezó (estado actual: %).', v_t.estado;
  end if;

  -- Horario
  if p_sin_hora or p_inicio_at is not null then
    if not p_sin_hora then
      if p_fin_at is null or p_fin_at <= p_inicio_at then
        raise exception 'El fin tiene que ser posterior al inicio.';
      end if;
      if p_inicio_at < public.fn_tarea_inicio_turno(v_t.fecha, v_t.turno_id)
         or p_fin_at > public.fn_tarea_fin_turno(v_t.fecha, v_t.turno_id) then
        raise exception 'El horario tiene que quedar dentro del turno.';
      end if;
      v_hora := (p_inicio_at at time zone 'America/Argentina/La_Rioja')::time;
      v_dur := (extract(epoch from (p_fin_at - p_inicio_at)) / 60)::integer;
    end if;
    if (v_hora, v_dur) is distinct from (v_t.hora, v_t.duracion_min) then
      v_antes := v_antes || jsonb_build_object('hora', v_t.hora, 'duracion_min', v_t.duracion_min);
      v_despues := v_despues || jsonb_build_object('hora', v_hora, 'duracion_min', v_dur);
      update public.tareas_turno
         set hora = v_hora, duracion_min = v_dur, contenido_tocado_at = coalesce(contenido_tocado_at, now())
       where id = p_tarea_id;
    end if;
  end if;

  if p_area is not null and p_area is distinct from v_t.area then
    v_antes := v_antes || jsonb_build_object('area', v_t.area);
    v_despues := v_despues || jsonb_build_object('area', p_area);
    update public.tareas_turno set area = p_area, contenido_tocado_at = coalesce(contenido_tocado_at, now())
     where id = p_tarea_id;
  end if;

  -- Asignados
  if p_asignados is not null then
    if v_t.privada then raise exception 'Las tareas privadas no tienen asignados.'; end if;
    select array_agg(distinct x order by x) into v_nuevos from unnest(p_asignados) x;
    if v_nuevos is null or exists (select 1 from unnest(v_nuevos) x(id)
         where not exists (select 1 from public.empleados e where e.id = x.id and e.activo)) then
      raise exception 'Elegí personas activas.';
    end if;
    if v_t.empleado_id is not null then
      if cardinality(v_nuevos) <> 1 then
        raise exception 'Esta tarea es de una sola persona.';
      end if;
      if v_nuevos[1] <> v_t.empleado_id then
        if v_t.plantilla_id is not null and exists (select 1 from public.tareas_turno x
             where x.plantilla_id = v_t.plantilla_id and x.fecha = v_t.fecha and x.empleado_id = v_nuevos[1]) then
          raise exception 'Esa persona ya tiene esta tarea ese día.';
        end if;
        v_antes := v_antes || jsonb_build_object('empleado_id', v_t.empleado_id);
        v_despues := v_despues || jsonb_build_object('empleado_id', v_nuevos[1]);
        update public.tareas_turno set empleado_id = v_nuevos[1], asignacion_manual = true, notas = null
         where id = p_tarea_id;
      end if;
    else
      select array_agg(empleado_id order by empleado_id) into v_part
        from public.tareas_turno_participantes where tarea_id = p_tarea_id;
      if v_part is distinct from v_nuevos then
        delete from public.tareas_turno_participantes where tarea_id = p_tarea_id and empleado_id <> all(v_nuevos);
        insert into public.tareas_turno_participantes (tarea_id, empleado_id)
        select p_tarea_id, x from unnest(v_nuevos) x on conflict do nothing;
        update public.tareas_turno set asignacion_manual = true where id = p_tarea_id;
        v_antes := v_antes || jsonb_build_object('participantes', v_part);
        v_despues := v_despues || jsonb_build_object('participantes', v_nuevos);
      end if;
    end if;
  end if;

  if v_antes <> '{}'::jsonb then
    perform public.fn_tarea_evento('editada', p_tarea_id, null, v_antes, v_despues, null, 'app:mover');
  end if;
end $$;

create or replace function public.fn_tarea_corregir_hora(p_tarea_id uuid, p_campo text, p_nueva timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare v_t record; v_emp integer;
begin
  perform public.fn_tarea_puede_gestionar(p_tarea_id);
  if p_campo not in ('iniciada', 'completada') then raise exception 'Campo inválido.'; end if;
  select * into v_t from public.tareas_turno where id = p_tarea_id for update;
  select id into v_emp from public.empleados where usuario_id = auth.uid();
  if not public.fn_tiene_permiso('tareas_admin')
     and ((v_emp is not null and v_emp in (v_t.iniciada_por, v_t.completada_por, v_t.empleado_id))
          or auth.uid() in (v_t.iniciada_por_usuario, v_t.completada_por_usuario)) then
    raise exception 'No podés corregir la hora de una tarea tuya: pedíselo a un administrador.';
  end if;
  if p_nueva is null or p_nueva > now() then raise exception 'La hora no puede ser futura.'; end if;
  if p_nueva < public.fn_tarea_inicio_turno(v_t.fecha, v_t.turno_id) - interval '12 hours' then
    raise exception 'La hora está demasiado lejos del turno.';
  end if;
  if p_campo = 'iniciada' then
    if v_t.iniciada_at is null then raise exception 'La tarea no fue iniciada.'; end if;
    if v_t.completada_at is not null and p_nueva > v_t.completada_at then
      raise exception 'El inicio no puede ser posterior a cuando se completó.';
    end if;
    update public.tareas_turno set iniciada_at = p_nueva,
      iniciada_at_original = coalesce(iniciada_at_original, iniciada_at) where id = p_tarea_id;
    perform public.fn_tarea_evento('hora_corregida', p_tarea_id, null,
      jsonb_build_object('iniciada_at', v_t.iniciada_at), jsonb_build_object('iniciada_at', p_nueva), null, 'app');
  else
    if v_t.completada_at is null or v_t.estado <> 'completada' then
      raise exception 'La tarea no está completada.';
    end if;
    if v_t.iniciada_at is not null and p_nueva < v_t.iniciada_at then
      raise exception 'No puede haberse completado antes de iniciarse.';
    end if;
    update public.tareas_turno set completada_at = p_nueva,
      completada_at_original = coalesce(completada_at_original, completada_at) where id = p_tarea_id;
    perform public.fn_tarea_evento('hora_corregida', p_tarea_id, null,
      jsonb_build_object('completada_at', v_t.completada_at), jsonb_build_object('completada_at', p_nueva), null, 'app');
  end if;
end $$;

create or replace function public.fn_tarea_checklist_paso(p_tarea_id uuid, p_paso integer, p_hecho boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_t record; v_estado jsonb;
begin
  perform public.fn_tarea_puede_operar(p_tarea_id);
  select estado, checklist, checklist_estado into v_t from public.tareas_turno where id = p_tarea_id for update;
  if v_t.estado not in ('pendiente', 'en_curso', 'vencida') then
    raise exception 'La tarea está cerrada (%).', v_t.estado;
  end if;
  if p_paso is null or p_paso < 0 or p_paso >= coalesce(cardinality(v_t.checklist), 0) then
    raise exception 'Ese paso no existe.';
  end if;
  select jsonb_agg(case when i - 1 = p_paso then to_jsonb(coalesce(p_hecho, false))
                        else coalesce(v_t.checklist_estado -> (i - 1), 'false'::jsonb) end order by i)
    into v_estado from generate_series(1, cardinality(v_t.checklist)) i;
  update public.tareas_turno set checklist_estado = v_estado where id = p_tarea_id;
  perform public.fn_tarea_evento('checklist_paso', p_tarea_id, null, null,
    jsonb_build_object('paso', p_paso, 'texto', v_t.checklist[p_paso + 1], 'hecho', coalesce(p_hecho, false)),
    null, 'app');
end $$;

create or replace function public.fn_tarea_nota(p_tarea_id uuid, p_nota text)
returns void language plpgsql security definer set search_path = public as $$
declare v_antes text; v_nota text := nullif(btrim(p_nota), '');
begin
  perform public.fn_tarea_puede_operar(p_tarea_id);
  if length(v_nota) > 1000 then raise exception 'La nota no puede superar los 1000 caracteres.'; end if;
  select nota_proximo_turno into v_antes from public.tareas_turno where id = p_tarea_id for update;
  if v_antes is not distinct from v_nota then return; end if;
  update public.tareas_turno set nota_proximo_turno = v_nota where id = p_tarea_id;
  perform public.fn_tarea_evento('nota_editada', p_tarea_id, null,
    jsonb_build_object('nota_proximo_turno', v_antes), jsonb_build_object('nota_proximo_turno', v_nota), null, 'app');
end $$;

revoke execute on function public.fn_agenda_mover(uuid, timestamptz, timestamptz, boolean, public.tarea_area, integer[]) from public, anon;
revoke execute on function public.fn_tarea_corregir_hora(uuid, text, timestamptz) from public, anon;
revoke execute on function public.fn_tarea_checklist_paso(uuid, integer, boolean) from public, anon;
revoke execute on function public.fn_tarea_nota(uuid, text) from public, anon;
grant execute on function public.fn_agenda_mover(uuid, timestamptz, timestamptz, boolean, public.tarea_area, integer[]) to authenticated;
grant execute on function public.fn_tarea_corregir_hora(uuid, text, timestamptz) to authenticated;
grant execute on function public.fn_tarea_checklist_paso(uuid, integer, boolean) to authenticated;
grant execute on function public.fn_tarea_nota(uuid, text) to authenticated;

do $$
begin
  if (select count(*) from pg_proc where proname in ('fn_agenda_mover', 'fn_tarea_corregir_hora',
        'fn_tarea_checklist_paso', 'fn_tarea_nota')) <> 4 then
    raise exception '277: faltan funciones (o hay duplicadas).';
  end if;
end $$;

notify pgrst, 'reload schema';
