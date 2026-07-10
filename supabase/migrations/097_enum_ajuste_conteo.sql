-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 097 · Enum tipo_movimiento: valor 'ajuste_conteo'        ║
-- ║                                                                     ║
-- ║  Prerequisito del módulo Conteo Físico por zonas (098). Migración   ║
-- ║  AISLADA, igual que la 078: ALTER TYPE ADD VALUE no es usable en    ║
-- ║  la misma transacción donde se agrega.                              ║
-- ║                                                                     ║
-- ║  ⚠️ Correr ESTA migración completa, y recién después la 098 que la  ║
-- ║  consume. Idempotente con IF NOT EXISTS. NADA más en este archivo.  ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

alter type public.tipo_movimiento add value if not exists 'ajuste_conteo';

notify pgrst, 'reload schema';
