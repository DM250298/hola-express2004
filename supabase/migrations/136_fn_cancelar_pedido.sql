-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 136 · fn_cancelar_pedido (borrar una orden de compra)     ║
-- ║  (Renumerada de 134 → 136: el 134 ya lo usaba reactivar_pedido.)     ║
-- ║                                                                     ║
-- ║  "Borrar orden completa" = CANCELAR dejando rastro. La orden NO se   ║
-- ║  elimina de la base: queda en estado 'cancelado' (auditable,         ║
-- ║  reactivable). De forma atómica deshace TODO lo que la orden generó: ║
-- ║   1. Anula cada factura cargada (revierte su ajuste de stock, borra  ║
-- ║      la factura y el asiento) vía fn_anular_factura_compra.          ║
-- ║   2. Revierte la recepción (descuenta stock, borra lotes y deudas    ║
-- ║      provisorias) vía fn_revertir_recepcion → deja la orden en       ║
-- ║      'enviado'.                                                      ║
-- ║   3. Marca la orden 'cancelado'.                                     ║
-- ║                                                                     ║
-- ║  GUARDAS (todo o nada — si algo falla, no cambia nada):             ║
-- ║   · Ninguna deuda del pedido puede tener pagos (anular el pago       ║
-- ║     primero).                                                        ║
-- ║   · fn_revertir_recepcion bloquea si ya se vendió/consumió o dio de  ║
-- ║     baja mercadería de esta orden (el stock quedaría negativo).      ║
-- ║                                                                     ║
-- ║  REQUIERE: migraciones 130 (revertir), 133 (anular factura) y 135    ║
-- ║  (fix del trigger, que restaura recibido→enviado bajo flag).         ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

create or replace function public.fn_cancelar_pedido(
  p_pedido_id integer,
  p_usuario_id uuid
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_estado text;
  v_cuenta record;
begin
  -- Permiso (admin bypassa fn_tiene_permiso).
  if not public.fn_tiene_permiso('compras') then
    raise exception 'No tenés permiso para borrar órdenes de compra.';
  end if;

  -- Traba la orden y valida el estado.
  select estado::text into v_estado
    from public.pedidos where id = p_pedido_id for update;
  if v_estado is null then
    raise exception 'La orden #% no existe.', p_pedido_id;
  end if;
  if v_estado = 'cancelado' then
    raise exception 'La orden #% ya está cancelada.', p_pedido_id;
  end if;

  -- GUARDA: ninguna deuda del pedido puede tener pagos.
  if exists (
    select 1 from public.cuentas_a_pagar c
    where c.pedido_id = p_pedido_id
      and ( coalesce(c.monto_pagado, 0) > 0
            or exists (select 1 from public.pagos_cuenta pg
                       where pg.cuenta_a_pagar_id = c.id) )
  ) then
    raise exception 'No se puede borrar: la orden tiene pagos registrados. Anulá el pago primero.';
  end if;

  -- Si ya recibió: deshacer facturas + recepción (stock/lotes/deuda).
  if v_estado in ('recibido', 'recepcion_parcial') then
    -- 1) Anular cada factura cargada (revierte su delta de stock + asiento y
    --    reabre la deuda como provisoria, para que revertir no se bloquee).
    for v_cuenta in
      select id from public.cuentas_a_pagar
      where pedido_id = p_pedido_id and tiene_factura = true
      order by id
    loop
      perform public.fn_anular_factura_compra(v_cuenta.id, p_usuario_id);
    end loop;

    -- 2) Revertir la recepción: descuenta el stock ingresado, borra lotes y
    --    deudas provisorias, y deja la orden en 'enviado'. Sus guardas frenan
    --    si ya se vendió/consumió mercadería de esta orden.
    perform public.fn_revertir_recepcion(p_pedido_id);
  end if;

  -- 3) Cancelar (borrador/enviado → cancelado; transición válida en el trigger).
  update public.pedidos
    set estado = 'cancelado'::public.estado_pedido, updated_at = now()
    where id = p_pedido_id;

  perform public.fn_auditar(
    p_usuario_id, 'cancelar_pedido', 'pedido', p_pedido_id,
    jsonb_build_object('estado_anterior', v_estado)
  );
end;
$$;

revoke execute on function public.fn_cancelar_pedido(integer, uuid) from public, anon;
grant execute on function public.fn_cancelar_pedido(integer, uuid) to authenticated;

notify pgrst, 'reload schema';
