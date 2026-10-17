-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  267 · Tareas v2: trigger de la agenda (tareas_turno)                ║
-- ║  (Etapa 1 · bloque C)                                                ║
-- ║                                                                     ║
-- ║  En cada alta o cambio de una tarea del día:                         ║
-- ║   · origen (rutina / puntual; la trasladada hereda el de la original);║
-- ║   · privada, área y aviso se heredan de la plantilla; privada y      ║
-- ║     origen no se pueden cambiar después;                             ║
-- ║   · horario absoluto: inicio_at, fin_at y limite_at (atraso = pasó   ║
-- ║     fin_at; sin hora = fin del turno; continuas y bloques no se      ║
-- ║     atrasan) y minutos desde el inicio del turno;                    ║
-- ║   · marcas para la sincronización: "contenido editado a mano" y      ║
-- ║     "asignada a mano". Solo las pone una escritura directa de la app ║
-- ║     (la UI de hoy); las funciones nuevas las ponen ellas mismas y la ║
-- ║     generación automática nunca las pone.                            ║
-- ║   · una privada no tiene participantes ni asignados fijos.           ║
-- ║  Además completa el horario de todas las tareas existentes.          ║
-- ║                                                                     ║
-- ║  No cambia nada visible. Requiere la 266. Se puede correr de nuevo.  ║
-- ║  Última línea del archivo: "notify pgrst, 'reload schema';"          ║
-- ╚════════════════════════════════════════════════════════════════════╝

set local lock_timeout = '5s';

do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'fn_tarea_rango') then
    raise exception '267: falta la 266.';
  end if;
end $$;

-- No es SECURITY DEFINER a propósito: current_user dice quién escribe.
-- 'authenticated' = escritura directa desde la app; el dueño de la base =
-- una función (RPC, generación) o el SQL Editor.
create or replace function public.fn_trg_tareas_turno_antes()
returns trigger language plpgsql set search_path = public as $$
declare
  v_privada boolean;
  v_area public.tarea_area;
  v_aviso integer;
  v_origen public.tarea_origen;
  v_hora_ini time;
  v_inicio timestamptz;
  v_fin timestamptz;
begin
  if tg_op = 'INSERT' then
    if new.plantilla_id is not null then
      select r.privada, r.area, r.avisar_atraso_min into v_privada, v_area, v_aviso
        from public.tareas_recurrentes r where r.id = new.plantilla_id;
      new.origen := coalesce(new.origen, 'rutina');
      new.privada := coalesce(v_privada, new.privada, false);
      new.empleado_rutina_id := coalesce(new.empleado_rutina_id, new.empleado_id);
    elsif new.trasladada_de is not null then
      select t.origen, t.privada, t.area, t.avisar_atraso_min
        into v_origen, v_privada, v_area, v_aviso
        from public.tareas_turno t where t.id = new.trasladada_de;
      new.origen := coalesce(new.origen, v_origen, 'puntual');
      new.privada := coalesce(v_privada, new.privada, false);
    else
      new.origen := coalesce(new.origen, 'puntual');
    end if;
    new.area := coalesce(new.area, v_area);
    new.avisar_atraso_min := coalesce(new.avisar_atraso_min, v_aviso);
  else
    if (new.privada is distinct from old.privada or new.origen is distinct from old.origen)
       and coalesce(current_setting('hex.tareas_backfill', true), '') <> 'on' then
      raise exception 'Una tarea no cambia de privada a pública ni de origen.';
    end if;
    if current_user = 'authenticated' then
      if (new.titulo, new.descripcion, new.hora, new.duracion_min, new.area, new.checklist,
          new.prioridad, new.requiere_evidencia, new.tipo_actividad)
         is distinct from
         (old.titulo, old.descripcion, old.hora, old.duracion_min, old.area, old.checklist,
          old.prioridad, old.requiere_evidencia, old.tipo_actividad) then
        new.contenido_tocado_at := coalesce(old.contenido_tocado_at, now());
      end if;
      if new.empleado_id is distinct from old.empleado_id or (new.fijada and not old.fijada) then
        new.asignacion_manual := true;
      end if;
    end if;
  end if;

  -- Horario absoluto (al crear, o si cambió algo que lo define).
  if tg_op = 'INSERT'
     or (new.fecha, new.turno_id, new.hora, new.duracion_min, new.tipo_actividad)
        is distinct from (old.fecha, old.turno_id, old.hora, old.duracion_min, old.tipo_actividad) then
    new.todo_el_turno := new.hora is null;
    if new.hora is not null and new.turno_id is not null then
      select tp.hora_inicio into v_hora_ini from public.turnos_plantilla tp where tp.id = new.turno_id;
      new.minutos_desde_inicio :=
        (extract(epoch from (new.hora - v_hora_ini))::integer / 60 + 1440) % 1440;
    else
      new.minutos_desde_inicio := null;
    end if;
    select r.inicio_at, r.fin_at into v_inicio, v_fin
      from public.fn_tarea_rango(new.fecha, new.turno_id, new.hora, new.duracion_min) r;
    new.inicio_at := v_inicio;
    new.fin_at := v_fin;
    new.limite_at := case when new.tipo_actividad = 'puntual' then v_fin end;
  end if;
  return new;
end;
$$;
revoke execute on function public.fn_trg_tareas_turno_antes() from public, anon, authenticated;

drop trigger if exists trg_tareas_turno_antes on public.tareas_turno;
create trigger trg_tareas_turno_antes
  before insert or update on public.tareas_turno
  for each row execute function public.fn_trg_tareas_turno_antes();

-- Las privadas no tienen participantes ni asignados fijos (las hace un admin).
create or replace function public.fn_trg_tareas_sin_asignados_en_privada()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'tareas_turno_participantes' then
    if exists (select 1 from public.tareas_turno where id = new.tarea_id and privada) then
      raise exception 'Una tarea privada no tiene participantes.';
    end if;
  elsif exists (select 1 from public.tareas_recurrentes where id = new.plantilla_id and privada) then
    raise exception 'Una tarea privada de la rutina no tiene asignados.';
  end if;
  return new;
end;
$$;
revoke execute on function public.fn_trg_tareas_sin_asignados_en_privada() from public, anon, authenticated;

drop trigger if exists trg_participantes_privada on public.tareas_turno_participantes;
create trigger trg_participantes_privada
  before insert or update on public.tareas_turno_participantes
  for each row execute function public.fn_trg_tareas_sin_asignados_en_privada();
drop trigger if exists trg_asignados_privada on public.tareas_recurrentes_asignados;
create trigger trg_asignados_privada
  before insert or update on public.tareas_recurrentes_asignados
  for each row execute function public.fn_trg_tareas_sin_asignados_en_privada();

-- ─── Horario de las tareas que ya existen ───────────────────────────────
update public.tareas_turno t
   set inicio_at = r.inicio_at,
       fin_at = r.fin_at,
       limite_at = case when t.tipo_actividad = 'puntual' then r.fin_at end
  from public.tareas_turno x
  cross join lateral public.fn_tarea_rango(x.fecha, x.turno_id, x.hora, x.duracion_min) r
 where x.id = t.id
   and (t.inicio_at is distinct from r.inicio_at or t.fin_at is distinct from r.fin_at);

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_tareas_turno_antes') then
    raise exception '267: falta el trigger de la agenda.';
  end if;
  if exists (select 1 from public.tareas_turno where inicio_at is null or fin_at is null) then
    raise exception '267: quedaron tareas sin horario absoluto.';
  end if;
end $$;

notify pgrst, 'reload schema';
