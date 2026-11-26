-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 342 · Eliminar una factura de proveedor                  ║
-- ║                                                                     ║
-- ║  "Eliminar" deshace TODO lo que la factura generó, de forma atómica ║
-- ║  (decisiones del dueño, 2026-11-26):                                ║
-- ║   1. Los pagos: la plata vuelve a la cuenta de origen (mig 338).    ║
-- ║   2. Costo y precio de los productos (mig 340).                     ║
-- ║   3. La mercadería: sale del stock aunque quede negativo (mig 339). ║
-- ║   4. La recepción: los renglones vuelven a "sin recibir" y la orden ║
-- ║      a "Por recibir" (o a recepción parcial si tiene otras          ║
-- ║      facturas).                                                     ║
-- ║   5. La deuda, la factura, sus cuotas, pagos agendados y asientos.  ║
-- ║  Queda registro en auditoría con el detalle de lo revertido.        ║
-- ║                                                                     ║
-- ║  Sirve para facturas con orden (p_cuenta_id) y para compras         ║
-- ║  directas (p_factura_id). p_previsualizar = true no escribe nada:   ║
-- ║  devuelve lo que pasaría, para la confirmación en pantalla.         ║
-- ║                                                                     ║
-- ║  Guardas: permiso `finanzas`; período contable cerrado (de la       ║
-- ║  factura o de alguno de sus pagos) → no se puede.                   ║
-- ║                                                                     ║
-- ║  REQUIERE 337–341. fn_anular_factura_compra y fn_cancelar_pedido    ║
-- ║  no cambian. Ejecutar UNA sola vez, COMPLETO.                       ║
-- ╚════════════════════════════════════════════════════════════════════╝

create or replace function public.fn_eliminar_factura_compra(
  p_cuenta_id integer default null,
  p_factura_id integer default null,
  p_previsualizar boolean default false
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_usuario uuid := auth.uid();
  v_aplicar boolean := not coalesce(p_previsualizar, false);
  v_fac public.facturas_compra;
  v_cuenta_id integer := p_cuenta_id;
  v_pagado numeric := 0;
  v_bloqueo text;
  v_pagos jsonb := '[]'::jsonb;
  v_costos jsonb;
  v_stock jsonb;
  v_mov record;
  v_saldo numeric;
  v_estado text;
  v_quedan boolean;
  v_recepcion boolean := false;
  v_res jsonb;
begin
  if not (select public.fn_tiene_permiso('finanzas')) then
    raise exception 'No tenés permiso para eliminar facturas de proveedores.';
  end if;

  if v_cuenta_id is not null then
    select * into v_fac from public.facturas_compra where cuenta_id = v_cuenta_id;
  else
    select * into v_fac from public.facturas_compra where id = p_factura_id;
    v_cuenta_id := v_fac.cuenta_id;
  end if;
  if v_fac.id is null then
    raise exception 'No hay una factura cargada para eliminar.';
  end if;

  if v_cuenta_id is not null then
    select coalesce(monto_pagado, 0) into v_pagado
      from public.cuentas_a_pagar where id = v_cuenta_id for update;
  end if;

  -- ── Guardas ─────────────────────────────────────────────────────────
  if public.fn_periodo_cerrado(v_fac.fecha) then
    v_bloqueo := 'El mes de esta factura está cerrado en Contabilidad. Reabrí el período para poder eliminarla.';
  elsif v_cuenta_id is not null and exists (
      select 1 from public.pagos_cuenta
       where cuenta_a_pagar_id = v_cuenta_id and public.fn_periodo_cerrado(fecha)) then
    v_bloqueo := 'Esta factura tiene pagos en un mes cerrado en Contabilidad. Reabrí el período para poder eliminarla.';
  elsif v_pagado > 0 and not exists (
      select 1 from public.pagos_cuenta where cuenta_a_pagar_id = v_cuenta_id) then
    v_bloqueo := 'Esta deuda tiene pagos viejos sin detalle y no se pueden revertir solos. Avisá a soporte.';
  end if;
  if v_bloqueo is not null then
    if v_aplicar then raise exception '%', v_bloqueo; end if;
    return jsonb_build_object('bloqueo', v_bloqueo);
  end if;

  -- ── 1. Pagos de la deuda ────────────────────────────────────────────
  if v_cuenta_id is not null then
    v_pagos := public.fn_int_revertir_pagos_cuenta(v_cuenta_id, v_usuario, v_aplicar);
  end if;
  -- Pago al contado de una compra directa (su egreso propio, mig 121).
  if v_fac.egreso_id is not null then
    for v_mov in
      select m.cuenta_id, m.monto, c.nombre
        from public.movimientos_cuenta m join public.cuentas c on c.id = m.cuenta_id
       where m.referencia_tipo = 'egreso' and m.referencia_id = v_fac.egreso_id and m.tipo = 'egreso'
    loop
      v_pagos := v_pagos || jsonb_build_object(
        'monto', v_mov.monto, 'fecha', v_fac.fecha, 'cuenta', v_mov.nombre, 'forma_pago', null);
      continue when not v_aplicar;
      select saldo_actual into v_saldo from public.cuentas where id = v_mov.cuenta_id for update;
      insert into public.movimientos_cuenta (
        cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo,
        descripcion, categoria, referencia_tipo, referencia_id, usuario_id, fecha
      ) values (
        v_mov.cuenta_id, 'ingreso', v_mov.monto, coalesce(v_saldo, 0), coalesce(v_saldo, 0) + v_mov.monto,
        'Compra directa #' || v_fac.id || ' eliminada', 'compra_mercaderia', 'egreso', v_fac.egreso_id,
        v_usuario, (now() at time zone 'America/Argentina/La_Rioja')::date
      );
      update public.cuentas set saldo_actual = coalesce(v_saldo, 0) + v_mov.monto, updated_at = now()
        where id = v_mov.cuenta_id;
    end loop;
    if v_aplicar then
      delete from public.asientos where origen = 'egreso' and referencia_id = v_fac.egreso_id;
      update public.facturas_compra set egreso_id = null where id = v_fac.id;
      delete from public.egresos where id = v_fac.egreso_id;
    end if;
  end if;

  -- ── 2. Costo y precio · 3. Stock y recepción ────────────────────────
  v_costos := public.fn_int_restaurar_costos_factura(v_cuenta_id, v_fac.id, v_aplicar);
  v_stock := public.fn_int_revertir_stock_factura(v_cuenta_id, v_fac.id, v_usuario, v_aplicar);
  v_recepcion := v_fac.pedido_id is not null and not coalesce(v_fac.es_directa, false);

  v_res := jsonb_build_object(
    'factura_id', v_fac.id, 'cuenta_id', v_cuenta_id, 'pedido_id', v_fac.pedido_id,
    'total', v_fac.total,
    'pagos_revertidos', v_pagos,
    'productos_stock', v_stock->'productos',
    'productos_negativos', v_stock->'negativos',
    'costos_restaurados', v_costos->'restaurados',
    'costos_no_restaurados', v_costos->'no_restaurados',
    'recepcion_revertida', v_recepcion
  );
  if not v_aplicar then
    return v_res;
  end if;

  -- ── 4. Asientos, deuda y factura ────────────────────────────────────
  delete from public.asientos
    where (origen = 'factura_compra' and referencia_id = v_cuenta_id)
       or (origen = 'compra_directa' and referencia_id = v_fac.id);
  if v_cuenta_id is not null then
    delete from public.cuentas_a_pagar where id = v_cuenta_id;  -- cascade: factura, ítems, cuotas
  end if;
  delete from public.facturas_compra where id = v_fac.id;

  -- ── 5. La orden vuelve a esperar la mercadería ──────────────────────
  if v_recepcion then
    select estado::text into v_estado from public.pedidos where id = v_fac.pedido_id for update;
    v_quedan := exists (select 1 from public.items_pedido
                         where pedido_id = v_fac.pedido_id and cantidad_recibida is not null);
    perform set_config('hola.revertir_recepcion', 'on', true);
    update public.pedidos
      set estado = (case
            when v_estado not in ('recibido', 'recepcion_parcial') then v_estado
            when v_quedan then 'recepcion_parcial' else 'enviado' end)::public.estado_pedido,
          total = case when v_quedan then
              coalesce((select sum(fc.total) from public.facturas_compra fc
                         where fc.pedido_id = v_fac.pedido_id), 0)
            + coalesce((select sum(cap.monto) from public.cuentas_a_pagar cap
                         where cap.pedido_id = v_fac.pedido_id and cap.tiene_factura = false), 0)
            else coalesce((select sum(coalesce(cantidad_pedida, 0) * coalesce(precio_costo, 0))
                             from public.items_pedido where pedido_id = v_fac.pedido_id), 0) end,
          updated_at = now()
      where id = v_fac.pedido_id;
    perform set_config('hola.revertir_recepcion', 'off', true);
  end if;

  perform public.fn_auditar(
    v_usuario, 'eliminar_factura_compra', 'factura_compra', v_fac.id,
    v_res || jsonb_build_object(
      'proveedor_id', v_fac.proveedor_id, 'fecha', v_fac.fecha,
      'comprobante', concat_ws('-', v_fac.tipo_comprobante, v_fac.punto_venta, v_fac.numero_comprobante))
  );

  return v_res;
end;
$$;

revoke all on function public.fn_eliminar_factura_compra(integer, integer, boolean) from public, anon;
grant execute on function public.fn_eliminar_factura_compra(integer, integer, boolean) to authenticated;

notify pgrst, 'reload schema';
