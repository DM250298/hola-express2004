-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  300 · Tareas v2: avisos al celular cada minuto (Etapa 7, 2/2)      ║
-- ║                                                                     ║
-- ║  fn_tareas_push_pendiente() (misma firma que la 298): llama a la    ║
-- ║  app si hay avisos de atraso sin mandar O notificaciones en la      ║
-- ║  cola (urgentes / inicio). Sin secretos (prueba) no hace nada.      ║
-- ║  Proceso hex-tareas-push: cada minuto, primero genera la cola       ║
-- ║  (fn_notificaciones_generar) y después llama a la app.              ║
-- ║  El control de atrasos (hex-tareas-atrasos) sigue cada 5 minutos.   ║
-- ║                                                                     ║
-- ║  Requiere la 299 y la 298. Se puede correr de nuevo.                ║
-- ║  Última línea del archivo: "notify pgrst, 'reload schema';"         ║
-- ╚════════════════════════════════════════════════════════════════════╝

do $$
begin
  if to_regprocedure('public.fn_notificaciones_generar()') is null
     or to_regprocedure('public.fn_tareas_push_pendiente()') is null then
    raise exception '300: faltan la 298 o la 299.';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_cron')
     or not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise exception '300: faltan pg_cron o pg_net.';
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
         and not exists (select 1 from public.tareas_avisos_push p where p.aviso_id = a.id))
     and not exists (
       select 1 from public.notificaciones_push n
       where n.enviado_at is null and n.created_at > now() - interval '30 minutes') then
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
  perform cron.schedule('hex-tareas-push', '* * * * *',
    'select public.fn_notificaciones_generar(); select public.fn_tareas_push_pendiente();');
end $$;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'hex-tareas-push' and active and schedule = '* * * * *') then
    raise exception '300: el proceso no quedó programado cada minuto.';
  end if;
  if not exists (select 1 from pg_proc where proname = 'fn_tareas_push_pendiente' and prosrc like '%notificaciones_push%') then
    raise exception '300: fn_tareas_push_pendiente quedó en la versión vieja.';
  end if;
end $$;

notify pgrst, 'reload schema';
