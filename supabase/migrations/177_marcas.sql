-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 177 · Marcas normalizadas (Fase C)                       ║
-- ║                                                                     ║
-- ║  productos.marca es texto libre (mig 065): "Coca Cola" /            ║
-- ║  "Coca-Cola" / "COCA COLA" rompen cualquier agrupación. Se crea la  ║
-- ║  tabla maestra + FK y se backfillea desde el texto existente.       ║
-- ║                                                                     ║
-- ║  productos.marca (text) queda LEGACY: se sigue mostrando (las       ║
-- ║  métricas leen coalesce(marcas.nombre, productos.marca)), el        ║
-- ║  importador la sigue aceptando, y el ABM migrará a select-con-      ║
-- ║  crear cuando se toque el Drawer (P2). Se dropea recién con         ║
-- ║  cobertura total (criterio migs 050→052).                           ║
-- ║                                                                     ║
-- ║  Después de correrla, actualizar types/database.ts:                 ║
-- ║   · Tables: marcas · ProductoRow/Insert/Update: + marca_id          ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

create table if not exists public.marcas (
  id         serial primary key,
  nombre     text not null unique,
  created_at timestamptz not null default now()
);

comment on table public.marcas is
  'Maestro de marcas. productos.marca (texto libre) queda legacy hasta
   migrar el ABM; el backfill matchea por trim exacto.';

alter table public.productos
  add column if not exists marca_id integer
    references public.marcas(id) on delete set null;

create index if not exists productos_marca_idx on public.productos(marca_id);

alter table public.marcas enable row level security;
drop policy if exists "marcas_select" on public.marcas;
drop policy if exists "marcas_write" on public.marcas;
create policy "marcas_select" on public.marcas
  for select to authenticated using (true);
create policy "marcas_write" on public.marcas
  for all to authenticated
  using      ((select public.fn_tiene_permiso('configuracion')))
  with check ((select public.fn_tiene_permiso('configuracion')));

-- Seed + backfill idempotentes desde el texto legacy.
insert into public.marcas (nombre)
select distinct btrim(p.marca)
from public.productos p
where p.marca is not null and btrim(p.marca) <> ''
on conflict (nombre) do nothing;

update public.productos p
   set marca_id = m.id
  from public.marcas m
 where p.marca_id is null
   and p.marca is not null and btrim(p.marca) <> ''
   and m.nombre = btrim(p.marca);

-- Reload PostgREST schema cache.
notify pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────────
-- Verificación post-migración:
--   select count(*) from public.marcas;                      → N marcas
--   select count(*) from public.productos
--   where marca is not null and btrim(marca) <> '' and marca_id is null;
--                                                            → 0
-- ─────────────────────────────────────────────────────────────────────
