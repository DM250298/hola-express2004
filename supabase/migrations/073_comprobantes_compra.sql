-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 073 · Imágenes de comprobante (factura/remito) del pedido ║
-- ║                                                                     ║
-- ║  En la recepción se puede escanear/subir varias fotos de la factura ║
-- ║  o el remito. Se asocian al PEDIDO (no a la factura formal, que se   ║
-- ║  carga después) y se ven también al cargar la factura en Facturas.  ║
-- ║                                                                     ║
-- ║   1. Tabla `pedido_comprobantes` (N imágenes por pedido).           ║
-- ║   2. Bucket PRIVADO `comprobantes` (datos fiscales → no público).   ║
-- ║   Acceso: quien abastece (recepcion/pedidos/compras) o finanzas.    ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────────────────────
-- 1. Tabla de imágenes de comprobante del pedido
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.pedido_comprobantes (
  id           serial primary key,
  pedido_id    integer not null references public.pedidos(id) on delete cascade,
  storage_path text not null,
  usuario_id   uuid references public.usuarios(id),
  created_at   timestamptz not null default now()
);

create index if not exists idx_pedcomp_pedido
  on public.pedido_comprobantes(pedido_id);

alter table public.pedido_comprobantes enable row level security;

-- Gateado por permiso de abastecimiento o finanzas (admin = total en fn_tiene_permiso).
drop policy if exists "pedcomp_ver"    on public.pedido_comprobantes;
drop policy if exists "pedcomp_insert" on public.pedido_comprobantes;
drop policy if exists "pedcomp_borrar" on public.pedido_comprobantes;

create policy "pedcomp_ver" on public.pedido_comprobantes
  for select to authenticated
  using (
    public.fn_tiene_permiso('recepcion')
    or public.fn_tiene_permiso('pedidos')
    or public.fn_tiene_permiso('compras')
    or public.fn_tiene_permiso('finanzas')
  );

create policy "pedcomp_insert" on public.pedido_comprobantes
  for insert to authenticated
  with check (
    public.fn_tiene_permiso('recepcion')
    or public.fn_tiene_permiso('pedidos')
    or public.fn_tiene_permiso('compras')
    or public.fn_tiene_permiso('finanzas')
  );

create policy "pedcomp_borrar" on public.pedido_comprobantes
  for delete to authenticated
  using (
    public.fn_tiene_permiso('recepcion')
    or public.fn_tiene_permiso('pedidos')
    or public.fn_tiene_permiso('compras')
    or public.fn_tiene_permiso('finanzas')
  );

-- ─────────────────────────────────────────────────────────────────────
-- 2. Bucket PRIVADO de Storage para las imágenes
--    (privado → se accede con signed URLs temporales desde el cliente)
-- ─────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('comprobantes', 'comprobantes', false)
on conflict (id) do nothing;

drop policy if exists "comprobantes_ver"    on storage.objects;
drop policy if exists "comprobantes_subir"  on storage.objects;
drop policy if exists "comprobantes_borrar" on storage.objects;

create policy "comprobantes_ver" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'comprobantes' and (
      public.fn_tiene_permiso('recepcion')
      or public.fn_tiene_permiso('pedidos')
      or public.fn_tiene_permiso('compras')
      or public.fn_tiene_permiso('finanzas')
    )
  );

create policy "comprobantes_subir" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'comprobantes' and (
      public.fn_tiene_permiso('recepcion')
      or public.fn_tiene_permiso('pedidos')
      or public.fn_tiene_permiso('compras')
      or public.fn_tiene_permiso('finanzas')
    )
  );

create policy "comprobantes_borrar" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'comprobantes' and (
      public.fn_tiene_permiso('recepcion')
      or public.fn_tiene_permiso('pedidos')
      or public.fn_tiene_permiso('compras')
      or public.fn_tiene_permiso('finanzas')
    )
  );

notify pgrst, 'reload schema';
