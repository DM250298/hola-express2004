-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 133 · fn_anular_factura_compra (deshacer factura de orden) ║
-- ║                                                                     ║
-- ║  Hasta ahora el circuito con orden NO tenía cómo ANULAR una factura  ║
-- ║  ya cargada: sólo se podía re-guardar. Con la v12 (mig 132) la       ║
-- ║  factura mueve stock, así que hace falta un "deshacer" limpio para   ║
-- ║  una factura mal cargada.                                            ║
-- ║                                                                     ║
-- ║  Qué hace, de forma atómica:                                        ║
-- ║   1. Revierte el stock que la factura había reconciliado, dejándolo  ║
-- ║      en el valor RECIBIDO (delta = recibida − facturada) + su        ║
-- ║      movimiento y el ajuste de lote.                                 ║
-- ║   2. Limpia cantidad_facturada de los renglones (vuelven a "sólo     ║
-- ║      recibido").                                                     ║
-- ║   3. Borra la factura y sus items (cascade).                        ║
-- ║   4. Reabre la deuda como PROVISORIA con el estimado (recibido ×     ║
-- ║      costo), como estaba tras la recepción.                          ║
-- ║   5. Recalcula pedidos.total y revierte el asiento contable.        ║
-- ║                                                                     ║
-- ║  GUARDA: no se puede anular si la deuda ya tiene pagos (hay que      ║
-- ║  anular el pago primero).                                            ║
-- ║                                                                     ║
-- ║  Nota: NO revierte el costo del producto (fn_set_costo): queda el    ║
-- ║  landed de la factura como último costo conocido (inocuo). Si hubiera ║
-- ║  cierre de período por fecha, agregar acá el guard fn_periodo_cerrado ║
-- ║  igual que en el resto del módulo contable.                          ║
-- ║                                                                     ║
-- ║  REQUIERE: migración 132 corrida (usa fn_ajustar_lote_factura).      ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

create or replace function public.fn_anular_factura_compra(
  p_cuenta_id integer,
  p_usuario_id uuid
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_ahora timestamptz := now();
  v_pedido_id integer;
  v_ip record;
  v_delta numeric;
  v_stock_ant numeric;
  v_stock_nuevo numeric;
  v_estimado numeric;
begin
  -- Permiso (admin bypassa fn_tiene_permiso).
  if not public.fn_tiene_permiso('compras') then
    raise exception 'No tenés permiso para anular facturas de compra.';
  end if;

  -- Traba la cuenta y valida.
  select pedido_id into v_pedido_id
    from public.cuentas_a_pagar where id = p_cuenta_id for update;
  if not found then
    raise exception 'La cuenta a pagar #% no existe.', p_cuenta_id;
  end if;
  if not exists (select 1 from public.facturas_compra where cuenta_id = p_cuenta_id) then
    raise exception 'La cuenta #% no tiene factura cargada.', p_cuenta_id;
  end if;

  -- GUARDA: la deuda no puede tener pagos.
  if coalesce((select monto_pagado from public.cuentas_a_pagar where id = p_cuenta_id), 0) > 0
     or exists (select 1 from public.pagos_cuenta where cuenta_a_pagar_id = p_cuenta_id) then
    raise exception 'No se puede anular: la deuda ya tiene pagos registrados. Anulá el pago primero.';
  end if;

  -- 1+2. Revertir el stock reconciliado por la factura y limpiar el marcador.
  for v_ip in
    select id, producto_id, cantidad_recibida, cantidad_facturada
      from public.items_pedido
      where cuenta_a_pagar_id = p_cuenta_id and cantidad_facturada is not null
      order by id
  loop
    v_delta := coalesce(v_ip.cantidad_recibida, 0) - v_ip.cantidad_facturada;
    if v_delta <> 0 then
      select stock_actual into v_stock_ant
        from public.productos where id = v_ip.producto_id for update;
      v_stock_ant := coalesce(v_stock_ant, 0);
      v_stock_nuevo := v_stock_ant + v_delta;
      update public.productos set stock_actual = v_stock_nuevo, updated_at = v_ahora
        where id = v_ip.producto_id;

      insert into public.movimientos_stock (
        producto_id, tipo, cantidad, stock_anterior, stock_nuevo,
        referencia_id, usuario_id, nota
      ) values (
        v_ip.producto_id,
        (case when v_delta > 0 then 'entrada' else 'salida' end)::public.tipo_movimiento,
        abs(v_delta), v_stock_ant, v_stock_nuevo,
        p_cuenta_id, p_usuario_id,
        'Anulación de factura (cuenta #' || p_cuenta_id || ')'
      );

      perform public.fn_ajustar_lote_factura(v_ip.producto_id, v_pedido_id, v_delta, null);
    end if;

    update public.items_pedido set cantidad_facturada = null where id = v_ip.id;
  end loop;

  -- 3. Borrar la factura y sus items (cascade).
  delete from public.facturas_compra where cuenta_id = p_cuenta_id;

  -- 4. Reabrir la deuda como provisoria con el estimado de la recepción.
  select coalesce(sum(coalesce(cantidad_recibida, 0) * coalesce(precio_costo, 0)), 0)
    into v_estimado
    from public.items_pedido where cuenta_a_pagar_id = p_cuenta_id;
  update public.cuentas_a_pagar
    set provisoria = true, tiene_factura = false, monto = v_estimado,
        numero_factura = null
    where id = p_cuenta_id;

  -- 5. Recalcular pedidos.total (facturas cargadas + provisorias sin factura).
  update public.pedidos
    set total = coalesce((
          select sum(fc.total) from public.facturas_compra fc
          where fc.pedido_id = v_pedido_id
        ), 0)
        + coalesce((
          select sum(cap.monto) from public.cuentas_a_pagar cap
          where cap.pedido_id = v_pedido_id and cap.tiene_factura = false
        ), 0),
        updated_at = v_ahora
    where id = v_pedido_id;

  -- Revertir el asiento contable de la factura.
  delete from public.asientos where origen = 'factura_compra' and referencia_id = p_cuenta_id;

  -- Auditoría (misma infra que anulaciones/arqueos/reversiones).
  perform public.fn_auditar(
    p_usuario_id, 'anular_factura_compra', 'cuenta_a_pagar', p_cuenta_id,
    jsonb_build_object('pedido_id', v_pedido_id, 'estimado_restaurado', v_estimado)
  );
end;
$$;

revoke execute on function public.fn_anular_factura_compra(integer, uuid) from public, anon;
grant execute on function public.fn_anular_factura_compra(integer, uuid) to authenticated;

notify pgrst, 'reload schema';
