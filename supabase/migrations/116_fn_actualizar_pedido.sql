-- 116_fn_actualizar_pedido.sql
-- Edición atómica de órdenes de compra (borrador / enviado).
--
-- La edición se hacía en 3 llamadas sueltas desde el cliente (update de la
-- cabecera + delete de items + insert de items). Dos problemas:
--   1. Sin transacción: si la red se cortaba entre el delete y el insert, la
--      orden quedaba SIN items y sin vuelta atrás.
--   2. Sin control de estado en el server: una recepción concurrente
--      (fn_recibir_pedido) podía quedar pisada en silencio.
-- Esta RPC hace todo en UNA transacción, toma un lock sobre la fila y sólo
-- permite editar órdenes que todavía no se recibieron.

create or replace function public.fn_actualizar_pedido(
  p_pedido_id integer,
  p_proveedor_id integer,
  p_fecha_entrega text,
  p_terminos_pago text,
  p_estado text,
  p_items jsonb
) returns public.pedidos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pedido public.pedidos;
  v_total numeric(12, 2) := 0;
  v_item jsonb;
begin
  -- Lock + guarda de estado: sólo se editan órdenes no recibidas.
  select * into v_pedido from public.pedidos where id = p_pedido_id for update;
  if not found then
    raise exception 'El pedido % no existe.', p_pedido_id;
  end if;
  if v_pedido.estado::text not in ('borrador', 'enviado') then
    raise exception 'El pedido % ya no se puede editar (estado: %).',
      p_pedido_id, v_pedido.estado;
  end if;
  if p_estado not in ('borrador', 'enviado') then
    raise exception 'Estado destino inválido: %.', p_estado;
  end if;

  -- Total a partir de los items enviados.
  select coalesce(
           sum((it->>'cantidad_pedida')::integer * (it->>'precio_costo')::numeric),
           0
         )
    into v_total
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as it;

  update public.pedidos
     set proveedor_id = p_proveedor_id,
         fecha_entrega_esperada = nullif(p_fecha_entrega, '')::date,
         terminos_pago = nullif(p_terminos_pago, ''),
         estado = p_estado::public.estado_pedido,
         total = v_total,
         updated_at = now()
   where id = p_pedido_id
   returning * into v_pedido;

  -- Reemplazo total de items. Seguro porque una orden no recibida no tiene
  -- lotes ni cuentas a pagar colgando de sus items.
  delete from public.items_pedido where pedido_id = p_pedido_id;

  for v_item in
    select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    insert into public.items_pedido
      (pedido_id, producto_id, cantidad_pedida, cantidad_recibida, precio_costo, subtotal)
    values (
      p_pedido_id,
      (v_item->>'producto_id')::integer,
      (v_item->>'cantidad_pedida')::integer,
      null,
      (v_item->>'precio_costo')::numeric,
      (v_item->>'cantidad_pedida')::integer * (v_item->>'precio_costo')::numeric
    );
  end loop;

  return v_pedido;
end;
$$;

notify pgrst, 'reload schema';
