-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 012: facturas de compra con impuestos                    ║
-- ║                                                                     ║
-- ║  Al cargar la factura de una cuenta a pagar se guarda el detalle    ║
-- ║  impositivo (IVA de compra y venta, descuentos, márgenes) para      ║
-- ║  poder sacar reportes de IVA compras.                               ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

create table if not exists public.facturas_compra (
  id serial primary key,
  cuenta_id integer unique
    references public.cuentas_a_pagar(id) on delete cascade,
  pedido_id integer,
  proveedor_id integer,
  fecha date not null default current_date,
  neto numeric(12,2) not null default 0,
  iva_total numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  afecta_precio_venta boolean not null default true,
  usuario_id uuid references public.usuarios(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.items_factura_compra (
  id serial primary key,
  factura_id integer not null
    references public.facturas_compra(id) on delete cascade,
  producto_id integer not null references public.productos(id),
  cantidad numeric(12,3) not null default 1,
  costo_sin_iva numeric(12,2) not null default 0,
  descuento_porcentaje numeric(6,2) not null default 0,
  iva_compra_porcentaje numeric(6,2) not null default 21,
  costo_con_iva numeric(12,2) not null default 0,
  margen_porcentaje numeric(8,2) not null default 0,
  iva_venta_porcentaje numeric(6,2) not null default 21,
  precio_sin_iva numeric(12,2) not null default 0,
  precio_con_iva numeric(12,2) not null default 0
);

alter table public.facturas_compra enable row level security;
alter table public.items_factura_compra enable row level security;

do $$ begin
  create policy "todo" on public.facturas_compra
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "todo" on public.items_factura_compra
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';
