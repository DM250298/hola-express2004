-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  273 · Tareas v2: quién puede operar una tarea y "Completar"        ║
-- ║  (Etapa 1 · bloque E)                                                ║
-- ║                                                                     ║
-- ║   · fn_tarea_puede_operar(tarea) v2, misma firma:                   ║
-- ║      - privadas: solo administradores (tareas_admin);                ║
-- ║      - encargada (tareas_gestion) y administradores: todas;          ║
-- ║      - empleado: lo suyo (o donde participa), hasta 2 h después del  ║
-- ║        fin de su turno; después la marca la encargada.               ║
-- ║   · fn_tarea_puede_gestionar(tarea): encargada o admin (privadas     ║
-- ║     solo admin). Interna, para reabrir, rechazar, editar, etc.       ║
-- ║   · fn_completar_tarea(tarea, foto, nota): suma la nota para el      ║
-- ║     próximo turno, guarda quién (también un admin sin legajo) y      ║
-- ║     escribe el evento "completada" (con "en nombre de" si marcó por  ║
-- ║     otro). Los recordatorios ("todo el turno") no se completan.      ║
-- ║     La app de hoy la sigue llamando igual (la nota es opcional).     ║
-- ║                                                                     ║
-- ║  Requiere la 272. Se puede correr de nuevo.                          ║
-- ║  Última línea del archivo: "notify pgrst, 'reload schema';"          ║
-- ╚════════════════════════════════════════════════════════════════════╝

do $$
begin
  if not exists (select 1 from pg_proc where proname = 'fn_tareas_sincronizar') then
    raise exception '273: falta la 271/272.';
  end if;
end $$;

create or replace function public.fn_tarea_puede_operar(p_tarea_id uuid)
returns integer language plpgsql stable security definer set search_path = public as $$
declare v_t record; v_emp integer;
begin
  select id, empleado_id, privada, fecha, turno_id into v_t from public.tareas_turno where id = p_tarea_id;
  if v_t.id is null then raise exception 'Tarea inexistente.'; end if;
  select id into v_emp from public.empleados where usuario_id = auth.uid();
  if v_t.privada then
    if public.fn_tiene_permiso('tareas_admin') then return v_emp; end if;
    raise exception 'Sin permiso para operar esta tarea.';
  end if;
  if public.fn_tiene_permiso('tareas_gestion') or public.fn_tiene_permiso('tareas_admin') then
    return v_emp;
  end if;
  if v_t.empleado_id is not null then
    if v_emp is null or v_emp <> v_t.empleado_id then
      raise exception 'Sin permiso para operar esta tarea.';
    end if;
  elsif v_emp is null or not exists (
      select 1 from public.tareas_turno_participantes p
      where p.tarea_id = p_tarea_id and p.empleado_id = v_emp) then
    raise exception 'Sin permiso para operar esta tarea.';
  end if;
  if now() > public.fn_tarea_fin_turno(v_t.fecha, v_t.turno_id) + interval '2 hours' then
    raise exception 'Pasaron más de 2 horas desde el fin del turno: pedile a la encargada que la marque.';
  end if;
  return v_emp;
end $$;

create or replace function public.fn_tarea_puede_gestionar(p_tarea_id uuid)
returns void language plpgsql stable security definer set search_path = public as $$
declare v_privada boolean;
begin
  select privada into v_privada from public.tareas_turno where id = p_tarea_id;
  if v_privada is null then raise exception 'Tarea inexistente.'; end if;
  if v_privada and not public.fn_tiene_permiso('tareas_admin') then
    raise exception 'Sin permiso para esta tarea.';
  end if;
  if not (public.fn_tiene_permiso('tareas_gestion') or public.fn_tiene_permiso('tareas_admin')) then
    raise exception 'Solo la encargada o un administrador pueden hacer esto.';
  end if;
end $$;

drop function if exists public.fn_completar_tarea(uuid, text);
drop function if exists public.fn_completar_tarea(uuid, text, text);

create function public.fn_completar_tarea(
  p_tarea_id uuid, p_evidencia_url text default null, p_nota text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_t record; v_emp integer; v_nota text := nullif(btrim(p_nota), '');
begin
  v_emp := public.fn_tarea_puede_operar(p_tarea_id);
  select * into v_t from public.tareas_turno where id = p_tarea_id for update;
  if v_t.estado not in ('pendiente', 'en_curso', 'vencida') then
    raise exception 'La tarea no se puede completar en su estado actual (%).', v_t.estado;
  end if;
  if v_t.tipo_actividad = 'continua' then
    raise exception 'Es un recordatorio de todo el turno: no se marca.';
  end if;
  if v_t.requiere_evidencia then
    if p_evidencia_url is null or btrim(p_evidencia_url) = '' then
      raise exception 'Esta tarea requiere una foto de evidencia.';
    end if;
    if position('/storage/v1/object/public/tareas-evidencia/' in p_evidencia_url) = 0 then
      raise exception 'La evidencia debe ser una foto subida al sistema.';
    end if;
  end if;
  if length(v_nota) > 1000 then
    raise exception 'La nota no puede superar los 1000 caracteres.';
  end if;

  update public.tareas_turno set
    estado = 'completada',
    completada_por = v_emp,
    completada_por_usuario = auth.uid(),
    completada_at = now(),
    evidencia_url = coalesce(p_evidencia_url, evidencia_url),
    nota_proximo_turno = coalesce(v_nota, nota_proximo_turno)
  where id = p_tarea_id;

  perform public.fn_tarea_evento('completada', p_tarea_id, null,
    jsonb_build_object('estado', v_t.estado),
    jsonb_strip_nulls(jsonb_build_object('estado', 'completada', 'evidencia_url', p_evidencia_url,
                                         'nota_proximo_turno', v_nota)),
    null, 'app');
end $$;

revoke execute on function public.fn_tarea_puede_operar(uuid) from public, anon, authenticated;
revoke execute on function public.fn_tarea_puede_gestionar(uuid) from public, anon, authenticated;
revoke execute on function public.fn_completar_tarea(uuid, text, text) from public, anon;
grant execute on function public.fn_completar_tarea(uuid, text, text) to authenticated;

do $$
begin
  if (select count(*) from pg_proc where proname = 'fn_completar_tarea') <> 1
     or to_regprocedure('public.fn_completar_tarea(uuid,text,text)') is null then
    raise exception '273: fn_completar_tarea no quedó con la firma nueva.';
  end if;
  if has_function_privilege('authenticated', 'public.fn_tarea_puede_operar(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.fn_completar_tarea(uuid,text,text)', 'EXECUTE') then
    raise exception '273: quedaron permisos de más.';
  end if;
end $$;

notify pgrst, 'reload schema';
