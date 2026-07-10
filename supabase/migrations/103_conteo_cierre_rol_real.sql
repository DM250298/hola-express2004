-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 103 · conteo_cierre a los roles de gestión REALES        ║
-- ║                                                                     ║
-- ║  La 098/102 agregaron conteo_cierre a 'encargado' y 'admin'. Pero   ║
-- ║  en esta base el rol de administración NO se llama 'admin' sino      ║
-- ║  'administración' (verificado 2026-07-10), así que el owner quedó    ║
-- ║  sin el permiso: no veía el módulo y fn_tiene_permiso tampoco lo     ║
-- ║  bypassea (el bypass es solo para el texto 'admin').                ║
-- ║  Acá se lo sumamos al rol de administración (match tolerante al      ║
-- ║  acento) y se reasegura en encargado. Idempotente.                  ║
-- ║  Los roles que solo CUENTAN (cajero/fiambrero/empleado) NO reciben  ║
-- ║  conteo_cierre: cuentan con 'inventario', no cierran ni ajustan.    ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

update public.roles
   set permisos = permisos || '{conteo_cierre}',
       updated_at = now()
 where (codigo ilike 'administra%' or codigo = 'encargado')
   and not (permisos @> '{conteo_cierre}');

notify pgrst, 'reload schema';
