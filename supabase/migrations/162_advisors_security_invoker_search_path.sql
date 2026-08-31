-- RENUMERADA: se escribió como 152 el 2026-08-17 pero nunca se aplicó.
-- Diagnóstico del 2026-08-31 lo confirmó contra el catálogo de Postgres, así que
-- pasa al próximo número libre. Ver supabase/MIGRACIONES.md.
-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 162: advisors de seguridad de Supabase                   ║
-- ║                                                                     ║
-- ║  1) "Security Definer View" (CRITICAL) — vista_cobertura_stock      ║
-- ║     La vista (060, recreada en 062) corre por default con los       ║
-- ║     permisos de su creador (postgres) y saltea RLS. Se pasa a       ║
-- ║     security_invoker = true: pasa a evaluar RLS y permisos del      ║
-- ║     usuario que consulta, igual que las otras 7 vistas del sistema. ║
-- ║                                                                     ║
-- ║     Impacto verificado: la vista lee productos, ventas e            ║
-- ║     items_venta, que conservan la policy base "authenticated todo"  ║
-- ║     using (true) de schema.sql (nunca fueron re-gateadas por las    ║
-- ║     migs de RLS 047/069/090). Todo usuario autenticado ve las       ║
-- ║     mismas filas que antes → Inventario (getCoberturaStock) no      ║
-- ║     cambia. `anon` deja de poder leerla (no tiene policies en esas  ║
-- ║     tablas), pero ningún flujo público la consulta.                 ║
-- ║                                                                     ║
-- ║  2) "Function Search Path Mutable" (WARN) — fn_generar_legajo y     ║
-- ║     12 más. Sin search_path fijo, un rol que pueda crear objetos    ║
-- ║     en un schema anterior del path podría suplantar tablas/         ║
-- ║     funciones (riesgo real sobre todo en las SECURITY DEFINER,      ║
-- ║     como fn_etiqueta_precio_cambio). Se fija con ALTER FUNCTION     ║
-- ║     (no reissue del cuerpo → cero riesgo de pisar versiones).       ║
-- ║     Las 13 solo referencian objetos public.* calificados o          ║
-- ║     built-ins de pg_catalog, así que search_path = public no        ║
-- ║     cambia su comportamiento.                                       ║
-- ║                                                                     ║
-- ║     Nota: fn__rls_gate / fn__rls_gate_multi eran helpers            ║
-- ║     temporales ya dropeados por sus propias migraciones (069/090):  ║
-- ║     no existen en la DB y el advisor no puede flagearlas.           ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────────────────────
-- 1. vista_cobertura_stock → security_invoker (Postgres 15+)
--    ALTER VIEW ... SET no toca la definición: no hace falta drop+create.
-- ─────────────────────────────────────────────────────────────────────
alter view public.vista_cobertura_stock set (security_invoker = true);

-- ─────────────────────────────────────────────────────────────────────
-- 2. search_path fijo en las funciones flageadas.
--    ALTER FUNCTION exige la firma exacta (tipos de argumentos).
-- ─────────────────────────────────────────────────────────────────────

-- schema.sql (trigger updated_at de productos/pedidos)
alter function public.set_updated_at() set search_path = public;

-- 011 — trigger de etiquetas pendientes (SECURITY DEFINER, la más sensible)
alter function public.fn_etiqueta_precio_cambio() set search_path = public;

-- 034 — trigger updated_at de tableros
alter function public.tg_tableros_updated_at() set search_path = public;

-- 039 — saldo cta. cte. empleado
alter function public.fn_saldo_cta_cte_empleado(integer) set search_path = public;

-- 065 / 085 — generadores de código/legajo (defaults de columna)
alter function public.fn_generar_codigo() set search_path = public;
alter function public.fn_generar_legajo() set search_path = public;

-- 079 / 112 — triggers de validación de recetas y combos
alter function public.fn_valida_receta() set search_path = public;
alter function public.fn_valida_componente_combo() set search_path = public;

-- 080 — conversión de unidades (immutable; el SET solo agrega proconfig)
alter function public.fn_convertir_unidad(numeric, text, text) set search_path = public;

-- 100 — IP del request para auditoría
alter function public.fn_ip() set search_path = public;

-- 118 — candado del medio efectivo
alter function public.fn_guard_medio_cuenta() set search_path = public;

-- 135 — trigger de transición de estado de pedidos
alter function public.fn_validar_transicion_pedido() set search_path = public;

-- 139 — saldo cta. cte. cliente
alter function public.fn_saldo_cta_cte_cliente(integer) set search_path = public;

-- ─────────────────────────────────────────────────────────────────────
-- Verificación post-migración (correr aparte en el SQL Editor):
--
-- a) La vista quedó invoker:
--    select relname, reloptions from pg_class
--    where relname = 'vista_cobertura_stock';        -- → {security_invoker=true}
--
-- b) No queda ninguna función pública sin search_path fijo:
--    select p.proname
--    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.prokind = 'f'
--      and (p.proconfig is null
--           or not exists (select 1 from unnest(p.proconfig) c
--                          where c like 'search_path=%'));
--    -- → 0 filas (si aparece alguna, fue creada fuera del repo:
--    --    fijarla igual con ALTER FUNCTION ... SET search_path = public)
--
-- c) Smoke test funcional como usuario de la app (no como postgres):
--    la tabla de Inventario debe seguir mostrando días de cobertura.
-- ─────────────────────────────────────────────────────────────────────

notify pgrst, 'reload schema';
