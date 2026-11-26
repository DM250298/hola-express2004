-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 339 · Sacar del stock lo que entró con una factura       ║
-- ║  (helper interno de "Eliminar factura", mig 342)                    ║
-- ║                                                                     ║
-- ║  Decisión del dueño (2026-11-26): eliminar una factura deshace      ║
-- ║  también la recepción, y si la mercadería ya se vendió SE FUERZA    ║
-- ║  IGUAL: el stock queda en negativo para corregir con un ajuste.     ║
-- ║  Por eso no reusa fn_revertir_recepcion (130), que se niega.        ║
-- ║                                                                     ║
-- ║  Cuánto sale por producto:                                          ║
-- ║   · renglones de la orden atados a esta deuda: lo que el stock      ║
-- ║     refleja hoy = pagadas + sin cargo si hay factura, o lo recibido;║
-- ║   · renglones extra de la factura: cantidad_stock_aplicada (166);   ║
-- ║   · compra directa: la cantidad de cada renglón con producto.       ║
-- ║                                                                     ║
-- ║  p_aplicar = false → no escribe: devuelve qué productos quedarían   ║
-- ║  en negativo. Con true además deja los renglones de la orden como   ║
-- ║  "sin recibir", vacía los lotes de esa orden y borra el historial   ║
-- ║  de costos que generó. El estado de la orden lo resuelve la 342.    ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

create or replace function public.fn_int_revertir_stock_factura(
  p_cuenta_id integer,
  p_factura_id integer,
  p_usuario_id uuid,
  p_aplicar boolean
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_pedido_id integer;
  v_directa boolean;
  v_prod record;
  v_stock_ant numeric;
  v_stock_nuevo numeric;
  v_negativos jsonb := '[]'::jsonb;
  v_productos integer := 0;
  v_etiqueta text := case when p_cuenta_id is not null
    then 'cuenta #' || p_cuenta_id else 'compra #' || p_factura_id end;
begin
  select pedido_id, coalesce(es_directa, false) into v_pedido_id, v_directa
    from public.facturas_compra where id = p_factura_id;

  for v_prod in
    select t.producto_id, sum(t.cantidad) as cantidad
      from (
        -- Renglones de la orden recibidos contra esta deuda.
        select ip.producto_id,
               coalesce(ip.cantidad_facturada + coalesce(ip.cantidad_sin_cargo, 0),
                        ip.cantidad_recibida, 0) as cantidad
          from public.items_pedido ip
         where p_cuenta_id is not null and ip.cuenta_a_pagar_id = p_cuenta_id
        union all
        -- Extras (sin renglón de orden) o renglones de una compra directa.
        select ifc.producto_id,
               case when v_directa then ifc.cantidad else ifc.cantidad_stock_aplicada end
          from public.items_factura_compra ifc
         where ifc.factura_id = p_factura_id and ifc.producto_id is not null
      ) t
     group by t.producto_id
    having sum(t.cantidad) <> 0
     order by t.producto_id
  loop
    select stock_actual into v_stock_ant
      from public.productos where id = v_prod.producto_id for update;
    v_stock_ant := coalesce(v_stock_ant, 0);
    v_stock_nuevo := v_stock_ant - v_prod.cantidad;
    v_productos := v_productos + 1;

    if v_stock_nuevo < 0 then
      v_negativos := v_negativos || jsonb_build_object(
        'producto_id', v_prod.producto_id,
        'nombre', (select nombre from public.productos where id = v_prod.producto_id),
        'stock_actual', v_stock_ant,
        'stock_final', v_stock_nuevo
      );
    end if;

    continue when not p_aplicar;

    update public.productos
      set stock_actual = v_stock_nuevo, updated_at = now()
      where id = v_prod.producto_id;

    insert into public.movimientos_stock (
      producto_id, tipo, cantidad, stock_anterior, stock_nuevo,
      referencia_id, usuario_id, nota
    ) values (
      v_prod.producto_id, 'salida'::public.tipo_movimiento, v_prod.cantidad,
      v_stock_ant, v_stock_nuevo, coalesce(p_cuenta_id, p_factura_id), p_usuario_id,
      'Factura eliminada (' || v_etiqueta || '): sale lo que había entrado'
    );

    -- Lotes de esa orden: lo que queda en el lote deja de existir. Los que
    -- nadie tocó se borran; los ya consumidos quedan agotados como rastro.
    if v_pedido_id is not null then
      delete from public.lotes l
        where l.pedido_origen_id = v_pedido_id and l.producto_id = v_prod.producto_id
          and l.estado = 'activo'::public.estado_lote
          and l.cantidad_actual = l.cantidad_inicial
          and not exists (select 1 from public.ordenes_produccion op where op.lote_id = l.id);
      update public.lotes
        set cantidad_actual = 0, estado = 'agotado'::public.estado_lote
        where pedido_origen_id = v_pedido_id and producto_id = v_prod.producto_id
          and estado = 'activo'::public.estado_lote;
    end if;
  end loop;

  if p_aplicar and p_cuenta_id is not null and v_pedido_id is not null then
    -- El historial de costos que dejó esta compra se deshace con ella.
    delete from public.historial_costos h
      where h.pedido_id = v_pedido_id
        and h.producto_id in (select producto_id from public.items_pedido
                               where cuenta_a_pagar_id = p_cuenta_id
                              union
                              select producto_id from public.items_factura_compra
                               where factura_id = p_factura_id and producto_id is not null);

    -- Los renglones vuelven a "sin recibir" y sueltan la deuda.
    update public.items_pedido
      set cantidad_recibida = null,
          cantidad_facturada = null,
          cantidad_sin_cargo = 0,
          subtotal = round(coalesce(cantidad_pedida, 0) * coalesce(precio_costo, 0), 2),
          cuenta_a_pagar_id = null
      where cuenta_a_pagar_id = p_cuenta_id;
  end if;

  return jsonb_build_object('productos', v_productos, 'negativos', v_negativos);
end;
$$;

revoke all on function public.fn_int_revertir_stock_factura(integer, integer, uuid, boolean)
  from public, anon, authenticated;

notify pgrst, 'reload schema';
