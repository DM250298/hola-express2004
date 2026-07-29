-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 130 · Revertir recepción (volver a "Por recibir")         ║
-- ║                                                                     ║
-- ║  Necesidad: un pedido recibido por error (o mal cargado) debe poder ║
-- ║  volver a "enviado" (Por recibir) para recibirlo de nuevo.          ║
-- ║                                                                     ║
-- ║  Revertir NO es un simple cambio de estado: la recepción sumó       ║
-- ║  stock, dejó movimientos, creó lotes, registró historial de costos  ║
-- ║  y abrió deudas provisorias. `fn_revertir_recepcion` deshace TODO    ║
-- ║  eso de forma atómica, y se NIEGA a hacerlo si la mercadería ya se   ║
-- ║  movió o la deuda ya está comprometida:                             ║
-- ║   · GUARDA 1 — la deuda del pedido tiene factura cargada o pagos.   ║
-- ║   · GUARDA 2 — algún lote se consumió (venta/FEFO) o se dio de baja. ║
-- ║   · GUARDA 3 — el stock actual ya no alcanza lo recibido (se vendió  ║
-- ║     algo sin lote), quedaría negativo.                              ║
-- ║                                                                     ║
-- ║  El trigger de transiciones (mig 061) bloquea recibido→enviado por  ║
-- ║  diseño. Se habilita esa transición SÓLO dentro de esta función,    ║
-- ║  vía un flag transaccional (set_config local), para que un update   ║
-- ║  suelto del cliente nunca saltee la lógica de reversión.            ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────────────────────
-- 1) Trigger de transiciones: permitir la reversión sólo bajo el flag
--    transaccional `hola.revertir_recepcion = 'on'` que setea el RPC.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_validar_transicion_pedido()
returns trigger language plpgsql as $$
declare
  v_revirtiendo boolean :=
    coalesce(current_setting('hola.revertir_recepcion', true), 'off') = 'on';
begin
  if new.estado is distinct from old.estado then
    if not (
      (old.estado = 'borrador'          and new.estado in ('enviado', 'cancelado')) or
      (old.estado = 'enviado'           and new.estado in ('recibido', 'recepcion_parcial', 'cancelado')) or
      (old.estado = 'recepcion_parcial' and new.estado = 'recibido') or
      -- Reversión de recepción: sólo válida desde fn_revertir_recepcion,
      -- que prende el flag transaccional antes del update.
      (v_revirtiendo and old.estado in ('recibido', 'recepcion_parcial') and new.estado = 'enviado')
    ) then
      raise exception 'Transición de estado de pedido inválida: % → %', old.estado, new.estado;
    end if;
  end if;
  return new;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 2) fn_revertir_recepcion — deshace la recepción y vuelve a "enviado".
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_revertir_recepcion(
  p_pedido_id integer
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_ahora timestamptz := now();
  v_usuario uuid := auth.uid();
  v_estado_actual text;
  v_item record;
  v_stock_ant numeric;
  v_stock_nuevo numeric;
  v_total_orden numeric := 0;
  v_items_revertidos integer := 0;
begin
  -- Permiso: mismo dominio que recibir.
  if not public.fn_tiene_permiso('recepcion') then
    raise exception 'No tenés permiso para revertir recepciones.';
  end if;

  -- Traba la fila del pedido y valida el estado.
  select estado::text into v_estado_actual
    from public.pedidos where id = p_pedido_id for update;
  if v_estado_actual is null then
    raise exception 'El pedido #% no existe.', p_pedido_id;
  end if;
  if v_estado_actual not in ('recibido', 'recepcion_parcial') then
    raise exception 'Sólo se puede revertir un pedido recibido (estado actual: %).', v_estado_actual;
  end if;

  -- GUARDA 1: la deuda no puede tener factura cargada ni pagos.
  if exists (
    select 1 from public.cuentas_a_pagar c
    where c.pedido_id = p_pedido_id
      and ( c.tiene_factura = true
            or coalesce(c.monto_pagado, 0) > 0
            or exists (select 1 from public.pagos_cuenta pg
                       where pg.cuenta_a_pagar_id = c.id) )
  ) then
    raise exception 'No se puede revertir: la deuda de este pedido ya tiene factura cargada o pagos registrados. Anulá la factura o el pago primero.';
  end if;

  -- GUARDA 2: ningún lote de este pedido puede estar consumido o dado de baja.
  if exists (
    select 1 from public.lotes
    where pedido_origen_id = p_pedido_id
      and (cantidad_actual is distinct from cantidad_inicial
           or estado <> 'activo'::public.estado_lote)
  ) then
    raise exception 'No se puede revertir: ya se vendió o dio de baja mercadería con vencimiento de este pedido.';
  end if;

  -- GUARDA 3: el stock actual debe alcanzar para descontar lo recibido
  -- (si se vendió algo sin lote, quedaría negativo → se bloquea).
  if exists (
    select 1
    from (
      select ip.producto_id, sum(coalesce(ip.cantidad_recibida, 0)) as rev
      from public.items_pedido ip
      where ip.pedido_id = p_pedido_id
      group by ip.producto_id
    ) g
    join public.productos p on p.id = g.producto_id
    where g.rev > 0 and p.stock_actual < g.rev
  ) then
    raise exception 'No se puede revertir: el stock actual de algún producto es menor a lo recibido (ya se movió mercadería). Ajustá el stock manualmente.';
  end if;

  -- ── Reversa cada renglón: descuenta stock, deja movimiento y limpia el item.
  for v_item in
    select id, producto_id, cantidad_pedida, precio_costo,
           coalesce(cantidad_recibida, 0) as recibida
    from public.items_pedido
    where pedido_id = p_pedido_id
    order by id
  loop
    v_total_orden := v_total_orden + v_item.cantidad_pedida * v_item.precio_costo;

    if v_item.recibida > 0 then
      select stock_actual into v_stock_ant
        from public.productos where id = v_item.producto_id for update;
      v_stock_ant := coalesce(v_stock_ant, 0);
      v_stock_nuevo := v_stock_ant - v_item.recibida;
      update public.productos
        set stock_actual = v_stock_nuevo, updated_at = v_ahora
        where id = v_item.producto_id;

      insert into public.movimientos_stock (
        producto_id, tipo, cantidad, stock_anterior, stock_nuevo,
        referencia_id, usuario_id, nota
      ) values (
        v_item.producto_id, 'salida'::public.tipo_movimiento, v_item.recibida,
        v_stock_ant, v_stock_nuevo, p_pedido_id, v_usuario,
        'Reversión de recepción del pedido #' || p_pedido_id
      );

      v_items_revertidos := v_items_revertidos + 1;
    end if;

    -- El renglón vuelve a "sin recibir" (subtotal = lo pedido).
    update public.items_pedido
      set cantidad_recibida = null,
          subtotal = v_item.cantidad_pedida * v_item.precio_costo,
          cuenta_a_pagar_id = null
      where id = v_item.id;
  end loop;

  -- Borra los lotes creados por esta recepción (están intactos, ver GUARDA 2).
  delete from public.lotes where pedido_origen_id = p_pedido_id;

  -- Borra el historial de costos que generó esta recepción (se deshace).
  delete from public.historial_costos
    where pedido_id = p_pedido_id and origen = 'recepcion';

  -- Borra las deudas provisorias del pedido (sin factura ni pagos, ver GUARDA 1).
  -- Los items ya soltaron su cuenta_a_pagar_id arriba, así que no hay FK colgando.
  delete from public.cuentas_a_pagar
    where pedido_id = p_pedido_id and tiene_factura = false;

  -- Vuelve el pedido a "enviado" (Por recibir). Habilita la transición
  -- (bloqueada por defecto) sólo dentro de esta transacción.
  perform set_config('hola.revertir_recepcion', 'on', true);
  update public.pedidos
    set estado = 'enviado'::public.estado_pedido,
        total = v_total_orden,
        updated_at = v_ahora
    where id = p_pedido_id;
  perform set_config('hola.revertir_recepcion', 'off', true);

  -- Auditoría (misma infra que anulaciones/arqueos/cierres).
  perform public.fn_auditar(
    v_usuario, 'revertir_recepcion', 'pedido', p_pedido_id,
    jsonb_build_object(
      'estado_anterior', v_estado_actual,
      'items_revertidos', v_items_revertidos,
      'total_restaurado', v_total_orden
    )
  );

  return jsonb_build_object(
    'pedido_id', p_pedido_id,
    'estado', 'enviado',
    'items_revertidos', v_items_revertidos
  );
end;
$$;

grant execute on function public.fn_revertir_recepcion(integer) to authenticated;

notify pgrst, 'reload schema';
