-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 025 · FASE 1 — Conciliación bancaria                     ║
-- ║                                                                     ║
-- ║  Agrega a cada movimiento de cuenta la marca de conciliado, para    ║
-- ║  cruzarlo manualmente contra el extracto del banco.                 ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez en el SQL Editor de Supabase.                ║
-- ╚════════════════════════════════════════════════════════════════════╝

alter table public.movimientos_cuenta
  add column if not exists conciliado boolean not null default false;

alter table public.movimientos_cuenta
  add column if not exists fecha_conciliacion timestamptz;

notify pgrst, 'reload schema';
