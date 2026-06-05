-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 062 · Datos fiscales del proveedor                       ║
-- ║                                                                     ║
-- ║  Agrega a `proveedores` los datos fiscales necesarios para operar   ║
-- ║  como RI y armar el Libro IVA Compras: CUIT, razón social,          ║
-- ║  condición frente al IVA y domicilio. Todas nullable → no rompe     ║
-- ║  proveedores existentes.                                            ║
-- ║                                                                     ║
-- ║  condicion_iva: responsable_inscripto | monotributo | exento |     ║
-- ║                 consumidor_final                                    ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez en el SQL Editor de Supabase.               ║
-- ╚════════════════════════════════════════════════════════════════════╝

alter table public.proveedores
  add column if not exists cuit text,
  add column if not exists razon_social text,
  add column if not exists condicion_iva text,
  add column if not exists domicilio text;

notify pgrst, 'reload schema';
