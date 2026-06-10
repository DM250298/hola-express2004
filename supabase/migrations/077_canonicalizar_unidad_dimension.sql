-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 077 · Canonicalizar productos.unidad + dimension         ║
-- ║                                                                     ║
-- ║  Prerequisito del módulo Producción (Fase 0).                       ║
-- ║                                                                     ║
-- ║  productos.unidad es text libre (mig 002) y puramente decorativa:   ║
-- ║  hay datos sucios ('Kg','kilo','litro','L'). El costeo de recetas   ║
-- ║  convierte unidad de receta → unidad de stock buscando la unidad en ║
-- ║  un mapa de factores físicos; 'litro' no matchea 'lt' y la          ║
-- ║  conversión fallaría. Acá se normaliza a un set cerrado             ║
-- ║  {kg, g, lt, ml, unidad} y se agrega la columna dimension           ║
-- ║  ('peso'|'volumen'|'conteo') como guardarrail: dos unidades         ║
-- ║  convierten solo si comparten dimensión.                            ║
-- ║                                                                     ║
-- ║  NO se agrega CHECK sobre unidad (no romper inserts/imports         ║
-- ║  existentes); el set cerrado se valida en lib/utils/unidades.ts.    ║
-- ║  'docena'/'caja' y cualquier otro valor caen a 'unidad' (conteo):   ║
-- ║  el sistema nunca usó unidad para conversión, así que es seguro.    ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────────────────────
-- 1. Canonicalizar unidad a {kg, g, lt, ml, unidad}
--    Primero las variantes de peso/volumen; lo que quede afuera → unidad.
-- ─────────────────────────────────────────────────────────────────────
update public.productos set unidad = 'kg'
  where lower(trim(unidad)) in ('kg','kilo','kilos','kilogramo','kilogramos');
update public.productos set unidad = 'g'
  where lower(trim(unidad)) in ('g','gr','grs','gramo','gramos');
update public.productos set unidad = 'lt'
  where lower(trim(unidad)) in ('lt','l','lts','litro','litros');
update public.productos set unidad = 'ml'
  where lower(trim(unidad)) in ('ml','cc','mililitro','mililitros');
-- Todo lo demás (unidad, u, un, c/u, docena, caja, NULL, etc.) → 'unidad'
update public.productos set unidad = 'unidad'
  where unidad is null or unidad not in ('kg','g','lt','ml');

-- ─────────────────────────────────────────────────────────────────────
-- 2. Columna dimension derivada de la unidad canónica
-- ─────────────────────────────────────────────────────────────────────
alter table public.productos add column if not exists dimension text;

update public.productos set dimension = case
  when unidad in ('kg','g')  then 'peso'
  when unidad in ('lt','ml') then 'volumen'
  else 'conteo'
end;

alter table public.productos alter column dimension set default 'conteo';
alter table public.productos alter column dimension set not null;
alter table public.productos
  add constraint productos_dimension_chk
  check (dimension in ('peso','volumen','conteo'));

notify pgrst, 'reload schema';
