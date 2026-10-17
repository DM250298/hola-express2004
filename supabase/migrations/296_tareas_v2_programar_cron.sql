-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  296 · Tareas v2: procesos programados (Etapa 5, 4/4)               ║
-- ║                                                                     ║
-- ║  ANTES: activar pg_cron en el proyecto                              ║
-- ║  (Database → Extensions → pg_cron). Si no está, se frena acá.       ║
-- ║                                                                     ║
-- ║  · fn_tareas_guardar_resumen(): guarda la foto de la semana pasada  ║
-- ║    (lunes a domingo). Solo el sistema.                              ║
-- ║  · hex-tareas-atrasos: cada 5 minutos, fn_tareas_avisar_atrasos().  ║
-- ║  · hex-tareas-resumen: lunes 11:00 UTC = 08:00 en La Rioja.         ║
-- ║                                                                     ║
-- ║  Requiere la 295. Se puede correr de nuevo (reemplaza los procesos).║
-- ║  Para apagarlos: select cron.unschedule('hex-tareas-atrasos');      ║
-- ║  Última línea del archivo: "notify pgrst, 'reload schema';"         ║
-- ╚════════════════════════════════════════════════════════════════════╝

do $$
begin
  if to_regprocedure('public.fn_tareas_resumen_semana(date)') is null then
    raise exception '296: falta la 295.';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception '296: falta activar pg_cron (Database → Extensions → pg_cron) y volver a correr esta migración.';
  end if;
end $$;

create or replace function public.fn_tareas_guardar_resumen()
returns date language plpgsql security definer set search_path = public as $$
declare
  v_lunes date := public.fn_tareas_hoy() - (extract(isodow from public.fn_tareas_hoy())::integer - 1) - 7;
begin
  if auth.uid() is not null then
    raise exception 'El resumen semanal lo guarda solo el sistema.';
  end if;
  insert into public.tareas_resumenes (semana_desde, datos)
  values (v_lunes, public.fn_tareas_resumen_semana(v_lunes))
  on conflict (semana_desde) do nothing;
  return v_lunes;
end;
$$;
revoke execute on function public.fn_tareas_guardar_resumen() from public, anon, authenticated, service_role;

do $$
begin
  perform cron.unschedule(j.jobid) from cron.job j where j.jobname in ('hex-tareas-atrasos', 'hex-tareas-resumen');
  perform cron.schedule('hex-tareas-atrasos', '*/5 * * * *', 'select public.fn_tareas_avisar_atrasos()');
  perform cron.schedule('hex-tareas-resumen', '0 11 * * 1', 'select public.fn_tareas_guardar_resumen()');
end $$;

do $$
begin
  if (select count(*) from cron.job where jobname in ('hex-tareas-atrasos', 'hex-tareas-resumen') and active) <> 2 then
    raise exception '296: los procesos no quedaron programados.';
  end if;
  if has_function_privilege('authenticated', 'public.fn_tareas_guardar_resumen()', 'EXECUTE') then
    raise exception '296: fn_tareas_guardar_resumen quedó ejecutable desde la app.';
  end if;
end $$;

-- Para ver que corren (después de 5 minutos):
-- select j.jobname, d.status, d.start_time, d.return_message
--   from cron.job_run_details d join cron.job j on j.jobid = d.jobid
--  where j.jobname like 'hex-tareas-%' order by d.start_time desc limit 10;

notify pgrst, 'reload schema';
