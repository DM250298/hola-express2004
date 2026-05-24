-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 038 · Días mínimos al vencimiento por producto           ║
-- ║                                                                     ║
-- ║  Cada producto puede definir los DÍAS MÍNIMOS que tiene que tener   ║
-- ║  hasta el vencimiento al momento de recibirlo del proveedor.        ║
-- ║                                                                     ║
-- ║  Si es NULL, no se valida nada (default).                           ║
-- ║                                                                     ║
-- ║  Cuando alguien recibe mercadería con menos días que el mínimo,     ║
-- ║  la UI muestra un cartel de alerta y obliga a aceptarlo explícito.  ║
-- ╚════════════════════════════════════════════════════════════════════╝

alter table public.productos
  add column if not exists dias_vencimiento_minimo integer;

comment on column public.productos.dias_vencimiento_minimo is
  'Días mínimos hasta vencimiento al recibir mercadería. NULL = sin validación.';

notify pgrst, 'reload schema';
