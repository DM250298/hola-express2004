-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 002: agregar tipo y unidad a productos                   ║
-- ║                                                                     ║
-- ║  Permite filtrar y categorizar productos por:                       ║
-- ║   · tipo:   'simple' (default) / 'combo' / 'variante'               ║
-- ║   · unidad: 'unidad' (default) / 'kg' / 'g' / 'lt' / 'ml' / etc.    ║
-- ║                                                                     ║
-- ║  Son text libre (no enum) para máxima flexibilidad.                 ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez en SQL Editor de Supabase.                   ║
-- ╚════════════════════════════════════════════════════════════════════╝

alter table public.productos
  add column if not exists tipo text not null default 'simple',
  add column if not exists unidad text not null default 'unidad';

create index if not exists productos_tipo_idx on public.productos(tipo);
create index if not exists productos_unidad_idx on public.productos(unidad);
