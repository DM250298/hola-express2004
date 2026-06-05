-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 052 · R1.2 Parte 4 (FINAL) — borrar productos.precio_costo║
-- ║                                                                     ║
-- ║  Acá aterriza el blindaje: se borra la columna vieja, el trigger    ║
-- ║  de transición y su función. A partir de ahora el costo vive SOLO   ║
-- ║  en costos_producto (gateada por RLS), así que un cajero no puede   ║
-- ║  leerlo ni por API.                                                 ║
-- ║                                                                     ║
-- ║  PRE-REQUISITO: correr ANTES la 050, 051 y haber desplegado el      ║
-- ║  frontend de la Parte 4 (las escrituras ya van a costos_producto).  ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- 1. Sacar el trigger de transición y su función
drop trigger if exists trg_sync_costo on public.productos;
drop function if exists public.fn_sync_costo_producto();

-- 2. Borrar la columna vieja (el costo queda solo en costos_producto)
alter table public.productos drop column if exists precio_costo;

notify pgrst, 'reload schema';
