-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 257 · Permiso 'proveedores' (ficha y catálogo)           ║
-- ║                                                                     ║
-- ║  Decisión D9 del dueño (2026-10-13). La pantalla Proveedores        ║
-- ║  (/configuracion/proveedores, atajo en el pilar Compras) pedía      ║
-- ║  'configuracion', que también abre Usuarios y roles y los datos     ║
-- ║  fiscales. El permiso nuevo abre SOLO esa pantalla, para quien      ║
-- ║  compra. Las órdenes ya tienen su permiso ('pedidos').              ║
-- ║                                                                     ║
-- ║  1. Se suma 'proveedores' a todo rol que ya tiene 'configuracion'   ║
-- ║     (admin y el rol del dueño, se llame como se llame): nadie que   ║
-- ║     hoy la ve la pierde. A otros roles se asigna desde              ║
-- ║     Configuración › Usuarios › Roles.                               ║
-- ║  2. proveedor_producto (catálogo N:M con el costo del proveedor)    ║
-- ║     estaba gateada por compras/pedidos/configuracion (mig 069,      ║
-- ║     envuelta por la 111). Se recrea la policy sumando              ║
-- ║     'proveedores', con (select fn_tiene_permiso(...)) por llamada.  ║
-- ║     Se borran TODAS las policies de la tabla antes (RLS las combina ║
-- ║     con OR).                                                        ║
-- ║  'proveedores' (la ficha) no se toca: su policy es using(true) para ║
-- ║  authenticated desde el schema inicial, así que ya se puede editar. ║
-- ║  Idempotente. REQUIERE: mig 047 (fn_tiene_permiso).                 ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- 1. 'proveedores' a los roles que tienen 'configuracion'
update public.roles
set permisos = array_append(permisos, 'proveedores'),
    updated_at = now()
where 'configuracion' = any(permisos)
  and not ('proveedores' = any(permisos));

-- 2. Catálogo proveedor ↔ producto
do $$
declare v_pol text;
begin
  for v_pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'proveedor_producto'
  loop
    execute format('drop policy %I on public.proveedor_producto', v_pol);
  end loop;
end $$;

alter table public.proveedor_producto enable row level security;

create policy "gate_rw" on public.proveedor_producto
  for all to authenticated
  using (
    (select public.fn_tiene_permiso('compras'))
    or (select public.fn_tiene_permiso('pedidos'))
    or (select public.fn_tiene_permiso('configuracion'))
    or (select public.fn_tiene_permiso('proveedores'))
  )
  with check (
    (select public.fn_tiene_permiso('compras'))
    or (select public.fn_tiene_permiso('pedidos'))
    or (select public.fn_tiene_permiso('configuracion'))
    or (select public.fn_tiene_permiso('proveedores'))
  );

notify pgrst, 'reload schema';

-- ─── Verificación ───────────────────────────────────────────────────
-- 1. Roles con el permiso nuevo (deben ser los mismos que tienen
--    configuracion):
--   select codigo, 'configuracion' = any(permisos) as configuracion,
--          'proveedores' = any(permisos) as proveedores
--   from public.roles order by codigo;
--
-- 2. Una sola policy en proveedor_producto ("gate_rw", cmd ALL, con los
--    cuatro permisos). En proveedores tiene que seguir la de using(true):
--   select tablename, policyname, cmd, qual, with_check
--   from pg_policies
--   where schemaname = 'public'
--     and tablename in ('proveedor_producto', 'proveedores')
--   order by tablename, policyname;
