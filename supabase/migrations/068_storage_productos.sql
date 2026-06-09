-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 068: bucket de Storage para imágenes de producto         ║
-- ║                                                                     ║
-- ║  Crea el bucket público `productos` y las policies para que solo     ║
-- ║  usuarios con permiso `configuracion` puedan subir/editar/borrar.    ║
-- ║  La lectura es pública (bucket público → URL pública directa).       ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.      ║
-- ╚════════════════════════════════════════════════════════════════════╝

insert into storage.buckets (id, name, public)
values ('productos', 'productos', true)
on conflict (id) do nothing;

drop policy if exists "productos_subir"  on storage.objects;
drop policy if exists "productos_editar" on storage.objects;
drop policy if exists "productos_borrar" on storage.objects;

create policy "productos_subir" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'productos' and public.fn_tiene_permiso('configuracion'));

create policy "productos_editar" on storage.objects
  for update to authenticated
  using (bucket_id = 'productos' and public.fn_tiene_permiso('configuracion'))
  with check (bucket_id = 'productos' and public.fn_tiene_permiso('configuracion'));

create policy "productos_borrar" on storage.objects
  for delete to authenticated
  using (bucket_id = 'productos' and public.fn_tiene_permiso('configuracion'));
