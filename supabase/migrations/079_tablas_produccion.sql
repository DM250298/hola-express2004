-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 079 · Tablas del módulo Producción (Fase 1)              ║
-- ║                                                                     ║
-- ║  Elaboración de comida (Modelo B). Un semi-elaborado/elaborado es   ║
-- ║  un producto más (productos.tipo). Acá se crean:                    ║
-- ║   · recetas              → 1 por producto (producto_id UNIQUE)      ║
-- ║   · receta_ingredientes  → BOM; insumo puede ser insumo o semi      ║
-- ║   · ordenes_produccion   → Modelo B (borrador→iniciada→cerrada)     ║
-- ║   · items_orden_prod     → snapshot de consumo (cantidad + costo)   ║
-- ║                                                                     ║
-- ║  RLS gateada por permiso 'produccion' (admin = total hardcodeado).  ║
-- ║  Trigger valida en SERVIDOR que unidad_rendimiento == productos.    ║
-- ║  unidad del producido (no solo en la UI).                           ║
-- ║                                                                     ║
-- ║  Taxonomía productos.tipo: se reclasifica el genérico 'simple' a    ║
-- ║  'reventa' y se cambia el default. NO se agrega CHECK: el importador ║
-- ║  de Excel produce 'simple'/'combo'/'variante'; la taxonomía nueva   ║
-- ║  (insumo|semi_elaborado|elaborado|reventa) se valida en TS y en los ║
-- ║  buscadores de receta.                                              ║
-- ║                                                                     ║
-- ║  Depende de la 078 (no usa el enum nuevo todavía, pero las RPCs de  ║
-- ║  la 081 sí). Ejecutar UNA sola vez, COMPLETO, en el SQL Editor.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────────────────────
-- 1. Tablas
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.recetas (
  id                 serial primary key,
  producto_id        integer not null unique references public.productos(id) on delete cascade,
  rendimiento        numeric(14,4) not null check (rendimiento > 0),
  unidad_rendimiento text not null,
  vida_util_dias     integer not null default 0 check (vida_util_dias >= 0),
  activa             boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists public.receta_ingredientes (
  id          serial primary key,
  receta_id   integer not null references public.recetas(id) on delete cascade,
  insumo_id   integer not null references public.productos(id),
  cantidad    numeric(14,4) not null check (cantidad > 0),
  unidad      text not null,
  merma_pct   numeric(6,3) not null default 0 check (merma_pct >= 0 and merma_pct < 100),
  created_at  timestamptz not null default now()
);

create table if not exists public.ordenes_produccion (
  id                   serial primary key,
  producto_id          integer not null references public.productos(id),
  receta_id            integer references public.recetas(id),
  cantidad_planificada numeric(14,4) not null check (cantidad_planificada > 0),
  cantidad_producida   numeric(14,4),
  estado               text not null default 'borrador'
                         check (estado in ('borrador','iniciada','cerrada','cancelada')),
  lote_id              integer references public.lotes(id),
  costo_total          numeric(14,4) not null default 0,
  usuario_id           uuid references public.usuarios(id),
  fecha_inicio         timestamptz,
  fecha_cierre         timestamptz,
  nota                 text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create table if not exists public.items_orden_prod (
  id                 serial primary key,
  orden_id           integer not null references public.ordenes_produccion(id) on delete cascade,
  insumo_id          integer not null references public.productos(id),
  cantidad_consumida numeric(14,4) not null,   -- ya convertida a la unidad de stock del insumo
  costo_unitario     numeric(12,4) not null default 0,
  subtotal           numeric(14,4) not null default 0,
  created_at         timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────
-- 2. Índices
-- ─────────────────────────────────────────────────────────────────────
create index if not exists idx_receta_ing_receta on public.receta_ingredientes(receta_id);
create index if not exists idx_receta_ing_insumo on public.receta_ingredientes(insumo_id);
create index if not exists idx_op_estado         on public.ordenes_produccion(estado);
create index if not exists idx_op_producto       on public.ordenes_produccion(producto_id);
create index if not exists idx_iop_orden         on public.items_orden_prod(orden_id);

-- ─────────────────────────────────────────────────────────────────────
-- 3. RLS gateada por permiso 'produccion'
--    (drop de cualquier policy previa para no dejar una using(true) que
--     conviva por OR; patrón de la 069). Admin = total en fn_tiene_permiso.
-- ─────────────────────────────────────────────────────────────────────
do $$
declare v_tabla text; v_pol text;
begin
  foreach v_tabla in array array['recetas','receta_ingredientes','ordenes_produccion','items_orden_prod']
  loop
    for v_pol in
      select policyname from pg_policies where schemaname='public' and tablename=v_tabla
    loop
      execute format('drop policy %I on public.%I', v_pol, v_tabla);
    end loop;
    execute format('alter table public.%I enable row level security', v_tabla);
    execute format(
      'create policy "gate_rw" on public.%I for all to authenticated '
      || 'using (public.fn_tiene_permiso(''produccion'')) '
      || 'with check (public.fn_tiene_permiso(''produccion''))', v_tabla);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 4. Validación en servidor: unidad_rendimiento == productos.unidad
--    del producido (el costo unitario del semi = costo_total/rendimiento
--    se distorsiona si la unidad del rinde difiere de la de stock).
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_valida_receta()
returns trigger language plpgsql as $$
declare v_unidad_prod text;
begin
  select unidad into v_unidad_prod from public.productos where id = new.producto_id;
  if v_unidad_prod is null then
    raise exception 'El producto % de la receta no existe.', new.producto_id;
  end if;
  if new.unidad_rendimiento <> v_unidad_prod then
    raise exception 'unidad_rendimiento (%) debe igualar la unidad del producto (%).',
      new.unidad_rendimiento, v_unidad_prod;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_valida_receta on public.recetas;
create trigger trg_valida_receta
  before insert or update on public.recetas
  for each row execute function public.fn_valida_receta();

-- ─────────────────────────────────────────────────────────────────────
-- 5. Taxonomía productos.tipo (sin CHECK; ver nota del header)
-- ─────────────────────────────────────────────────────────────────────
update public.productos set tipo = 'reventa' where tipo = 'simple' or tipo is null;
alter table public.productos alter column tipo set default 'reventa';

notify pgrst, 'reload schema';
