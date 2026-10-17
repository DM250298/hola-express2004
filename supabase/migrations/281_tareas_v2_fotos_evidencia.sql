-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  281 · Tareas v2: las fotos de evidencia no se editan ni se borran  ║
-- ║  (Etapa 1 · bloque G)                                                ║
-- ║                                                                     ║
-- ║   · Bucket tareas-evidencia: se quitan los permisos de reemplazar y  ║
-- ║     borrar fotos (antes los tenían la encargada, rrhh y quien la     ║
-- ║     subió). Nadie las cambia desde la app.                           ║
-- ║   · Subir sigue igual: encargada, administradores y empleados con    ║
-- ║     legajo (la app sube con upsert: false, no necesita reemplazar).  ║
-- ║                                                                     ║
-- ║  En la base de prueba el bucket puede no existir: igual se corre.    ║
-- ║  Requiere la 280. Se puede correr de nuevo.                          ║
-- ║  Última línea del archivo: "notify pgrst, 'reload schema';"          ║
-- ╚════════════════════════════════════════════════════════════════════╝

do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice '281: no hay storage en esta base; no hay nada que cambiar.';
    return;
  end if;
  execute 'drop policy if exists "tareas_evid_editar" on storage.objects';
  execute 'drop policy if exists "tareas_evid_borrar" on storage.objects';
  execute 'drop policy if exists "tareas_evid_subir" on storage.objects';
  execute $p$
    create policy "tareas_evid_subir" on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'tareas-evidencia'
        and (
          (select public.fn_tiene_permiso('tareas_gestion'))
          or (select public.fn_tiene_permiso('tareas_admin'))
          or exists (select 1 from public.empleados e where e.usuario_id = (select auth.uid()))
        )
      )
  $p$;
end $$;

do $$
begin
  if to_regclass('storage.objects') is not null and exists (
       select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
          and policyname in ('tareas_evid_editar', 'tareas_evid_borrar')) then
    raise exception '281: quedaron permisos para editar o borrar fotos.';
  end if;
end $$;

notify pgrst, 'reload schema';
