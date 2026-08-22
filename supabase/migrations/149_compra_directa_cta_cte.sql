-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 149 · Compra directa "a cuenta corriente" (+ cuotas)     ║
-- ║                                                                     ║
-- ║  Hasta ahora la compra directa se pagaba SIEMPRE en el acto (mig    ║
-- ║  122). Ahora el pago puede ser total, PARCIAL o NULO: lo que no se  ║
-- ║  paga queda como deuda al proveedor en cuentas_a_pagar, con         ║
-- ║  vencimiento único o dividida en cuotas (mig 148).                  ║
-- ║                                                                     ║
-- ║  ⚠ CONVENCIÓN: para una compra directa, cuentas_a_pagar.monto es    ║
-- ║  el SALDO IMPAGO, no el total de la factura. Así:                   ║
-- ║   · no se duplica el egreso (lo pagado en el acto ya salió por su   ║
-- ║     propio egreso; fn_pagar_cuenta después solo paga el saldo);     ║
-- ║   · el camino POS no se rompe (fn_pagar_cuenta exige una cuenta de  ║
-- ║     origen y no sabe pagar desde el efectivo del turno);            ║
-- ║   · Σcuotas = monto cierra exacto con la validación de la 148.      ║
-- ║                                                                     ║
-- ║  Asiento: el Haber se PARTE — caja/banco por lo pagado + 2.1.01     ║
-- ║  Proveedores por el saldo. Σdebe = total = pagado + saldo = Σhaber. ║
-- ║                                                                     ║
-- ║  Permisos: registrar compras sigue gateado por 'compras'; DEJAR     ║
-- ║  SALDO exige además 'finanzas' (un cajero puro compra al contado    ║
-- ║  pero no genera deuda).                                             ║
-- ║                                                                     ║
-- ║  Anulación: bloqueada si la deuda ya tiene pagos; sin pagos, borrar ║
-- ║  la cuenta se lleva por cascade la factura + items (mig 012), las   ║
-- ║  cuotas (mig 148) y los programados (mig 146).                      ║
-- ║                                                                     ║
-- ║  Se emiten:                                                         ║
-- ║   · fn_registrar_compra_directa v2 (LA FIRMA CAMBIA: 9 → 11 args;   ║
-- ║     drop de la de 9 args primero. p_pago suma origen 'ninguno' y    ║
-- ║     monto opcional — sin monto paga el total, como siempre)         ║
-- ║   · fn_anular_compra_directa v2 (misma firma → REPLACE limpio)      ║
-- ║                                                                     ║
-- ║  REQUIERE: migración 148 corrida (fn_definir_cuotas_cuenta).        ║
-- ║  Correr ANTES de deployar el frontend.                              ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

drop function if exists public.fn_registrar_compra_directa(
  uuid, integer, date, jsonb, jsonb, jsonb, boolean, boolean, jsonb);

create or replace function public.fn_registrar_compra_directa(
  p_usuario_id uuid,
  p_proveedor_id integer,
  p_fecha date,
  p_fiscal jsonb,
  p_lineas jsonb,
  p_gasto jsonb,
  p_mueve_stock boolean,
  p_afecta_precio_venta boolean,
  p_pago jsonb,
  p_cta_cte jsonb default null,  -- { fecha_vencimiento, nota? } del saldo a cuenta corriente
  p_cuotas jsonb default null    -- [ { monto, fecha_vencimiento }, ... ] (mig 148)
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_ahora timestamptz := now();
  v_fecha date := coalesce(p_fecha, current_date);
  v_tipo text := nullif(btrim(p_fiscal->>'tipo_comprobante'), '');
  v_punto text := nullif(btrim(p_fiscal->>'punto_venta'), '');
  v_numero text := nullif(btrim(p_fiscal->>'numero_comprobante'), '');
  v_cuit text := nullif(btrim(p_fiscal->>'cuit'), '');
  v_neto numeric := coalesce((p_fiscal->>'neto')::numeric, 0);
  v_iva numeric := coalesce((p_fiscal->>'iva_total')::numeric, 0);
  v_perc_iva numeric := coalesce((p_fiscal->>'perc_iva')::numeric, 0);
  v_perc_iibb numeric := coalesce((p_fiscal->>'perc_iibb')::numeric, 0);
  v_perc_otros numeric := coalesce((p_fiscal->>'perc_otros')::numeric, 0);
  v_gastos numeric := coalesce((p_fiscal->>'gastos')::numeric, 0);
  v_total numeric;
  v_factura_id integer;
  v_origen text := coalesce(p_pago->>'origen', 'ninguno');
  v_turno_id integer := nullif(p_pago->>'turno_id', '')::integer;
  v_cuenta_id integer := nullif(p_pago->>'cuenta_id', '')::integer;
  -- v2: pago parcial/nulo + saldo a cuenta corriente
  v_pagado numeric;
  v_saldo numeric;
  v_hay_cuotas boolean := p_cuotas is not null and jsonb_typeof(p_cuotas) = 'array'
                          and jsonb_array_length(p_cuotas) > 0;
  v_venc_cc date;
  v_cuenta_pagar_id integer;
  v_cta_prov integer;
  v_categoria text;
  v_egreso_id integer;
  v_tipo_cuenta text;
  v_es_boveda boolean;
  v_saldo_cta numeric;
  v_saldo_cta_nuevo numeric;
  v_linea jsonb;
  v_prod_id integer;
  v_cant numeric;
  v_costo_sin_iva numeric;
  v_desc numeric;
  v_iva_compra numeric;
  v_margen numeric;
  v_iva_venta numeric;
  v_costo_neto numeric;
  v_costo_con_iva numeric;
  v_precio_con_iva numeric;
  v_precio_sin_iva numeric;
  v_stock_ant numeric;
  v_stock_nuevo numeric;
  v_asiento_id integer;
  v_orden integer := 0;
  v_cta_debe integer;
  v_cta_iva_cred integer;
  v_cta_haber integer;
  v_cta_perc_iva integer;
  v_cta_perc_iibb integer;
  v_cta_perc_otros integer;
begin
  if not (select public.fn_tiene_permiso('compras')) then
    raise exception 'No tenés permiso para registrar compras.';
  end if;
  if public.fn_periodo_cerrado(v_fecha) then
    raise exception 'El período de esa compra está cerrado.';
  end if;

  v_total := round(v_neto + v_gastos + v_iva + v_perc_iva + v_perc_iibb + v_perc_otros, 2);
  if v_total <= 0 then
    raise exception 'El total de la compra debe ser mayor a 0.';
  end if;

  -- v2: cuánto se paga AHORA. Sin monto explícito se paga el total (compat
  -- con el frontend viejo); origen 'ninguno' o p_pago null = no se paga nada.
  if p_pago is null or v_origen = 'ninguno' then
    v_pagado := 0;
  else
    v_pagado := round(coalesce(nullif(p_pago->>'monto', '')::numeric, v_total), 2);
  end if;
  if v_pagado < 0 or v_pagado > v_total + 0.009 then
    raise exception 'El pago (%) no puede ser negativo ni superar el total (%).', v_pagado, v_total;
  end if;
  if v_pagado <= 0.009 then
    v_pagado := 0;
    v_origen := 'ninguno';
  elsif v_origen not in ('turno', 'cuenta') then
    raise exception 'Origen de pago inválido.';
  end if;
  if v_origen = 'turno' and v_turno_id is null then
    raise exception 'Falta el turno para el pago en efectivo.';
  end if;
  if v_origen = 'cuenta' and v_cuenta_id is null then
    raise exception 'Falta la cuenta de pago.';
  end if;

  v_saldo := round(v_total - v_pagado, 2);
  if v_saldo <= 0.009 then
    v_saldo := 0;
  end if;

  -- Dejar deuda exige permiso de finanzas (el cajero puro compra al contado).
  if v_saldo > 0 and not (select public.fn_tiene_permiso('finanzas')) then
    raise exception 'Dejar saldo a cuenta corriente del proveedor requiere permiso de finanzas.';
  end if;

  -- Vencimiento del saldo: el explícito, o la última cuota del plan.
  if v_saldo > 0 then
    v_venc_cc := nullif(p_cta_cte->>'fecha_vencimiento', '')::date;
    if v_venc_cc is null and v_hay_cuotas then
      select max(nullif(c->>'fecha_vencimiento', '')::date) into v_venc_cc
        from jsonb_array_elements(p_cuotas) c;
    end if;
    if v_venc_cc is null then
      raise exception 'Falta la fecha de vencimiento del saldo a cuenta corriente.';
    end if;
  end if;

  -- Anti-duplicado fiscal (solo con comprobante completo).
  if v_cuit is not null and v_tipo is not null and v_punto is not null and v_numero is not null then
    if exists (
      select 1 from public.facturas_compra
      where cuit_proveedor = v_cuit and tipo_comprobante = v_tipo
        and punto_venta = v_punto and numero_comprobante = v_numero
    ) then
      raise exception 'Ya existe una factura con ese comprobante (% %-%).', v_tipo, v_punto, v_numero;
    end if;
  end if;

  -- v2: la deuda por el saldo impago se crea ANTES de la factura para poder
  -- linkear facturas_compra.cuenta_id (así aparece en Cuentas a pagar /
  -- Comprobantes como cualquier deuda con factura).
  if v_saldo > 0 then
    insert into public.cuentas_a_pagar (
      pedido_id, proveedor_id, monto, fecha_vencimiento, estado,
      provisoria, tiene_factura, numero_factura, monto_pagado, nota
    ) values (
      null, p_proveedor_id, v_saldo, v_venc_cc,
      'pendiente'::public.estado_cuenta_pagar,
      false, true,
      nullif(btrim(concat_ws(' ', v_tipo, nullif(concat_ws('-', v_punto, v_numero), ''))), ''),
      0, nullif(btrim(coalesce(p_cta_cte->>'nota', '')), '')
    ) returning id into v_cuenta_pagar_id;
  end if;

  -- Cabecera de la factura (cuenta_id enlaza la deuda del saldo, si la hay).
  insert into public.facturas_compra (
    cuenta_id, pedido_id, proveedor_id, fecha, neto, iva_total, total,
    afecta_precio_venta, usuario_id, es_directa,
    tipo_comprobante, punto_venta, numero_comprobante, cuit_proveedor,
    percepcion_iva, percepcion_iibb, percepcion_otros, gastos_no_debitables
  ) values (
    v_cuenta_pagar_id, null, p_proveedor_id, v_fecha, v_neto, v_iva, v_total,
    (p_mueve_stock and p_afecta_precio_venta), p_usuario_id, true,
    v_tipo, v_punto, v_numero, v_cuit,
    v_perc_iva, v_perc_iibb, v_perc_otros, v_gastos
  ) returning id into v_factura_id;

  if p_mueve_stock then
    -- ── Compra con mercadería: cada línea es un producto (stock/costo/precio) ──
    for v_linea in select * from jsonb_array_elements(p_lineas) loop
      v_prod_id := (v_linea->>'producto_id')::integer;
      v_cant := coalesce((v_linea->>'cantidad')::numeric, 0);
      v_costo_sin_iva := coalesce((v_linea->>'costo_sin_iva')::numeric, 0);
      v_desc := coalesce((v_linea->>'descuento_porcentaje')::numeric, 0);
      v_iva_compra := coalesce((v_linea->>'iva_compra_porcentaje')::numeric, 0);
      v_margen := coalesce((v_linea->>'margen_porcentaje')::numeric, 0);
      v_iva_venta := coalesce((v_linea->>'iva_venta_porcentaje')::numeric, 0);
      if v_prod_id is null or v_cant <= 0 then continue; end if;

      v_costo_neto := round(v_costo_sin_iva * (1 - v_desc / 100), 2);
      v_costo_con_iva := round(v_costo_neto * (1 + v_iva_compra / 100), 2);
      v_precio_con_iva := public.fn_precio_venta(v_costo_neto, v_margen, v_iva_venta);
      v_precio_sin_iva := round(v_precio_con_iva / (1 + v_iva_venta / 100), 2);

      select stock_actual into v_stock_ant from public.productos where id = v_prod_id for update;
      v_stock_ant := coalesce(v_stock_ant, 0);
      v_stock_nuevo := v_stock_ant + v_cant;
      update public.productos set stock_actual = v_stock_nuevo, updated_at = v_ahora where id = v_prod_id;
      insert into public.movimientos_stock (
        producto_id, tipo, cantidad, stock_anterior, stock_nuevo, referencia_id, usuario_id, nota
      ) values (
        v_prod_id, 'entrada', v_cant, v_stock_ant, v_stock_nuevo, v_factura_id, p_usuario_id,
        'Compra directa #' || v_factura_id
      );

      insert into public.items_factura_compra (
        factura_id, producto_id, cantidad, costo_sin_iva, descuento_porcentaje,
        iva_compra_porcentaje, costo_con_iva, margen_porcentaje, iva_venta_porcentaje,
        precio_sin_iva, precio_con_iva
      ) values (
        v_factura_id, v_prod_id, v_cant, v_costo_sin_iva, v_desc,
        v_iva_compra, v_costo_con_iva, v_margen, v_iva_venta, v_precio_sin_iva, v_precio_con_iva
      );

      perform public.fn_set_costo(v_prod_id, v_costo_neto);
      if p_afecta_precio_venta then
        update public.productos
          set precio_venta = v_precio_con_iva, margen = v_margen,
              pendiente_precio = case when v_precio_con_iva > 0 then false else pendiente_precio end,
              updated_at = v_ahora
          where id = v_prod_id;
      end if;
      insert into public.proveedor_producto (proveedor_id, producto_id, costo, es_principal, updated_at)
      values (p_proveedor_id, v_prod_id, v_costo_neto, false, v_ahora)
      on conflict (proveedor_id, producto_id) do update set costo = excluded.costo, updated_at = v_ahora;
    end loop;
    v_categoria := 'compra_mercaderia'; -- excluida del P&L (va a Mercadería/CMV)
  else
    -- ── Gasto sin stock: una línea sin producto (para el Libro IVA) ──
    insert into public.items_factura_compra (
      factura_id, producto_id, descripcion, cantidad, costo_sin_iva,
      descuento_porcentaje, iva_compra_porcentaje, costo_con_iva
    ) values (
      v_factura_id, null,
      coalesce(nullif(btrim(p_gasto->>'descripcion'), ''), 'Compra'),
      1, v_neto, 0,
      case when v_neto > 0 then round(v_iva / v_neto * 100, 2) else 0 end,
      round(v_neto + v_iva, 2)
    );
    v_categoria := coalesce(nullif(btrim(p_gasto->>'categoria'), ''), 'otros');
  end if;

  -- ── Egreso: SOLO si salió plata, y por lo PAGADO (v2; antes v_total) ──
  if v_pagado > 0 then
    insert into public.egresos (descripcion, monto, categoria, fecha, usuario_id, turno_id, cuenta_id)
    values (
      'Compra a proveedor · factura #' || v_factura_id, v_pagado, v_categoria, v_fecha,
      p_usuario_id,
      case when v_origen = 'turno' then v_turno_id else null end,
      case when v_origen = 'cuenta' then v_cuenta_id else null end
    ) returning id into v_egreso_id;

    update public.facturas_compra set egreso_id = v_egreso_id where id = v_factura_id;
  end if;

  -- ── Pago (v2: por v_pagado, no v_total) ──
  if v_pagado > 0 then
    if v_origen = 'cuenta' then
      select tipo, coalesce(es_caja_fuerte, false), saldo_actual
        into v_tipo_cuenta, v_es_boveda, v_saldo_cta
        from public.cuentas where id = v_cuenta_id for update;
      if v_saldo_cta is null then raise exception 'La cuenta de pago no existe.'; end if;
      v_saldo_cta_nuevo := v_saldo_cta - v_pagado;
      if v_es_boveda and v_saldo_cta_nuevo < 0 then
        raise exception 'La compra deja la caja fuerte en negativo (saldo actual %).', v_saldo_cta;
      end if;
      -- referencia_tipo='egreso' → getSaldoCajaFuerte lo netea del circuito.
      insert into public.movimientos_cuenta (
        cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo,
        descripcion, categoria, referencia_tipo, referencia_id, usuario_id, fecha
      ) values (
        v_cuenta_id, 'egreso', v_pagado, v_saldo_cta, v_saldo_cta_nuevo,
        'Compra a proveedor · factura #' || v_factura_id, v_categoria, 'egreso', v_egreso_id,
        p_usuario_id, v_fecha
      );
      update public.cuentas set saldo_actual = v_saldo_cta_nuevo, updated_at = v_ahora where id = v_cuenta_id;
      v_cta_haber := case v_tipo_cuenta
        when 'caja' then (select id from public.plan_cuentas where codigo = '1.1.01')
        else (select id from public.plan_cuentas where codigo = '1.1.02')
      end;
    else
      -- Pago desde el efectivo del turno: NO toca cuentas (ya baja en el cierre).
      v_cta_haber := (select id from public.plan_cuentas where codigo = '1.1.01');
    end if;
  end if;

  -- ── Asiento: Debe Mercadería/Gasto + IVA crédito + percepciones /
  --    Haber caja-banco por lo pagado + 2.1.01 Proveedores por el saldo ──
  if p_mueve_stock then
    v_cta_debe := (select id from public.plan_cuentas where codigo = '1.1.04'); -- Mercadería
  else
    v_cta_debe := case v_categoria
      when 'alquiler' then (select id from public.plan_cuentas where codigo = '5.2.03')
      when 'servicios' then (select id from public.plan_cuentas where codigo = '5.2.04')
      when 'sueldos' then (select id from public.plan_cuentas where codigo = '5.2.01')
      when 'mantenimiento' then (select id from public.plan_cuentas where codigo = '5.2.05')
      when 'impuestos' then (select id from public.plan_cuentas where codigo = '5.2.06')
      else (select id from public.plan_cuentas where codigo = '5.2.09')
    end;
  end if;
  select id into v_cta_iva_cred from public.plan_cuentas where codigo = '1.1.05';
  select id into v_cta_perc_iva from public.plan_cuentas where codigo = '1.1.07';
  select id into v_cta_perc_iibb from public.plan_cuentas where codigo = '1.1.08';
  select id into v_cta_perc_otros from public.plan_cuentas where codigo = '1.1.09';
  if v_saldo > 0 then
    select id into v_cta_prov from public.plan_cuentas where codigo = '2.1.01';
    if v_cta_prov is null then
      raise exception 'Falta la cuenta 2.1.01 Proveedores en el plan de cuentas.';
    end if;
  end if;

  -- v2: con pago 0 no hay v_cta_haber; el asiento sale igual (Haber 2.1.01).
  if v_cta_debe is not null and (v_cta_haber is not null or v_cta_prov is not null) then
    insert into public.asientos (fecha, descripcion, tipo, origen, referencia_id, usuario_id)
    values (v_fecha, 'Compra directa · factura #' || v_factura_id, 'automatico', 'compra_directa', v_factura_id, p_usuario_id)
    returning id into v_asiento_id;

    insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
    values (v_asiento_id, v_cta_debe, round(v_neto + v_gastos, 2), 0, v_orden);
    v_orden := v_orden + 1;
    if v_iva > 0 and v_cta_iva_cred is not null then
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_iva_cred, v_iva, 0, v_orden); v_orden := v_orden + 1;
    end if;
    if v_perc_iva > 0 and v_cta_perc_iva is not null then
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_perc_iva, v_perc_iva, 0, v_orden); v_orden := v_orden + 1;
    end if;
    if v_perc_iibb > 0 and v_cta_perc_iibb is not null then
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_perc_iibb, v_perc_iibb, 0, v_orden); v_orden := v_orden + 1;
    end if;
    if v_perc_otros > 0 and v_cta_perc_otros is not null then
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_perc_otros, v_perc_otros, 0, v_orden); v_orden := v_orden + 1;
    end if;
    -- Haber partido: caja/banco por lo pagado + Proveedores por el saldo.
    -- Σdebe = v_total = v_pagado + v_saldo = Σhaber.
    if v_pagado > 0 and v_cta_haber is not null then
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_haber, 0, v_pagado, v_orden); v_orden := v_orden + 1;
    end if;
    if v_saldo > 0 then
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_prov, 0, v_saldo, v_orden);
    end if;
  end if;

  -- ── Cuotas del saldo (delega en la mig 148; exige permiso finanzas,
  --    ya garantizado por el guard del saldo) ──
  if v_cuenta_pagar_id is not null and v_hay_cuotas then
    perform public.fn_definir_cuotas_cuenta(v_cuenta_pagar_id, p_usuario_id, p_cuotas);
  end if;

  perform public.fn_auditar(p_usuario_id, 'compra_directa', 'factura_compra', v_factura_id,
    jsonb_build_object('total', v_total, 'pagado', v_pagado, 'saldo', v_saldo,
                       'cuenta_a_pagar_id', v_cuenta_pagar_id,
                       'mueve_stock', p_mueve_stock, 'origen', v_origen));

  return jsonb_build_object(
    'factura_id', v_factura_id,
    'egreso_id', v_egreso_id,
    'total', v_total,
    'pagado', v_pagado,
    'saldo', v_saldo,
    'cuenta_a_pagar_id', v_cuenta_pagar_id
  );
end;
$$;

revoke execute on function public.fn_registrar_compra_directa(uuid, integer, date, jsonb, jsonb, jsonb, boolean, boolean, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.fn_registrar_compra_directa(uuid, integer, date, jsonb, jsonb, jsonb, boolean, boolean, jsonb, jsonb, jsonb) to authenticated;

-- ─── Anular una compra directa (v2: contempla la deuda del saldo) ──────────────
create or replace function public.fn_anular_compra_directa(
  p_factura_id integer,
  p_usuario_id uuid
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_factura public.facturas_compra;
  v_item record;
  v_mov record;
  v_stock_ant numeric;
  v_stock_nuevo numeric;
  v_saldo numeric;
  v_saldo_nuevo numeric;
  v_pagado_deuda numeric;
begin
  select * into v_factura from public.facturas_compra where id = p_factura_id;
  if v_factura.id is null then raise exception 'La factura no existe.'; end if;
  if not coalesce(v_factura.es_directa, false) then
    raise exception 'Solo se pueden anular compras directas por esta vía.';
  end if;
  if not (select public.fn_tiene_permiso('compras')) then
    raise exception 'No tenés permiso para anular compras.';
  end if;
  if public.fn_periodo_cerrado(v_factura.fecha) then
    raise exception 'El período de esa compra está cerrado; no se puede anular.';
  end if;

  -- v2: si la compra dejó deuda, no se puede anular con pagos ya registrados
  -- (patrón fn_anular_factura_compra, mig 133).
  if v_factura.cuenta_id is not null then
    select coalesce(monto_pagado, 0) into v_pagado_deuda
      from public.cuentas_a_pagar where id = v_factura.cuenta_id for update;
    if v_pagado_deuda > 0
       or exists (select 1 from public.pagos_cuenta where cuenta_a_pagar_id = v_factura.cuenta_id) then
      raise exception 'No se puede anular: la deuda de esta compra ya tiene pagos. Anulá el pago primero.';
    end if;
  end if;

  -- Reponer stock (salida por lo que había entrado; no rebobina costo/precio).
  for v_item in
    select producto_id, cantidad from public.items_factura_compra
    where factura_id = p_factura_id and producto_id is not null
  loop
    select stock_actual into v_stock_ant from public.productos where id = v_item.producto_id for update;
    v_stock_nuevo := coalesce(v_stock_ant, 0) - v_item.cantidad;
    update public.productos set stock_actual = v_stock_nuevo, updated_at = now() where id = v_item.producto_id;
    insert into public.movimientos_stock (
      producto_id, tipo, cantidad, stock_anterior, stock_nuevo, referencia_id, usuario_id, nota
    ) values (
      v_item.producto_id, 'salida', v_item.cantidad, coalesce(v_stock_ant, 0), v_stock_nuevo,
      p_factura_id, p_usuario_id, 'Anulación compra directa #' || p_factura_id
    );
  end loop;

  -- Revertir el pago desde cuenta (si lo hubo) y borrar el egreso.
  -- (Con pago 0, egreso_id es null y el bloque no corre.)
  if v_factura.egreso_id is not null then
    for v_mov in
      select cuenta_id, monto from public.movimientos_cuenta
      where referencia_tipo = 'egreso' and referencia_id = v_factura.egreso_id and tipo = 'egreso'
    loop
      select saldo_actual into v_saldo from public.cuentas where id = v_mov.cuenta_id for update;
      v_saldo_nuevo := coalesce(v_saldo, 0) + v_mov.monto;
      insert into public.movimientos_cuenta (
        cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo,
        descripcion, categoria, referencia_tipo, referencia_id, usuario_id, fecha
      ) values (
        v_mov.cuenta_id, 'ingreso', v_mov.monto, coalesce(v_saldo, 0), v_saldo_nuevo,
        'Anulación compra directa #' || p_factura_id, 'compra_mercaderia', 'egreso', v_factura.egreso_id,
        p_usuario_id, current_date
      );
      update public.cuentas set saldo_actual = v_saldo_nuevo, updated_at = now() where id = v_mov.cuenta_id;
    end loop;
    delete from public.egresos where id = v_factura.egreso_id;
  end if;

  delete from public.asientos where origen = 'compra_directa' and referencia_id = p_factura_id;

  -- v2: si hubo deuda, borrar la cuenta se lleva por cascade la factura +
  -- items (mig 012), las cuotas (mig 148) y los programados pendientes
  -- (mig 146). Sin deuda, se borra la factura directo como antes.
  if v_factura.cuenta_id is not null then
    delete from public.cuentas_a_pagar where id = v_factura.cuenta_id;
  else
    delete from public.facturas_compra where id = p_factura_id;
  end if;

  perform public.fn_auditar(p_usuario_id, 'anular_compra_directa', 'factura_compra', p_factura_id,
    jsonb_build_object('total', v_factura.total, 'cuenta_a_pagar_id', v_factura.cuenta_id));
end;
$$;

revoke execute on function public.fn_anular_compra_directa(integer, uuid) from public, anon;
grant execute on function public.fn_anular_compra_directa(integer, uuid) to authenticated;

notify pgrst, 'reload schema';

-- Verificación post-migración (correr aparte):
--   select proname, count(*) from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname = 'public' and proname like 'fn_%'
--     group by proname having count(*) > 1;   → debe dar 0 filas
