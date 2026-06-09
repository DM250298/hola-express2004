-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 069 · Cierra fugas de RLS: costo, fiscal y pagos          ║
-- ║                                                                      ║
-- ║  La 047 gateó finanzas/contabilidad/rrhh, pero quedaron abiertas     ║
-- ║  (using(true)) tablas que exponen el COSTO de los productos a        ║
-- ║  cualquier autenticado (incluido el cajero), la config fiscal        ║
-- ║  (¡editable!) y el historial de pagos a proveedores.                 ║
-- ║                                                                      ║
-- ║  Cada tabla la leen VARIOS módulos, así que se gatean con OR de      ║
-- ║  permisos (no uno solo) para no romper Compras, Libro IVA ni         ║
-- ║  Contabilidad. El cajero no tiene ninguno de esos permisos → no ve   ║
-- ║  costo. Los RPCs son SECURITY DEFINER → bypassean RLS y siguen       ║
-- ║  funcionando (recepción, factura de compra, pago de cuenta).         ║
-- ║  RLS deniega = resultado vacío, no error: nada crashea.              ║
-- ║                                                                      ║
-- ║  NO incluye la tienda (pedidos_tienda): eso va en un paso aparte     ║
-- ║  porque requiere tocar los route handlers antes de cerrar `anon`.    ║
-- ║                                                                      ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.      ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- Helper: borra TODAS las policies de la tabla (clave para no dejar una
-- vieja `using(true)` conviviendo —RLS las combina con OR—), habilita RLS
-- y crea una policy `for all` gateada por CUALQUIERA de los permisos (OR).
create or replace function public.fn__rls_gate_multi(p_tabla text, p_permisos text[])
returns void language plpgsql as $$
declare v_pol text; v_cond text;
begin
  for v_pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = p_tabla
  loop
    execute format('drop policy %I on public.%I', v_pol, p_tabla);
  end loop;
  execute format('alter table public.%I enable row level security', p_tabla);
  select string_agg(format('public.fn_tiene_permiso(%L)', perm), ' or ')
    into v_cond from unnest(p_permisos) perm;
  execute format(
    'create policy "gate_rw" on public.%I for all to authenticated '
    || 'using (%s) with check (%s)',
    p_tabla, v_cond, v_cond);
end $$;

-- ███ COSTO de compras — oculto al cajero; visible para compras/conta/config ███
select public.fn__rls_gate_multi('facturas_compra',      array['compras','contabilidad','configuracion']);
select public.fn__rls_gate_multi('items_factura_compra', array['compras','contabilidad','configuracion']);
select public.fn__rls_gate_multi('historial_costos',     array['compras','contabilidad']);
select public.fn__rls_gate_multi('proveedor_producto',   array['compras','pedidos','configuracion']);

-- ███ Config fiscal (CUIT, IVA, IIBB) — solo configuración (lectura y escritura) ███
select public.fn__rls_gate_multi('config_fiscal',        array['configuracion']);

-- ███ Pagos a proveedores — solo finanzas ███
select public.fn__rls_gate_multi('pagos_cuenta',         array['finanzas']);

-- Limpieza del helper temporal
drop function if exists public.fn__rls_gate_multi(text, text[]);

notify pgrst, 'reload schema';
