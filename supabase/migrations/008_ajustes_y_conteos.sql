-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 008: ajustes de stock y conteos de mercadería            ║
-- ║                                                                     ║
-- ║  · ajustes_stock / items_ajuste_stock → ajuste masivo por scanner   ║
-- ║  · conteos / conteos_items → conteo físico asignado a un empleado   ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─── Ajustes de stock (documento con varios items) ──────────────────
create table if not exists public.ajustes_stock (
  id serial primary key,
  usuario_id uuid references public.usuarios(id),
  fecha timestamptz not null default now(),
  razon text not null default 'otra',
  razon_detalle text,
  total_costo numeric(12,2) not null default 0,
  cantidad_items integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.items_ajuste_stock (
  id serial primary key,
  ajuste_id integer not null references public.ajustes_stock(id) on delete cascade,
  producto_id integer not null references public.productos(id),
  tipo text not null,                       -- 'entrada' | 'salida' | 'ajuste'
  cantidad integer not null,
  stock_anterior integer not null,
  stock_final integer not null,
  costo_unitario numeric(12,2) not null default 0,
  subtotal numeric(12,2) not null default 0
);

-- ─── Conteos de mercadería ──────────────────────────────────────────
create table if not exists public.conteos (
  id serial primary key,
  nombre text not null,
  usuario_asignado uuid references public.usuarios(id),
  usuario_creador uuid references public.usuarios(id),
  usuario_aprobador uuid references public.usuarios(id),
  estado text not null default 'pendiente', -- 'pendiente' | 'contado' | 'aprobado'
  fecha_creacion timestamptz not null default now(),
  fecha_conteo timestamptz,
  fecha_aprobacion timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.conteos_items (
  id serial primary key,
  conteo_id integer not null references public.conteos(id) on delete cascade,
  producto_id integer not null references public.productos(id),
  stock_sistema integer not null default 0,
  cantidad_contada integer,
  contado boolean not null default false
);

-- ─── RLS ────────────────────────────────────────────────────────────
alter table public.ajustes_stock enable row level security;
alter table public.items_ajuste_stock enable row level security;
alter table public.conteos enable row level security;
alter table public.conteos_items enable row level security;

do $$ begin
  create policy "todo" on public.ajustes_stock
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "todo" on public.items_ajuste_stock
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "todo" on public.conteos
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "todo" on public.conteos_items
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';
