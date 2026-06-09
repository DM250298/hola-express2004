-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 066 · Flags de producto + imagen                         ║
-- ║                                                                     ║
-- ║  Campos nuevos del maestro de productos:                            ║
-- ║   - visible_tienda      → aparece en la tienda online (default sí)   ║
-- ║   - controlar_stock     → descuenta stock al vender (default sí)     ║
-- ║   - no_ofrecer_ventas   → se oculta del POS (default no)             ║
-- ║   - notas               → texto libre interno                        ║
-- ║   - imagen_url          → URL de la foto (Supabase Storage)          ║
-- ║                                                                     ║
-- ║  Los defaults conservan el comportamiento actual de los productos   ║
-- ║  ya cargados (visibles, con control de stock, ofrecidos).           ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

alter table public.productos
  add column if not exists visible_tienda    boolean not null default true,
  add column if not exists controlar_stock   boolean not null default true,
  add column if not exists no_ofrecer_ventas boolean not null default false,
  add column if not exists notas             text,
  add column if not exists imagen_url        text;

notify pgrst, 'reload schema';
