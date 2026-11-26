-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 340 · Volver costo y precio a lo anterior a la factura   ║
-- ║  (helper interno de "Eliminar factura", mig 342)                    ║
-- ║                                                                     ║
-- ║  Por cada producto de la factura:                                   ║
-- ║   · Si OTRA compra posterior ya le cambió el costo (otra factura, u ║
-- ║     otra orden en historial_costos), no se toca nada y se informa.  ║
-- ║   · Con foto (mig 337): vuelve el costo, y el costo del catálogo    ║
-- ║     del proveedor. El precio vuelve solo si el vigente es el que    ║
-- ║     dejó ESTA factura (si alguien lo cambió a mano después, se      ║
-- ║     respeta y se re-deduce el margen real).                         ║
-- ║   · Sin foto (facturas anteriores a la 337): el costo sale del      ║
-- ║     primer historial_costos de esta orden; el precio no se toca y   ║
-- ║     se re-deduce el margen.                                         ║
-- ║  En todos los casos queda el PAR COHERENTE (migs 322–324):          ║
-- ║  productos.margen = margen real de (precio vigente, costo).         ║
-- ║                                                                     ║
-- ║  p_aplicar = false → no escribe: devuelve los que no se restauran.  ║
-- ║  Debe correr ANTES de borrar la factura (lee sus renglones).        ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

create or replace function public.fn_int_restaurar_costos_factura(
  p_cuenta_id integer,
  p_factura_id integer,
  p_aplicar boolean
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_fac record;
  v_it record;
  v_foto public.factura_compra_previos;
  v_desde timestamptz;
  v_costo numeric;
  v_restaurados integer := 0;
  v_no jsonb := '[]'::jsonb;
begin
  select id, pedido_id, proveedor_id, created_at into v_fac
    from public.facturas_compra where id = p_factura_id;

  for v_it in
    select ifc.producto_id, max(ifc.precio_con_iva) as precio_factura,
           p.nombre, p.precio_venta, p.iva_venta
      from public.items_factura_compra ifc
      join public.productos p on p.id = ifc.producto_id
     where ifc.factura_id = p_factura_id
     group by ifc.producto_id, p.nombre, p.precio_venta, p.iva_venta
     order by p.nombre
  loop
    v_foto := null;
    select * into v_foto from public.factura_compra_previos f
     where f.producto_id = v_it.producto_id
       and ((p_cuenta_id is not null and f.cuenta_id = p_cuenta_id)
            or (f.cuenta_id is null and f.factura_id = p_factura_id));

    if v_foto.id is not null then
      v_desde := v_foto.created_at;
      v_costo := v_foto.costo;
    else
      -- Sin foto: el costo previo es el del primer cambio que anotó esta orden.
      select h.costo_anterior, h.created_at into v_costo, v_desde
        from public.historial_costos h
       where v_fac.pedido_id is not null and h.pedido_id = v_fac.pedido_id
         and h.producto_id = v_it.producto_id and h.origen = 'factura'
       order by h.id limit 1;
      -- Esta factura no le cambió el costo (o no quedó registro): nada que hacer.
      continue when v_desde is null;
    end if;

    -- ¿Otra compra posterior ya tocó este producto?
    if exists (
         select 1 from public.items_factura_compra i2
           join public.facturas_compra f2 on f2.id = i2.factura_id
          where i2.producto_id = v_it.producto_id and f2.id <> p_factura_id
            and f2.created_at > v_desde
       ) or exists (
         select 1 from public.historial_costos h
          where h.producto_id = v_it.producto_id and h.created_at > v_desde
            and h.pedido_id is not null
            and h.pedido_id is distinct from v_fac.pedido_id
       ) then
      v_no := v_no || jsonb_build_object('producto_id', v_it.producto_id, 'nombre', v_it.nombre);
      continue;
    end if;

    v_restaurados := v_restaurados + 1;
    continue when not p_aplicar;

    if v_costo is not null then
      perform public.fn_set_costo(v_it.producto_id, v_costo);
    end if;

    if v_foto.id is not null then
      if v_foto.costo_proveedor is not null then
        update public.proveedor_producto set costo = v_foto.costo_proveedor, updated_at = now()
          where proveedor_id = v_fac.proveedor_id and producto_id = v_it.producto_id;
      end if;
      -- El precio vuelve solo si sigue siendo el que dejó esta factura.
      if v_it.precio_venta is not distinct from v_it.precio_factura
         or v_it.precio_venta is not distinct from v_foto.precio_venta then
        update public.productos
          set precio_venta = coalesce(v_foto.precio_venta, precio_venta),
              margen = coalesce(v_foto.margen, margen),
              precio_mayorista = v_foto.precio_mayorista,
              margen_mayorista = v_foto.margen_mayorista,
              pendiente_precio = coalesce(v_foto.pendiente_precio, pendiente_precio),
              updated_at = now()
          where id = v_it.producto_id;
        continue;
      end if;
    end if;

    -- Precio intacto: margen real contra el costo restaurado (par coherente).
    if coalesce(v_costo, 0) > 0 then
      update public.productos
        set margen = public.fn_margen_desde_precio(v_costo, precio_venta, iva_venta),
            margen_mayorista = case
              when margen_mayorista is not null and coalesce(precio_mayorista, 0) > 0
                then public.fn_margen_desde_precio(v_costo, precio_mayorista, iva_venta)
              else margen_mayorista end,
            updated_at = now()
        where id = v_it.producto_id and precio_venta > 0;
    end if;
  end loop;

  return jsonb_build_object('restaurados', v_restaurados, 'no_restaurados', v_no);
end;
$$;

revoke all on function public.fn_int_restaurar_costos_factura(integer, integer, boolean)
  from public, anon, authenticated;

notify pgrst, 'reload schema';
