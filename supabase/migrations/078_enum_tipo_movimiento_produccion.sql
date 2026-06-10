-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 078 · Enum tipo_movimiento: valores de producción        ║
-- ║                                                                     ║
-- ║  Prerequisito del módulo Producción (Fase 0). Migración AISLADA.    ║
-- ║                                                                     ║
-- ║  tipo_movimiento es un enum CERRADO ('entrada','salida','ajuste',   ║
-- ║  'merma','venta'). El Modelo B necesita dos tipos nuevos:           ║
-- ║   · consumo_produccion → salida de insumos al iniciar la orden      ║
-- ║   · ingreso_produccion → alta del elaborado al cerrar la orden      ║
-- ║                                                                     ║
-- ║  ⚠️ Va SOLA y ANTES de las migraciones que crean las RPCs que usan  ║
-- ║  estos valores: ALTER TYPE ADD VALUE no es usable en la misma        ║
-- ║  transacción donde se agrega. Correr ESTA migración completa, y     ║
-- ║  recién después las que la consumen (080/081).                      ║
-- ║                                                                     ║
-- ║  Idempotente con IF NOT EXISTS. NADA más en este archivo.           ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

alter type public.tipo_movimiento add value if not exists 'consumo_produccion';
alter type public.tipo_movimiento add value if not exists 'ingreso_produccion';

notify pgrst, 'reload schema';
