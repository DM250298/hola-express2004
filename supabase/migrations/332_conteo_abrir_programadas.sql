-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 332 · Conteo físico: sesiones programadas (3/4)         ║
-- ║                                                                    ║
-- ║  Apertura automática. fn_conteo_abrir_programadas() corre en la    ║
-- ║  base con pg_cron cada minuto (hex-conteo-programado) y, por cada  ║
-- ║  programación vencida, llama la fn_abrir_sesion_conteo de siempre  ║
-- ║  A NOMBRE DE QUIEN PROGRAMÓ (claims de la sesión seteados en la    ║
-- ║  transacción): auth.uid(), el permiso (que se vuelve a evaluar     ║
-- ║  ahora), abierta_por y la auditoría quedan como si esa persona la  ║
-- ║  abriera a mano. No se toca la cadena 223/224/225/329.             ║
-- ║                                                                    ║
-- ║  Si a la hora hay otra sesión viva, espera hasta 60 minutos        ║
-- ║  reintentando cada minuto (decisión del dueño, 2026-11-17); si no  ║
-- ║  se libera, queda "fallida" con el motivo y el gestor la abre a    ║
-- ║  mano o la reprograma (331). Cualquier otro error también la deja  ║
-- ║  fallida con el mensaje literal.                                   ║
-- ║                                                                    ║
-- ║  ANTES: pg_cron activo en el proyecto (ya lo está desde la 296).   ║
-- ║  REQUIERE: migs 330 y 331. Se puede correr de nuevo (reemplaza el  ║
-- ║  proceso). Apagarlo: select cron.unschedule('hex-conteo-programado') ║
-- ║  Última línea del archivo: "notify pgrst, 'reload schema';"        ║
-- ╚════════════════════════════════════════════════════════════════════╝

do $$
begin
  if to_regprocedure('public.fn_conteo_abrir_programada(integer)') is null then
    raise exception '332: faltan la 330 y la 331.';
  end if;
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise exception '332: falta activar pg_cron (Database → Extensions → pg_cron) y volver a correr esta migración.';
  end if;
end $$;

create or replace function public.fn_conteo_abrir_programadas()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  c_espera constant interval := interval '60 minutes';
  c_tz constant text := 'America/Argentina/La_Rioja';
  r public.conteo_programaciones;
  v_sesion public.conteo_sesiones;
  v_msg text;
  v_abiertas integer := 0;
  v_esperan integer := 0;
  v_fallidas integer := 0;
begin
  -- Primero que nada: después de impersonar, esta guarda daría false.
  if not public.fn_sesion_es_sistema() then
    raise exception 'Las sesiones programadas las abre solo el sistema.';
  end if;

  for r in
    select * from public.conteo_programaciones
     where estado = 'programada' and programada_para <= now()
     order by programada_para, id
       for update skip locked
  loop
    v_msg := null;
    -- Solo puede haber una sesión viva: se mira acá, sin gastar un snapshot.
    if not exists (select 1 from public.conteo_sesiones where estado <> 'cerrada') then
      begin
        -- Claims y llamada en statements separados: auth.uid() es stable.
        perform set_config('request.jwt.claims',
          jsonb_build_object('sub', r.programada_por, 'role', 'authenticated')::text, true);
        v_sesion := public.fn_abrir_sesion_conteo(r.nombre, r.umbral_pesos, r.zonas, r.notas);
        perform set_config('request.jwt.claims', '', true);
        update public.conteo_programaciones
           set estado = 'abierta', sesion_id = v_sesion.id, abierta_at = now(), abierta_por = null,
               intentos = intentos + 1, ultimo_intento_at = now(), ultimo_error = null
         where id = r.id;
        v_abiertas := v_abiertas + 1;
        begin
          perform public.fn_auditar(r.programada_por, 'abrir_conteo_programado', 'conteo_programacion', r.id,
            jsonb_build_object('sesion_id', v_sesion.id, 'programada_para', r.programada_para));
        exception when others then null; end;
        continue;
      exception when others then
        -- El aborto de la subtransacción ya revirtió los claims; explícito igual.
        perform set_config('request.jwt.claims', '', true);
        v_msg := sqlerrm;
      end;
    end if;

    -- Acá: había una sesión viva, o la apertura falló (si fue por una sesión
    -- que se abrió a mano en este mismo instante, también es "esperar").
    if v_msg is null or v_msg like 'Ya hay una sesión de conteo en curso%' then
      if now() <= r.programada_para + c_espera then
        update public.conteo_programaciones
           set intentos = intentos + 1, ultimo_intento_at = now(),
               ultimo_error = 'Hay otra sesión de conteo en curso: se reintenta cada minuto hasta las '
                 || to_char((r.programada_para + c_espera) at time zone c_tz, 'HH24:MI') || '.'
         where id = r.id;
        v_esperan := v_esperan + 1;
        continue;
      end if;
      v_msg := 'A la hora programada había otra sesión de conteo en curso y siguió así 60 minutos.';
    end if;

    update public.conteo_programaciones
       set estado = 'fallida', intentos = intentos + 1, ultimo_intento_at = now(), ultimo_error = v_msg
     where id = r.id;
    v_fallidas := v_fallidas + 1;
    begin
      perform public.fn_auditar(r.programada_por, 'fallo_conteo_programada', 'conteo_programacion', r.id,
        jsonb_build_object('motivo', v_msg, 'programada_para', r.programada_para));
    exception when others then null; end;
  end loop;

  return jsonb_build_object('abiertas', v_abiertas, 'esperan', v_esperan, 'fallidas', v_fallidas);
end;
$$;

revoke execute on function public.fn_conteo_abrir_programadas()
  from public, anon, authenticated, service_role;

-- ─── pg_cron: cada minuto, como hex-tareas-push (300) ─────────────────
do $$
begin
  perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'hex-conteo-programado';
  perform cron.schedule('hex-conteo-programado', '* * * * *', 'select public.fn_conteo_abrir_programadas()');
end $$;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'hex-conteo-programado' and active and schedule = '* * * * *') then
    raise exception '332: el proceso no quedó programado cada minuto.';
  end if;
  if has_function_privilege('authenticated', 'public.fn_conteo_abrir_programadas()', 'EXECUTE') then
    raise exception '332: fn_conteo_abrir_programadas quedó ejecutable desde la app.';
  end if;
end $$;

-- Para ver que corre (después de un par de minutos):
-- select d.status, d.start_time, d.return_message
--   from cron.job_run_details d join cron.job j on j.jobid = d.jobid
--  where j.jobname = 'hex-conteo-programado' order by d.start_time desc limit 5;

notify pgrst, 'reload schema';
