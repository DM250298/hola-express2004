-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 258 · RLS de la ficha de proveedores                     ║
-- ║                                                                     ║
-- ║  public.proveedores seguía con la policy "authenticated todo" del   ║
-- ║  schema inicial (using(true) with check(true)): cualquier usuario   ║
-- ║  logueado, cajero incluido, podía crear, editar o borrar un         ║
-- ║  proveedor (CUIT, razón social, condición de pago) llamando a la    ║
-- ║  API directo, aunque la pantalla no se lo mostrara.                 ║
-- ║                                                                     ║
-- ║  Queda así:                                                         ║
-- ║  · Leer: todo authenticated. La usan Compras, Recepción, el POS     ║
-- ║    (compra directa), Finanzas, Contabilidad y los reportes.         ║
-- ║  · Escribir (insert/update/delete): compras, pedidos,               ║
-- ║    configuracion, proveedores o finanzas (admin siempre).           ║
-- ║                                                                     ║
-- ║  Quién escribe hoy desde el cliente (lib/queries/proveedores.ts):   ║
-- ║  · Alta y edición de la ficha (DrawerProveedor): pantalla           ║
-- ║    /configuracion/proveedores, abre con configuracion o             ║
-- ║    proveedores (mig 257).                                           ║
-- ║  · completarCuitProveedor: la carga de factura (Finanzas y          ║
-- ║    Compras › Facturas, permiso finanzas) y la compra directa (POS   ║
-- ║    con compras; Compras › Facturas con finanzas). Es best-effort:   ║
-- ║    sin permiso el update no toca filas y no da error.               ║
-- ║  · Las importaciones (fn_importar_proveedores, fn_importar_         ║
-- ║    productos) son security definer y ya exigen configuracion: no    ║
-- ║    cambian.                                                         ║
-- ║                                                                     ║
-- ║  Se borran TODAS las policies de la tabla antes de crear las        ║
-- ║  nuevas (RLS las combina con OR). fn_tiene_permiso va envuelta en   ║
-- ║  (select ...) para que se evalúe una vez por consulta.              ║
-- ║  Idempotente. REQUIERE: mig 047 (fn_tiene_permiso) y 257 (permiso   ║
-- ║  proveedores en los roles con configuracion).                       ║
-- ╚════════════════════════════════════════════════════════════════════╝

do $$
declare v_pol text;
begin
  for v_pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'proveedores'
  loop
    execute format('drop policy %I on public.proveedores', v_pol);
  end loop;
end $$;

alter table public.proveedores enable row level security;

create policy "proveedores_select" on public.proveedores
  for select to authenticated using (true);

create policy "proveedores_write" on public.proveedores
  for all to authenticated
  using (
    (select public.fn_tiene_permiso('compras'))
    or (select public.fn_tiene_permiso('pedidos'))
    or (select public.fn_tiene_permiso('configuracion'))
    or (select public.fn_tiene_permiso('proveedores'))
    or (select public.fn_tiene_permiso('finanzas'))
  )
  with check (
    (select public.fn_tiene_permiso('compras'))
    or (select public.fn_tiene_permiso('pedidos'))
    or (select public.fn_tiene_permiso('configuracion'))
    or (select public.fn_tiene_permiso('proveedores'))
    or (select public.fn_tiene_permiso('finanzas'))
  );

notify pgrst, 'reload schema';

-- ─── Verificación ───────────────────────────────────────────────────
-- 1. Dos policies en proveedores: "proveedores_select" (SELECT, true) y
--    "proveedores_write" (ALL, con los cinco permisos). No tiene que
--    quedar "authenticated todo":
--   select policyname, cmd, roles, qual, with_check
--   from pg_policies
--   where schemaname = 'public' and tablename = 'proveedores'
--   order by policyname;
--
-- 2. Roles que pueden escribir proveedores (admin siempre puede):
--   select codigo,
--          permisos && array['compras','pedidos','configuracion',
--                            'proveedores','finanzas'] as escribe_proveedores
--   from public.roles order by codigo;
--
-- 3. Prueba con rollback: supabase/tests/test_rls_proveedores.sql
