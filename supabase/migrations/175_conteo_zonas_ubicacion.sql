-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 175 · conteo_zonas ↔ ubicaciones (Fase B del plan)       ║
-- ║                                                                     ║
-- ║  Las zonas del conteo físico (mig 098) son texto libre por sesión:  ║
-- ║  dos sesiones pueden llamar distinto a la misma góndola y no hay    ║
-- ║  forma de comparar diferencias de una misma zona entre conteos.     ║
-- ║  Con esta FK opcional, la zona puede anclarse a un nodo del árbol   ║
-- ║  físico (mig 170) y, al cerrar la sesión, los productos contados    ║
-- ║  pueden asignarse masivamente a esa ubicación: EL CONTEO — trabajo  ║
-- ║  que ya hacen — CARGA EL MAPA GRATIS.                               ║
-- ║                                                                     ║
-- ║  Cambio 100% aditivo: columna nullable, ninguna RPC del conteo se   ║
-- ║  toca (las zonas sin ancla siguen funcionando igual).               ║
-- ║                                                                     ║
-- ║  Después de correrla, actualizar types/database.ts:                 ║
-- ║   · ConteoZonaRow/Insert/Update: + ubicacion_id                     ║
-- ║  REQUIERE: mig 170. Ejecutar UNA sola vez, COMPLETO.                ║
-- ╚════════════════════════════════════════════════════════════════════╝

alter table public.conteo_zonas
  add column if not exists ubicacion_id integer
    references public.ubicaciones(id) on delete set null;

comment on column public.conteo_zonas.ubicacion_id is
  'Nodo del árbol físico (mig 170) al que corresponde esta zona de conteo.
   NULL = zona sin anclar (texto libre, comportamiento histórico). Con ancla,
   las diferencias de una misma ubicación son comparables entre sesiones y
   los productos contados pueden asignarse al mapa al cerrar.';

create index if not exists conteo_zonas_ubicacion_idx
  on public.conteo_zonas(ubicacion_id);

-- Reload PostgREST schema cache.
notify pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────────
-- Verificación post-migración:
--
--   select column_name from information_schema.columns
--   where table_name = 'conteo_zonas' and column_name = 'ubicacion_id';
--   → 1 fila.
-- ─────────────────────────────────────────────────────────────────────
