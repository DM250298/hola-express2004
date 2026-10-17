-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  298 · Tareas v2: avisos de atraso al celular (Etapa 6 B, 2/2)      ║
-- ║                                                                     ║
-- ║  ANTES: activar pg_net (Database → Extensions). En producción,      ║
-- ║  además, cargar en el Vault los secretos hex_app_url y              ║
-- ║  hex_avisos_secret (ver los pasos que acompañan esta migración).    ║
-- ║                                                                     ║
-- ║  fn_tareas_push_pendiente(): solo el sistema. Si hay avisos de      ║
-- ║  atraso de los últimos 30 min sin mandar al celular, llama a la     ║
-- ║  app (/api/cron/avisos-tareas) con la clave del Vault; la app       ║
-- ║  manda las notificaciones y anota cada envío. Sin secretos (base    ║
-- ║  de prueba) no hace nada.                                           ║
-- ║  Proceso hex-tareas-push: minutos 1, 6, 11… (1 min después del      ║
-- ║  control de atrasos).                                               ║
-- ║                                                                     ║
-- ║  Requiere la 297 y la 296. Se puede correr de nuevo.                ║
-- ║  Última línea del archivo: "notify pgrst, 'reload schema';"         ║
-- ╚════════════════════════════════════════════════════════════════════╝

do $$
begin
  if to_regclass('public.tareas_avisos_push') is null then
    raise exception '298: falta la 297.';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception '298: falta pg_cron (la 296).';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise exception '298: falta activar pg_net (Database → Extensions → pg_net) y volver a correr esta migración.';
  end if;
  if to_regclass('vault.decrypted_secrets') is null then
    raise exception '298: falta el Vault de Supabase (supabase_vault).';
  end if;
end $$;

create or replace function public.fn_tareas_push_pendiente()
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_url text;
  v_clave text;
begin
  if auth.uid() is not null then
    raise exception 'Los avisos al celular los manda solo el sistema.';
  end if;
  select s.decrypted_secret into v_url from vault.decrypted_secrets s where s.name = 'hex_app_url';
  select s.decrypted_secret into v_clave from vault.decrypted_secrets s where s.name = 'hex_avisos_secret';
  if nullif(btrim(v_url), '') is null or nullif(btrim(v_clave), '') is null then
    return false;
  end if;
  if not exists (
    select 1 from public.tareas_avisos a
    where a.resuelto_at is null and a.created_at > now() - interval '30 minutes'
      and not exists (select 1 from public.tareas_avisos_push p where p.aviso_id = a.id)) then
    return false;
  end if;
  perform net.http_post(
    url := rtrim(btrim(v_url), '/') || '/api/cron/avisos-tareas',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || btrim(v_clave)),
    timeout_milliseconds := 15000);
  return true;
end;
$$;
revoke execute on function public.fn_tareas_push_pendiente() from public, anon, authenticated, service_role;

do $$
begin
  perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'hex-tareas-push';
  perform cron.schedule('hex-tareas-push', '1-59/5 * * * *', 'select public.fn_tareas_push_pendiente()');
end $$;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'hex-tareas-push' and active) then
    raise exception '298: el proceso no quedó programado.';
  end if;
  if has_function_privilege('authenticated', 'public.fn_tareas_push_pendiente()', 'EXECUTE') then
    raise exception '298: fn_tareas_push_pendiente quedó ejecutable desde la app.';
  end if;
end $$;

-- Para ver que corre: select * from cron.job_run_details d join cron.job j using (jobid)
--   where j.jobname = 'hex-tareas-push' order by d.start_time desc limit 5;
-- Y las respuestas de la app: select id, status_code, content from net._http_response order by id desc limit 5;

notify pgrst, 'reload schema';
