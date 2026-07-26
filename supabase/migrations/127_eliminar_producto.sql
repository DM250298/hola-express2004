-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  127 · Eliminar producto (borrado duro con guarda de historial)        ║
-- ║                                                                        ║
-- ║  Regla de negocio: un producto se BORRA solo si no tiene historial     ║
-- ║  operativo. Si tiene ventas, movimientos de stock, lotes, pedidos,     ║
-- ║  facturas, conteos, producción, o es componente de un combo, NO se     ║
-- ║  borra: se DESACTIVA (activo = false) para conservar la trazabilidad.  ║
-- ║                                                                        ║
-- ║  El borrado se apoya en los FK ya definidos hacia productos:           ║
-- ║   · CASCADE  → costos_producto, proveedor_producto, historial_costos,  ║
-- ║               producto_componentes (cabecera), etiquetas_pendientes,   ║
-- ║               recetas   (satélites de cartilla: se van con el producto)║
-- ║   · SET NULL → sugerencias_producto                                    ║
-- ║   · RESTRICT / NO ACTION → items_venta, lotes, movimientos_stock,      ║
-- ║               items_pedido, items_factura_compra, items_devolucion,    ║
-- ║               items_ajuste_stock, conteos_items, conteo_* ,            ║
-- ║               receta_ingredientes, ordenes_produccion, items_orden_prod║
-- ║               , items_pedido_tienda, producto_componentes (componente) ║
-- ║     → cualquiera de estos corta el DELETE con foreign_key_violation.   ║
-- ║                                                                        ║
-- ║  No enumeramos las tablas hijas a mano (frágil ante tablas nuevas):    ║
-- ║  dejamos que los propios FK decidan y capturamos el error.             ║
-- ╚══════════════════════════════════════════════════════════════════════╝

-- Borra el producto, o falla con un marcador claro si tiene historial.
create or replace function public.fn_eliminar_producto(p_id integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- security definer bypassa RLS, así que la guarda de permiso va explícita acá.
  if not (select public.fn_tiene_permiso('configuracion')) then
    raise exception 'No tenés permiso para eliminar productos.'
      using errcode = '42501';
  end if;

  if not exists (select 1 from public.productos where id = p_id) then
    raise exception 'El producto no existe.' using errcode = 'P0002';
  end if;

  -- El DELETE arrastra por CASCADE los satélites de cartilla (costo, catálogo
  -- de proveedores, historial de costos, combo donde es cabecera, etiquetas
  -- pendientes, receta) y pone en NULL las sugerencias. Cualquier historial
  -- operativo tiene FK restrictiva y corta el borrado acá.
  begin
    delete from public.productos where id = p_id;
  exception when foreign_key_violation then
    -- Marcador estable que el frontend detecta para ofrecer "desactivar".
    raise exception 'PRODUCTO_CON_HISTORIAL' using errcode = 'P0001';
  end;
end;
$$;

-- ¿Se puede borrar? "Dry run": intenta el DELETE dentro de un subbloque y
-- SIEMPRE lo revierte (el raise deshace el savepoint implícito del bloque).
-- Así el frontend sabe de antemano si mostrar "Eliminar" o "Desactivar", sin
-- tener que enumerar cada tabla hija: si el FK deja borrar, es eliminable.
create or replace function public.fn_producto_eliminable(p_id integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (select public.fn_tiene_permiso('configuracion')) then
    raise exception 'No tenés permiso.' using errcode = '42501';
  end if;

  if not exists (select 1 from public.productos where id = p_id) then
    return false;
  end if;

  begin
    delete from public.productos where id = p_id;
    -- Si llegó acá el borrado habría funcionado: forzamos el rollback del
    -- subbloque (esto NO deja rastros: revierte también los CASCADE de arriba).
    raise exception 'DRY_RUN_OK';
  exception
    when foreign_key_violation then
      return false;                 -- tiene historial → no se puede borrar
    when others then
      if sqlerrm = 'DRY_RUN_OK' then
        return true;                -- el borrado habría sido válido
      end if;
      raise;                        -- cualquier otro error real se propaga
  end;
end;
$$;

grant execute on function public.fn_eliminar_producto(integer) to authenticated;
grant execute on function public.fn_producto_eliminable(integer) to authenticated;

notify pgrst, 'reload schema';
