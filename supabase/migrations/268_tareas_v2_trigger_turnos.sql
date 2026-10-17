-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  268 · Tareas v2: si cambia el horario de un turno, las tareas      ║
-- ║  se corren solas (Etapa 1 · bloque C)                                ║
-- ║                                                                     ║
-- ║  Al cambiar hora de inicio, hora de fin o si un turno está activo:   ║
-- ║   · las tareas abiertas (pendientes o en curso) de ese turno, desde  ║
-- ║     ayer en adelante, mantienen sus "minutos desde el inicio" y se   ║
-- ║     corren con el turno (si el turno empieza 07:00 → 08:00, la tarea ║
-- ║     de las 07:30 pasa a las 08:30). Las que no tienen hora toman el  ║
-- ║     nuevo inicio y fin del turno.                                    ║
-- ║   · no se marcan como "tocadas a mano";                              ║
-- ║   · queda en el registro de cambios (turno_editado, antes → después).║
-- ║  Lo hecho, lo que no se pudo y lo cancelado no se mueve.             ║
-- ║                                                                     ║
-- ║  No cambia nada visible hasta que alguien cambie un horario.         ║
-- ║  Requiere la 266 y la 267. Se puede correr de nuevo.                 ║
-- ║  Última línea del archivo: "notify pgrst, 'reload schema';"          ║
-- ╚════════════════════════════════════════════════════════════════════╝

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_tareas_turno_antes') then
    raise exception '268: falta la 267.';
  end if;
end $$;

-- SECURITY DEFINER: las tareas se actualizan como "sistema", así el trigger
-- de la agenda no las marca como editadas a mano.
create or replace function public.fn_trg_turnos_plantilla_tareas()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  update public.tareas_turno t
     set hora = case when t.minutos_desde_inicio is not null
                     then (new.hora_inicio + make_interval(mins => t.minutos_desde_inicio))::time
                end,
         inicio_at = r.inicio_at,
         fin_at = r.fin_at,
         limite_at = case when t.tipo_actividad = 'puntual' then r.fin_at end
    from public.tareas_turno x
    cross join lateral public.fn_tarea_rango(
      x.fecha, x.turno_id,
      case when x.minutos_desde_inicio is not null
           then (new.hora_inicio + make_interval(mins => x.minutos_desde_inicio))::time end,
      x.duracion_min) r
   where x.id = t.id
     and t.turno_id = new.id
     and t.fecha >= public.fn_tareas_hoy() - 1
     and t.estado in ('pendiente', 'en_curso');
  get diagnostics v_n = row_count;

  perform public.fn_tarea_evento(
    'turno_editado', null, null,
    jsonb_build_object('hora_inicio', old.hora_inicio, 'hora_fin', old.hora_fin, 'activo', old.activo),
    jsonb_build_object('hora_inicio', new.hora_inicio, 'hora_fin', new.hora_fin, 'activo', new.activo,
                       'tareas_movidas', v_n),
    null, 'trigger:turnos_plantilla', null, new.id);
  return new;
end;
$$;
revoke execute on function public.fn_trg_turnos_plantilla_tareas() from public, anon, authenticated;

drop trigger if exists trg_turnos_plantilla_tareas on public.turnos_plantilla;
create trigger trg_turnos_plantilla_tareas
  after update of hora_inicio, hora_fin, activo on public.turnos_plantilla
  for each row
  when ((old.hora_inicio, old.hora_fin, old.activo) is distinct from (new.hora_inicio, new.hora_fin, new.activo))
  execute function public.fn_trg_turnos_plantilla_tareas();

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_turnos_plantilla_tareas') then
    raise exception '268: falta el trigger de turnos.';
  end if;
end $$;

notify pgrst, 'reload schema';
