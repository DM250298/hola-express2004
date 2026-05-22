-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 016 · FASE 0 — Operación atómica: recibir pedido         ║
-- ║                                                                     ║
-- ║  Registra la recepción de un pedido: cantidades recibidas, stock,   ║
-- ║  movimientos, lotes, estado del pedido y la cuenta a pagar — todo   ║
-- ║  en una única transacción.                                          ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

create or replace function public.fn_recibir_pedido(
  p_pedido_id integer,
  p_proveedor_id integer,
  p_usuario_id uuid,
  p_condicion_pago_dias integer,
  p_items jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ahora timestamptz := now();
  v_total numeric := 0;
  v_item jsonb;
  v_item_id integer;
  v_prod_id integer;
  v_cant integer;
  v_precio numeric;
  v_venc date;
  v_subtotal numeric;
  v_stock_ant integer;
  v_stock_nuevo integer;
  v_cuenta_id integer;
begin
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_item_id := (v_item->>'item_id')::integer;
    v_prod_id := (v_item->>'producto_id')::integer;
    v_cant := (v_item->>'cantidad_recibida')::integer;
    v_precio := (v_item->>'precio_costo')::numeric;
    v_venc := nullif(v_item->>'fecha_vencimiento', '')::date;
    v_subtotal := v_cant * v_precio;

    -- Cantidad recibida en el item del pedido
    update public.items_pedido
      set cantidad_recibida = v_cant, subtotal = v_subtotal
      where id = v_item_id;

    if v_cant <= 0 then
      continue;
    end if;

    v_total := v_total + v_subtotal;

    -- Stock del producto
    select stock_actual into v_stock_ant
      from public.productos where id = v_prod_id for update;
    v_stock_ant := coalesce(v_stock_ant, 0);
    v_stock_nuevo := v_stock_ant + v_cant;
    update public.productos
      set stock_actual = v_stock_nuevo, updated_at = v_ahora
      where id = v_prod_id;

    insert into public.movimientos_stock (
      producto_id, tipo, cantidad, stock_anterior, stock_nuevo,
      referencia_id, usuario_id, nota
    ) values (
      v_prod_id, 'entrada', v_cant, v_stock_ant, v_stock_nuevo,
      p_pedido_id, p_usuario_id, 'Recepción de pedido #' || p_pedido_id
    );

    -- Lote si vino con vencimiento
    if v_venc is not null then
      insert into public.lotes (
        producto_id, fecha_vencimiento, cantidad_inicial,
        cantidad_actual, estado, pedido_origen_id
      ) values (
        v_prod_id, v_venc, v_cant, v_cant, 'activo', p_pedido_id
      );
    end if;
  end loop;

  -- Estado y total del pedido
  update public.pedidos
    set estado = 'recibido', total = v_total, updated_at = v_ahora
    where id = p_pedido_id;

  -- Cuenta a pagar al proveedor
  insert into public.cuentas_a_pagar (
    pedido_id, proveedor_id, monto, fecha_vencimiento, estado
  ) values (
    p_pedido_id, p_proveedor_id, v_total,
    current_date + p_condicion_pago_dias, 'pendiente'
  )
  returning id into v_cuenta_id;

  return jsonb_build_object(
    'cuenta_a_pagar_id', v_cuenta_id,
    'total_recibido', v_total
  );
end;
$$;

notify pgrst, 'reload schema';
