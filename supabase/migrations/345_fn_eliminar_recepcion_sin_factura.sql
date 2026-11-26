-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 345 · Eliminar una recepción que todavía no tiene        ║
-- ║  factura (filas "Sin factura" del portal)                           ║
-- ║                                                                     ║
-- ║  La 342 elimina facturas cargadas. Las filas "Sin factura" son una  ║
-- ║  recepción con su deuda estimada: no había forma de borrarlas desde ║
-- ║  el portal, y "Revertir recepción" (130) se niega si la mercadería  ║
-- ║  ya se vendió. Mismo criterio que eligió el dueño para las facturas ║
-- ║  (2026-11-26):                                                      ║
-- ║   · los pagos (si la deuda se pagó sin factura) vuelven a la cuenta ║
-- ║     de origen;                                                      ║
-- ║   · la mercadería sale del stock aunque quede negativo;             ║
-- ║   · los renglones vuelven a "sin recibir", la deuda desaparece y la ║
-- ║     orden vuelve a "Por recibir" (o a recepción parcial si tiene    ║
-- ║     otras entregas).                                                ║
-- ║  El costo no se toca: la recepción no lo cambia (mig 167).          ║
-- ║                                                                     ║
-- ║  Devuelve la misma forma que fn_eliminar_factura_compra, con        ║
-- ║  p_previsualizar para la confirmación en pantalla. Permiso          ║
-- ║  `finanzas`; rechaza si tiene pagos en un mes cerrado.              ║
-- ║                                                                     ║
-- ║  REQUIERE 338, 341 y 344. Ejecutar UNA sola vez, COMPLETO.          ║
-- ╚════════════════════════════════════════════════════════════════════╝

create or replace function public.fn_eliminar_recepcion_sin_factura(
  p_cuenta_id integer,
  p_previsualizar boolean default false
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_usuario uuid := auth.uid();
  v_aplicar boolean := not coalesce(p_previsualizar, false);
  v_cuenta record;
  v_bloqueo text;
  v_pagos jsonb;
  v_stock jsonb;
  v_estado text;
  v_quedan boolean;
  v_res jsonb;
begin
  if not (select public.fn_tiene_permiso('finanzas')) then
    raise exception 'No tenés permiso para eliminar recepciones.';
  end if;

  select id, pedido_id, proveedor_id, monto, coalesce(monto_pagado, 0) as pagado
    into v_cuenta
    from public.cuentas_a_pagar where id = p_cuenta_id for update;
  if v_cuenta.id is null then
    raise exception 'La deuda #% no existe.', p_cuenta_id;
  end if;
  if exists (select 1 from public.facturas_compra where cuenta_id = p_cuenta_id) then
    raise exception 'Esta deuda ya tiene la factura cargada: eliminá la factura.';
  end if;
  if v_cuenta.pedido_id is null then
    raise exception 'Esta deuda no viene de una recepción.';
  end if;

  -- ── Guardas ─────────────────────────────────────────────────────────
  if exists (select 1 from public.pagos_cuenta
              where cuenta_a_pagar_id = p_cuenta_id and public.fn_periodo_cerrado(fecha)) then
    v_bloqueo := 'Esta recepción tiene pagos en un mes cerrado en Contabilidad. Reabrí el período para poder eliminarla.';
  elsif v_cuenta.pagado > 0 and not exists (
      select 1 from public.pagos_cuenta where cuenta_a_pagar_id = p_cuenta_id) then
    v_bloqueo := 'Esta deuda tiene pagos viejos sin detalle y no se pueden revertir solos. Avisá a soporte.';
  end if;
  if v_bloqueo is not null then
    if v_aplicar then raise exception '%', v_bloqueo; end if;
    return jsonb_build_object('bloqueo', v_bloqueo);
  end if;

  -- ── Pagos y stock (los helpers no escriben si es previsualización) ───
  v_pagos := public.fn_int_revertir_pagos_cuenta(p_cuenta_id, v_usuario, v_aplicar);
  v_stock := public.fn_int_revertir_stock_factura(p_cuenta_id, null, v_usuario, v_aplicar);

  v_res := jsonb_build_object(
    'factura_id', null, 'cuenta_id', p_cuenta_id, 'pedido_id', v_cuenta.pedido_id,
    'total', v_cuenta.monto,
    'pagos_revertidos', v_pagos,
    'productos_stock', v_stock->'productos',
    'productos_negativos', v_stock->'negativos',
    'costos_restaurados', 0,
    'costos_no_restaurados', '[]'::jsonb,
    'recepcion_revertida', true,
    'sin_factura', true
  );
  if not v_aplicar then
    return v_res;
  end if;

  delete from public.cuentas_a_pagar where id = p_cuenta_id;

  -- La orden vuelve a esperar la mercadería.
  select estado::text into v_estado from public.pedidos where id = v_cuenta.pedido_id for update;
  v_quedan := exists (select 1 from public.items_pedido
                       where pedido_id = v_cuenta.pedido_id and cantidad_recibida is not null);
  perform set_config('hola.revertir_recepcion', 'on', true);
  update public.pedidos
    set estado = (case
          when v_estado not in ('recibido', 'recepcion_parcial') then v_estado
          when v_quedan then 'recepcion_parcial' else 'enviado' end)::public.estado_pedido,
        total = case when v_quedan then
            coalesce((select sum(fc.total) from public.facturas_compra fc
                       where fc.pedido_id = v_cuenta.pedido_id), 0)
          + coalesce((select sum(cap.monto) from public.cuentas_a_pagar cap
                       where cap.pedido_id = v_cuenta.pedido_id and cap.tiene_factura = false), 0)
          else coalesce((select sum(coalesce(cantidad_pedida, 0) * coalesce(precio_costo, 0))
                           from public.items_pedido where pedido_id = v_cuenta.pedido_id), 0) end,
        updated_at = now()
    where id = v_cuenta.pedido_id;
  perform set_config('hola.revertir_recepcion', 'off', true);

  perform public.fn_auditar(
    v_usuario, 'eliminar_recepcion', 'cuenta_a_pagar', p_cuenta_id,
    v_res || jsonb_build_object('proveedor_id', v_cuenta.proveedor_id)
  );

  return v_res;
end;
$$;

revoke all on function public.fn_eliminar_recepcion_sin_factura(integer, boolean) from public, anon;
grant execute on function public.fn_eliminar_recepcion_sin_factura(integer, boolean) to authenticated;

notify pgrst, 'reload schema';
