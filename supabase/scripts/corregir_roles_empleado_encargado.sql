-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Script (NO migración) · Corregir los roles empleado y encargado    ║
-- ║                                                                     ║
-- ║  En la base de PRUEBA (2026-10-13) aparecieron así, sin que ninguna ║
-- ║  migración lo explique (probablemente editados a mano desde la      ║
-- ║  matriz de roles):                                                  ║
-- ║   · empleado con 'configuracion' (y por eso la 257 le sumó          ║
-- ║     'proveedores') y SIN 'mi_panel'. Le abría Usuarios y roles y    ║
-- ║     no le dejaba entrar a su propio panel.                          ║
-- ║   · encargado SIN 'rrhh': solo veía la pestaña Tareas de Turnos y   ║
-- ║     equipo (perdía Hoy, Equipo, Cronograma, Incidencias y Pases).   ║
-- ║                                                                     ║
-- ║  Queda como lo definen las migraciones (085 y PERMISOS_POR_ROL_      ║
-- ║  LEGACY en lib/permisos.ts):                                        ║
-- ║   · empleado = solo 'mi_panel'.                                     ║
-- ║   · encargado recupera 'rrhh'. No se le saca nada (conserva          ║
-- ║     'mi_panel' si lo tiene: es solo su propio panel).               ║
-- ║                                                                     ║
-- ║  ANTES DE CORRERLO, aparte (el SQL Editor solo muestra el último    ║
-- ║  resultado), mirá quién usa cada rol:                               ║
-- ║    select rol, email, nombre from public.usuarios                   ║
-- ║    where activo and rol in ('empleado', 'encargado')                ║
-- ║    order by rol, email;                                             ║
-- ║  Si alguien que necesita Configuración (por ejemplo el              ║
-- ║  administrativo) tiene rol 'empleado', pasalo a 'admin' primero:    ║
-- ║  después de esto el rol empleado ya no entra a Configuración.       ║
-- ║                                                                     ║
-- ║  Idempotente. Pensado para PRUEBA; en producción correrlo solo si   ║
-- ║  la consulta de roles muestra lo mismo.                             ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- 1. empleado: solo su panel
update public.roles
set permisos = array['mi_panel']::text[],
    updated_at = now()
where codigo = 'empleado'
  and permisos is distinct from array['mi_panel']::text[];

-- 2. encargado: vuelve a tener 'rrhh'
update public.roles
set permisos = array_append(permisos, 'rrhh'),
    updated_at = now()
where codigo = 'encargado'
  and not ('rrhh' = any(permisos));

-- ─── Verificación ───────────────────────────────────────────────────
-- empleado: mi_panel true, todo lo demás false.
-- encargado: rrhh true, configuracion false.
select codigo,
       'mi_panel' = any(permisos)      as mi_panel,
       'rrhh' = any(permisos)          as rrhh,
       'tareas_gestion' = any(permisos) as tareas_gestion,
       'configuracion' = any(permisos) as configuracion,
       'proveedores' = any(permisos)   as proveedores,
       permisos
from public.roles
where codigo in ('empleado', 'encargado')
order by codigo;
