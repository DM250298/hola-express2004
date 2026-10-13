-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 256 · Cajero y fiambrero: 'mi_panel' en vez de 'rrhh'    ║
-- ║                                                                     ║
-- ║  Decisión D8 del dueño (2026-10-13, menú por pilares). Con 'rrhh'   ║
-- ║  el mostrador veía todo Turnos y equipo (Hoy, Equipo, Cronograma,   ║
-- ║  Incidencias, Pases) y podía registrar incidencias de cualquiera.   ║
-- ║  Con 'mi_panel' ve solo lo propio: Mi panel, Mis tareas, Mi pase de ║
-- ║  turno y Mi cuenta (como el rol empleado).                          ║
-- ║                                                                     ║
-- ║  Misma lógica que el paso 4 de scripts/paso1_prueba_personal.sql    ║
-- ║  (en PRUEBA ya está así; esta la deja igual en las dos bases).      ║
-- ║  Respeta el orden del arreglo y no duplica. Idempotente: correrla   ║
-- ║  dos veces no cambia nada. No toca otros roles.                     ║
-- ║                                                                     ║
-- ║  OJO producción: Mi panel, Mis tareas y el pase necesitan la cuenta ║
-- ║  vinculada a un legajo (Turnos y equipo › ficha › Editar › Cuenta   ║
-- ║  de login). Ver la consulta 2 de abajo.                             ║
-- ║  El fallback de lib/permisos.ts se actualizó en paralelo.           ║
-- ╚════════════════════════════════════════════════════════════════════╝

update public.roles
set permisos = case
      when 'mi_panel' = any(permisos) then array_remove(permisos, 'rrhh')
      else array_append(array_remove(permisos, 'rrhh'), 'mi_panel')
    end,
    updated_at = now()
where codigo in ('cajero', 'fiambrero')
  and ('rrhh' = any(permisos) or not ('mi_panel' = any(permisos)));

notify pgrst, 'reload schema';

-- ─── Verificación ───────────────────────────────────────────────────
-- 1. Los dos roles: tiene_rrhh = false, tiene_mi_panel = true.
--   select codigo, 'rrhh' = any(permisos) as tiene_rrhh,
--          'mi_panel' = any(permisos) as tiene_mi_panel, permisos
--   from public.roles where codigo in ('cajero', 'fiambrero') order by codigo;
--
-- 2. Cuentas de cajero/fiambrero SIN legajo vinculado (verían "Tu usuario
--    no está vinculado a un legajo" en Mi panel). Vincularlas desde la ficha.
--   select u.email, u.nombre, u.rol
--   from public.usuarios u
--   where u.rol in ('cajero', 'fiambrero') and u.activo
--     and not exists (select 1 from public.empleados e
--                     where e.usuario_id = u.id and e.activo)
--   order by u.rol, u.nombre;
