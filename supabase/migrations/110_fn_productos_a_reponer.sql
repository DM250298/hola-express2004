-- ─────────────────────────────────────────────────────────────────────
-- 110: Reposición — filtro "stock bajo mínimo" en el servidor.
--
-- La pestaña Reposición de /compras bajaba el catálogo ENTERO (3.000+
-- filas con embed de costos) para comparar stock_actual < stock_minimo
-- en el cliente, porque PostgREST no permite comparar columna contra
-- columna. Esta RPC hace el filtro en la base y devuelve solo lo que
-- falta reponer.
--
-- Costo: NO usa fn_costo (la 099 le revocó EXECUTE a authenticated);
-- lee costos_producto directo y lo gatea con fn_tiene_permiso('costos'),
-- misma semántica que el embed + costoDesdeEmbed del cliente (sin
-- permiso → 0). security definer: bypasea RLS, por eso el gate interno.
-- ─────────────────────────────────────────────────────────────────────

drop function if exists public.fn_productos_a_reponer(integer);

create function public.fn_productos_a_reponer(p_proveedor_id integer default null)
returns table (
  id integer,
  nombre text,
  codigo_barras text,
  precio_costo numeric,
  stock_actual numeric,
  stock_minimo integer,
  proveedor_id integer,
  proveedor_nombre text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.nombre::text,
    p.codigo_barras::text,
    case
      when (select public.fn_tiene_permiso('costos'))
        then coalesce(c.precio_costo, 0)
      else 0
    end as precio_costo,
    p.stock_actual,
    p.stock_minimo,
    p.proveedor_id,
    pr.nombre::text as proveedor_nombre
  from public.productos p
  left join public.costos_producto c on c.producto_id = p.id
  left join public.proveedores pr on pr.id = p.proveedor_id
  where p.activo
    and p.stock_actual < p.stock_minimo
    and (p_proveedor_id is null or p.proveedor_id = p_proveedor_id)
  order by lower(p.nombre)
$$;

revoke execute on function public.fn_productos_a_reponer(integer) from public, anon;
grant execute on function public.fn_productos_a_reponer(integer) to authenticated;

notify pgrst, 'reload schema';
