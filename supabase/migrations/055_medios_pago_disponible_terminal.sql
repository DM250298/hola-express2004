-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 045: medios de pago disponibles en terminal              ║
-- ║                                                                     ║
-- ║  Agrega la columna `disponible_terminal` a `medios_pago` para       ║
-- ║  que el modal de cobro con posnet pueda mostrar una lista propia    ║
-- ║  de formas de pago, distinta de las activas del POS.                ║
-- ║                                                                     ║
-- ║  · `activo`              → aparece en el POS (modal cobro normal)   ║
-- ║  · `disponible_terminal` → aparece en el modal "Cobrar con posnet"  ║
-- ║                                                                     ║
-- ║  Ambos flags son independientes: un medio puede estar en ambos,     ║
-- ║  en uno solo, o en ninguno.                                         ║
-- ║                                                                     ║
-- ║  Backfill: por defecto los medios no-efectivo quedan disponibles    ║
-- ║  en terminal (replica el comportamiento actual del modal).          ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- 1. Agregar columna
alter table public.medios_pago
  add column if not exists disponible_terminal boolean not null default false;

-- 2. Backfill: todos los medios actuales no-efectivo quedan disponibles
--    en terminal (es lo que el modal de cobro con posnet mostraba antes).
update public.medios_pago
set disponible_terminal = true
where codigo <> 'efectivo';

notify pgrst, 'reload schema';
