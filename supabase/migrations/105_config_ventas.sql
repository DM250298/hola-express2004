-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 105 · config_ventas (singleton) · vender sin stock       ║
-- ║                                                                     ║
-- ║  Nueva config global del POS. Por ahora una sola opción:            ║
-- ║  `permitir_venta_sin_stock`. Cuando está en TRUE, el POS deja       ║
-- ║  agregar y cobrar productos aunque el stock sea 0 o quede negativo. ║
-- ║  Default FALSE = comportamiento actual (bloquea vender sin stock).  ║
-- ║                                                                     ║
-- ║  Nota: el RPC fn_crear_venta YA es permisivo con el stock negativo  ║
-- ║  (descuenta sin validar); el bloqueo vivía solo en el frontend.     ║
-- ║  Esta tabla persiste la decisión para que la UI la respete.         ║
-- ║                                                                     ║
-- ║  RLS: lectura abierta a todo autenticado (el POS/cajero necesita    ║
-- ║  leer el flag); escritura gateada por permiso 'configuracion'.      ║
-- ║  El rol de administración ('administración') ya lo tiene, porque    ║
-- ║  entra al módulo de Configuración.                                  ║
-- ║                                                                     ║
-- ║  Sigue el patrón de config_compras (042) y config_fiscal (054).     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

create table if not exists public.config_ventas (
  id                        integer primary key default 1,
  permitir_venta_sin_stock  boolean not null default false,
  constraint config_ventas_singleton check (id = 1)
);

insert into public.config_ventas (id) values (1) on conflict (id) do nothing;

alter table public.config_ventas enable row level security;

-- Lectura: cualquier usuario autenticado (el POS la lee para decidir el clamp).
do $$ begin
  create policy "config_ventas_select" on public.config_ventas
    for select to authenticated using (true);
exception when duplicate_object then null; end $$;

-- Escritura (insert/update/delete): solo quien tenga permiso 'configuracion'.
do $$ begin
  create policy "config_ventas_write" on public.config_ventas
    for all to authenticated
    using (public.fn_tiene_permiso('configuracion'))
    with check (public.fn_tiene_permiso('configuracion'));
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';
