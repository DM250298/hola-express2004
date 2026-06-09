-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 074 · Sugerencias de productos (demanda de mostrador)     ║
-- ║                                                                     ║
-- ║  Los cajeros anotan desde el POS productos que los clientes piden y  ║
-- ║  no tenemos. El encargado las gestiona desde Compras: les asigna un  ║
-- ║  proveedor, las mueve de estado y, si corresponde, da de alta el     ║
-- ║  producto (queda vinculado).                                         ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

create table if not exists public.sugerencias_producto (
  id           serial primary key,
  texto        text not null,
  nota         text,
  estado       text not null default 'pendiente'
                 check (estado in ('pendiente', 'en_proceso', 'resuelta', 'descartada')),
  proveedor_id integer references public.proveedores(id) on delete set null,
  producto_id  integer references public.productos(id) on delete set null,
  usuario_id   uuid references public.usuarios(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_sugerencias_estado
  on public.sugerencias_producto(estado);

alter table public.sugerencias_producto enable row level security;

-- Cargar: el cajero (permiso pos) o quien abastece. Gestionar: compras/pedidos.
-- Admin = total (hardcodeado en fn_tiene_permiso).
drop policy if exists "sugerencias_ver"    on public.sugerencias_producto;
drop policy if exists "sugerencias_crear"  on public.sugerencias_producto;
drop policy if exists "sugerencias_editar" on public.sugerencias_producto;
drop policy if exists "sugerencias_borrar" on public.sugerencias_producto;

create policy "sugerencias_ver" on public.sugerencias_producto
  for select to authenticated
  using (
    public.fn_tiene_permiso('pos')
    or public.fn_tiene_permiso('compras')
    or public.fn_tiene_permiso('pedidos')
    or public.fn_tiene_permiso('finanzas')
  );

create policy "sugerencias_crear" on public.sugerencias_producto
  for insert to authenticated
  with check (
    public.fn_tiene_permiso('pos')
    or public.fn_tiene_permiso('compras')
    or public.fn_tiene_permiso('pedidos')
  );

create policy "sugerencias_editar" on public.sugerencias_producto
  for update to authenticated
  using (
    public.fn_tiene_permiso('compras') or public.fn_tiene_permiso('pedidos')
  )
  with check (
    public.fn_tiene_permiso('compras') or public.fn_tiene_permiso('pedidos')
  );

create policy "sugerencias_borrar" on public.sugerencias_producto
  for delete to authenticated
  using (
    public.fn_tiene_permiso('compras') or public.fn_tiene_permiso('pedidos')
  );

notify pgrst, 'reload schema';
