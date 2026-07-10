-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 102 · conteo_cierre también al rol admin                 ║
-- ║                                                                     ║
-- ║  La 098 agregó el permiso 'conteo_cierre' solo al rol 'encargado'.  ║
-- ║  El Sidebar y el middleware arman el menú con la lista guardada en  ║
-- ║  roles.permisos (NO con el bypass admin de fn_tiene_permiso), así    ║
-- ║  que el admin no veía el ítem "Conteo físico" aunque a nivel base   ║
-- ║  tiene acceso total. Acá se lo sumamos al rol admin (y de paso se    ║
-- ║  reasegura en encargado). Idempotente.                              ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

update public.roles
   set permisos = permisos || '{conteo_cierre}',
       updated_at = now()
 where codigo in ('admin', 'encargado')
   and not (permisos @> '{conteo_cierre}');

notify pgrst, 'reload schema';
