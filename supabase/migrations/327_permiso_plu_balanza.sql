-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 327 · Permiso 'plu_balanza' (cargar el PLU en mostrador)  ║
-- ║                                                                     ║
-- ║  Decisión del dueño (2026-11-04): la encargada, el cajero y el      ║
-- ║  fiambrero cargan y corrigen productos.plu_balanza (mig 326) sin    ║
-- ║  pasar por Configuración › Productos: desde el POS (etiqueta cuyo   ║
-- ║  PLU no tiene producto → elegir el producto y guardarlo, y la       ║
-- ║  etiqueta entra al carrito) y desde el celular (/movil/plu).        ║
-- ║                                                                     ║
-- ║  · Solo datos: suma 'plu_balanza' a encargado, cajero y fiambrero   ║
-- ║    y a todo rol que ya tiene 'configuracion' (así la matriz de      ║
-- ║    roles dice la verdad; la UI acepta cualquiera de los dos).       ║
-- ║  · Sin cambios de RLS: productos sigue con la policy base           ║
-- ║    "authenticated todo" (schema.sql), así que cualquier sesión ya   ║
-- ║    puede escribir la columna; el permiso gatea la UI, igual que el  ║
-- ║    código de barras desde la recepción móvil. El encabezado de la   ║
-- ║    326 decía que escribía solo 'configuracion': era la ficha, no    ║
-- ║    la base.                                                         ║
-- ║  · Idempotente. lib/permisos.ts (PERMISOS y fallback legacy) se     ║
-- ║    actualizó en el mismo commit. Sin ella el front solo deja de     ║
-- ║    mostrar la opción a esos roles; no rompe nada.                   ║
-- ╚════════════════════════════════════════════════════════════════════╝

update public.roles
set permisos = array_append(permisos, 'plu_balanza'),
    updated_at = now()
where (codigo in ('encargado', 'cajero', 'fiambrero')
       or 'configuracion' = any(permisos))
  and not ('plu_balanza' = any(permisos));

notify pgrst, 'reload schema';

-- ── VERIFICACIÓN: encargado, cajero, fiambrero y los roles con ────────
-- ── configuracion tienen que dar plu_balanza = true ───────────────────
-- select codigo,
--        'plu_balanza' = any(permisos)   as plu_balanza,
--        'configuracion' = any(permisos) as configuracion
--   from public.roles
--  order by codigo;
