-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  272 · Tareas v2: la agenda se arma con la sincronización nueva     ║
-- ║  (Etapa 1 · bloque D)                                                ║
-- ║                                                                     ║
-- ║   · fn_materializar_tareas_turno(fecha) v6: misma firma (la llaman   ║
-- ║     el cron de las 06:00, las pantallas y el cronograma). Ahora usa  ║
-- ║     fn_tareas_sincronizar. Ya no la puede llamar alguien sin sesión. ║
-- ║   · fn_marcar_tareas_vencidas() v3: misma firma. Vence lo pendiente  ║
-- ║     o en curso cuando terminó SU turno (la noche, a las 07:00 del    ║
-- ║     día siguiente). Los recordatorios ("todo el turno", continuas) y ║
-- ║     los bloques no vencen. Solo la ejecuta el cron.                  ║
-- ║                                                                     ║
-- ║  DESDE ACÁ CAMBIA EL ARMADO DE LA AGENDA. Respaldo de la versión     ║
-- ║  anterior: scripts/rollback_tareas_v2/definiciones_produccion_*.csv  ║
-- ║  Requiere la 271. Se puede correr de nuevo.                          ║
-- ║  Última línea del archivo: "notify pgrst, 'reload schema';"          ║
-- ╚════════════════════════════════════════════════════════════════════╝

do $$
begin
  if not exists (select 1 from pg_proc where proname = 'fn_tareas_sincronizar') then
    raise exception '272: falta la 271.';
  end if;
end $$;

create or replace function public.fn_materializar_tareas_turno(p_fecha date)
returns integer language plpgsql security definer set search_path = public as $$
declare v_hoy date := public.fn_tareas_hoy();
begin
  if not public.fn_sesion_es_sistema()
     and not (public.fn_tiene_permiso('tareas_gestion') or public.fn_tiene_permiso('tareas_admin')
              or public.fn_tiene_permiso('rrhh') or public.fn_tiene_permiso('mi_panel')) then
    raise exception 'Sin permiso.';
  end if;
  if p_fecha < v_hoy - 1 or p_fecha > v_hoy + 7 then
    raise exception 'Fecha fuera de rango.';
  end if;
  return public.fn_tareas_sincronizar(p_fecha);
end;
$$;

create or replace function public.fn_marcar_tareas_vencidas()
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  update public.tareas_turno t
     set estado = 'vencida'
   where t.estado in ('pendiente', 'en_curso')
     and t.tipo_actividad = 'puntual'
     and public.fn_tarea_fin_turno(t.fecha, t.turno_id) < now();
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke execute on function public.fn_materializar_tareas_turno(date) from public, anon;
grant execute on function public.fn_materializar_tareas_turno(date) to authenticated, service_role;
revoke execute on function public.fn_marcar_tareas_vencidas() from public, anon, authenticated;
grant execute on function public.fn_marcar_tareas_vencidas() to service_role;

do $$
begin
  if has_function_privilege('anon', 'public.fn_materializar_tareas_turno(date)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.fn_marcar_tareas_vencidas()', 'EXECUTE') then
    raise exception '272: quedaron funciones abiertas.';
  end if;
  if not exists (select 1 from pg_proc where proname = 'fn_materializar_tareas_turno'
                  and prosrc like '%fn_tareas_sincronizar%') then
    raise exception '272: fn_materializar_tareas_turno no quedó en la versión 6.';
  end if;
end $$;

notify pgrst, 'reload schema';
