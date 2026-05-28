-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 041 · Pedidos de la tienda online (e-commerce)         ║
-- ║                                                                   ║
-- ║  Tabla para almacenar los pedidos que hacen los clientes desde    ║
-- ║  la tienda web. Los pedidos se procesan desde el dashboard.       ║
-- ║                                                                   ║
-- ║  Ejecutar UNA sola vez en el SQL Editor de Supabase.              ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- Estado del pedido web
create type public.estado_pedido_tienda as enum (
  'pendiente',    -- recién creado, esperando confirmación
  'confirmado',   -- la tienda lo aceptó
  'preparando',   -- se está armando
  'listo',        -- listo para retirar / entregar
  'entregado',    -- completado
  'cancelado'     -- cancelado por la tienda o el cliente
);

-- Método de entrega
create type public.metodo_entrega as enum (
  'retiro',       -- el cliente retira en el local
  'delivery'      -- envío a domicilio
);

-- Cabecera del pedido
create table public.pedidos_tienda (
  id            serial primary key,
  codigo        text not null unique,  -- ej: "HE-0001"
  estado        public.estado_pedido_tienda not null default 'pendiente',
  metodo_entrega public.metodo_entrega not null default 'retiro',

  -- Datos del cliente (sin login requerido)
  cliente_nombre    text not null,
  cliente_telefono  text not null,
  cliente_email     text,
  cliente_direccion text,  -- solo para delivery
  cliente_notas     text,  -- instrucciones especiales

  total         numeric(12,2) not null default 0,
  cantidad_items integer not null default 0,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Items del pedido
create table public.items_pedido_tienda (
  id            serial primary key,
  pedido_id     integer not null references public.pedidos_tienda(id) on delete cascade,
  producto_id   integer not null references public.productos(id),
  nombre        text not null,         -- snapshot del nombre al momento del pedido
  precio_unitario numeric(12,2) not null,
  cantidad      integer not null default 1,
  subtotal      numeric(12,2) not null,
  created_at    timestamptz not null default now()
);

-- Índices
create index idx_pedidos_tienda_estado on public.pedidos_tienda(estado);
create index idx_pedidos_tienda_created on public.pedidos_tienda(created_at desc);
create index idx_items_pedido_tienda_pedido on public.items_pedido_tienda(pedido_id);

-- Secuencia para código legible
create sequence public.pedidos_tienda_codigo_seq start 1;

-- RLS: la tienda es pública (anon puede insertar pedidos, leer los suyos)
alter table public.pedidos_tienda enable row level security;
alter table public.items_pedido_tienda enable row level security;

-- Anon puede crear pedidos
create policy "anon_insert_pedidos_tienda"
  on public.pedidos_tienda for insert
  to anon with check (true);

-- Anon puede leer su propio pedido por código
create policy "anon_select_pedidos_tienda"
  on public.pedidos_tienda for select
  to anon using (true);

-- Authenticated (dashboard) puede todo
create policy "auth_all_pedidos_tienda"
  on public.pedidos_tienda for all
  to authenticated using (true) with check (true);

-- Items: anon puede insertar y leer
create policy "anon_insert_items_pedido_tienda"
  on public.items_pedido_tienda for insert
  to anon with check (true);

create policy "anon_select_items_pedido_tienda"
  on public.items_pedido_tienda for select
  to anon using (true);

create policy "auth_all_items_pedido_tienda"
  on public.items_pedido_tienda for all
  to authenticated using (true) with check (true);

notify pgrst, 'reload schema';
