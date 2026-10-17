-- 290 · Tareas v2: reparar la 269 (1 de 3) — rutina vigente por fecha
-- Repara la 269, que en las dos bases quedó sin aplicar entera (el editor
-- recortó el pegado). Es la misma definición, partida en 3 archivos cortos
-- (290, 291, 292). Se puede correr de nuevo.
-- fn_plantillas_tareas_dia(fecha): si una tarea de la rutina cambió "desde mañana",
-- hoy usa la versión anterior. Deja de poder llamarse desde la app.

create or replace function public.fn_plantillas_tareas_dia(p_fecha date)
returns setof public.tareas_recurrentes
language sql stable security definer set search_path = public as $$
  select r.*
  from (
    select (case when r0.cambios_desde is not null and p_fecha < r0.cambios_desde
                      and r0.version_anterior is not null
                 then jsonb_populate_record(r0, r0.version_anterior)
                 else r0 end).*
    from public.tareas_recurrentes r0
  ) r
  where r.activa
    and (r.vigencia_desde is null or p_fecha >= r.vigencia_desde)
    and (r.vigencia_hasta is null or p_fecha <= r.vigencia_hasta)
    and (
      (r.tipo_recurrencia = 'dias_semana'
         and extract(dow from p_fecha)::integer = any(r.dias_semana))
      or (r.tipo_recurrencia = 'dia_mes' and r.dia_mes is not null and (
            extract(day from p_fecha)::integer = r.dia_mes
            or (p_fecha = (date_trunc('month', p_fecha) + interval '1 month - 1 day')::date
                and r.dia_mes > extract(day from p_fecha)::integer)))
      or (r.tipo_recurrencia = 'cada_n_dias' and r.cada_n_dias is not null and (
            p_fecha >= coalesce(r.fecha_base, (timezone('America/Argentina/La_Rioja', r.created_at))::date)
            and (p_fecha - coalesce(r.fecha_base, (timezone('America/Argentina/La_Rioja', r.created_at))::date))
                % r.cada_n_dias = 0))
    );
$$;


revoke execute on function public.fn_plantillas_tareas_dia(date) from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_proc where proname = 'fn_plantillas_tareas_dia' and prosrc like '%version_anterior%')
     or has_function_privilege('authenticated', 'public.fn_plantillas_tareas_dia(date)', 'EXECUTE') then
    raise exception '290: fn_plantillas_tareas_dia no quedó bien.';
  end if;
end $$;

notify pgrst, 'reload schema';
