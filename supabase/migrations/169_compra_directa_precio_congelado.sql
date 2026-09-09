-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 169 · Compra directa: el precio de venta no se dispara   ║
-- ║                                                                     ║
-- ║  fn_registrar_compra_directa reemitida con el cuerpo íntegro de la  ║
-- ║  mig 155 y la MISMA firma de 11 args (create or replace, sin drop). ║
-- ║                                                                     ║
-- ║  Cierra el último agujero del circuito de precios: con el tilde     ║
-- ║  "Actualizar también el precio de venta", la compra directa era la  ║
-- ║  única puerta que seguía repreciando SIEMPRE desde el margen —no    ║
-- ║  tenía canal de precio manual—, igual que hacía la carga de factura ║
-- ║  antes de las migs 167/168.                                         ║
-- ║                                                                     ║
-- ║  Cambios, todos dentro del loop de mercadería:                      ║
-- ║   1) precio_venta OPCIONAL por línea → el precio tipeado manda y el ║
-- ║      margen se deduce, aunque dé negativo. Espejo de la v13.        ║
-- ║   2) aplicar_iva OPCIONAL por línea → las alícuotas del comprobante ║
-- ║      vuelven a la ficha del producto. Espejo de la mig 168.         ║
-- ║   3) Guardas de $0 que faltaban: con costo 0 ya no se pisan         ║
-- ║      fn_set_costo ni proveedor_producto.costo (borraba el costo     ║
-- ║      real), y el precio/margen tampoco se pisan con $0.             ║
-- ║                                                                     ║
-- ║  La firma NO cambia → deploy desacoplado; sin las claves nuevas un  ║
-- ║  cliente viejo se comporta como antes, salvo por las guardas de $0, ║
-- ║  que son un arreglo puro.                                           ║
-- ╚════════════════════════════════════════════════════════════════════╝

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
  -- v3: pto/número normalizados al formato AFIP (el índice único y los
  -- anti-duplicados comparan texto exacto: "1" y "00001" eran distintos).
  v_punto text := case
    when nullif(regexp_replace(coalesce(p_fiscal->>'punto_venta', ''), '\D', '', 'g'), '') is null then null
    else lpad(regexp_replace(p_fiscal->>'punto_venta', '\D', '', 'g'), 5, '0') end;
  v_numero text := case
    when nullif(regexp_replace(coalesce(p_fiscal->>'numero_comprobante', ''), '\D', '', 'g'), '') is null then null
    else lpad(regexp_replace(p_fiscal->>'numero_comprobante', '\D', '', 'g'), 8, '0') end;
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
  -- v3: forma de pago + comprobante del pago en el acto
  v_forma text := nullif(btrim(coalesce(p_pago->>'forma_pago', '')), '');
  v_comprobante text := nullif(btrim(coalesce(p_pago->>'comprobante', '')), '');
  v_sufijo_pago text := '';
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
  v_precio_manual numeric;   -- mig 169: precio de venta fijado a mano
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

  -- v3: datos fiscales obligatorios salvo tipo X (ticket sin datos fiscales),
  -- espejo de la UI para que ninguna puerta los deje en blanco. El lpad de
  -- arriba recortaría en silencio un número más largo que el formato AFIP:
  -- se rechaza explícito.
  if length(regexp_replace(coalesce(p_fiscal->>'punto_venta', ''), '\D', '', 'g')) > 5 then
    raise exception 'El punto de venta tiene más de 5 dígitos.';
  end if;
  if length(regexp_replace(coalesce(p_fiscal->>'numero_comprobante', ''), '\D', '', 'g')) > 8 then
    raise exception 'El número de comprobante tiene más de 8 dígitos.';
  end if;
  if coalesce(v_tipo, '') <> 'X'
     and (v_tipo is null or v_punto is null or v_numero is null
          or v_cuit is null or v_cuit !~ '^\d{11}$') then
    raise exception 'Faltan datos fiscales del comprobante (tipo, punto de venta, número y CUIT de 11 dígitos). Si es un ticket sin datos fiscales, usá tipo X.';
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

  -- v3: forma de pago y comprobante. Del turno sale efectivo, siempre (no
  -- hay número que cargar); desde una cuenta, el frontend viejo no manda
  -- forma → queda null (compat). Las formas rastreables exigen su número.
  if v_pagado = 0 then
    v_forma := null;
    v_comprobante := null;
  elsif v_origen = 'turno' then
    v_forma := 'efectivo';
    v_comprobante := null;
  elsif v_forma is not null and v_forma not in ('efectivo','transferencia','cheque','debito','otro') then
    raise exception 'Forma de pago inválida.';
  end if;
  if v_forma in ('transferencia','cheque','debito') and v_comprobante is null then
    raise exception 'Falta el % del pago.',
      case v_forma when 'transferencia' then 'N° de transferencia'
                   when 'cheque' then 'N° de cheque'
                   else 'N° de operación' end;
  end if;
  if v_comprobante is not null then
    v_sufijo_pago := ' · ' || case v_forma
      when 'transferencia' then 'Transferencia '
      when 'cheque' then 'Cheque '
      when 'debito' then 'Débito op. '
      else 'Comp. ' end || v_comprobante;
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

      -- ── Lado venta (mig 169) ──────────────────────────────────────
      --   Espejo de fn_guardar_factura_compra v13: el precio tipeado MANDA
      --   (repricearlo con fn_precio_venta lo subiria al multiplo de arriba)
      --   y se guarda el PAR COHERENTE deduciendo el margen real, que puede
      --   dar NEGATIVO: hay productos que se venden asi a proposito.
      --   Sin precio manda el margen y repricia el motor, como siempre.
      --   La base del margen es el costo de ESTA compra; si vino en $0
      --   (bonificada) se cae al ultimo costo real, nunca a 0 pelado, que
      --   haria reventar fn_margen_desde_precio con costo NULL.
      v_precio_manual := nullif(v_linea->>'precio_venta', '')::numeric;
      if v_precio_manual is not null and v_precio_manual > 0 then
        v_precio_con_iva := round(v_precio_manual, 2);
        v_margen := public.fn_margen_desde_precio(
          case when v_costo_neto > 0 then v_costo_neto
               else coalesce(public.fn_costo(v_prod_id), 0) end,
          v_precio_con_iva, v_iva_venta);
      else
        v_precio_con_iva := public.fn_precio_venta(v_costo_neto, v_margen, v_iva_venta);
      end if;
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

      -- mig 169: con costo $0 (bonificada, o renglon al que no le pusieron
      -- costo) NO se pisa el costo guardado ni el del catalogo: el CMV de
      -- las ventas siguientes tiene que seguir usando el ultimo costo REAL.
      -- Mismo criterio que fn_guardar_factura_compra v20 (mig 156).
      if v_costo_neto > 0 then
        perform public.fn_set_costo(v_prod_id, v_costo_neto);

        insert into public.proveedor_producto (proveedor_id, producto_id, costo, es_principal, updated_at)
        values (p_proveedor_id, v_prod_id, v_costo_neto, false, v_ahora)
        on conflict (proveedor_id, producto_id) do update set costo = excluded.costo, updated_at = v_ahora;
      else
        -- Sin costo real igual se siembra el par, para que el vinculo exista.
        insert into public.proveedor_producto (proveedor_id, producto_id, es_principal, updated_at)
        values (p_proveedor_id, v_prod_id, false, v_ahora)
        on conflict (proveedor_id, producto_id) do nothing;
      end if;

      if p_afecta_precio_venta then
        update public.productos
          -- mig 169: el guard de > 0 evita dejar el producto vendible a $0
          -- cuando no hubo ninguna base de costo (espejo de la v21).
          set precio_venta = case when v_precio_con_iva > 0 then v_precio_con_iva else precio_venta end,
              margen = case when v_precio_con_iva > 0 then v_margen else margen end,
              pendiente_precio = case when v_precio_con_iva > 0 then false else pendiente_precio end,
              updated_at = v_ahora
          where id = v_prod_id;
      end if;

      -- mig 169: la alicuota vuelve a la ficha, igual que en la mig 168.
      -- Va FUERA del guard de precio (es un dato del producto, no una
      -- decision de precio) y es opt-in por la clave OPCIONAL aplicar_iva,
      -- asi un cliente viejo no pisa un 10,5 con su 21 hardcodeado.
      if coalesce((v_linea->>'aplicar_iva')::boolean, false) then
        update public.productos
          set iva_venta = v_iva_venta,
              iva_compra = v_iva_compra,
              updated_at = v_ahora
          where id = v_prod_id
            and (iva_venta is distinct from v_iva_venta
                 or iva_compra is distinct from v_iva_compra);
      end if;
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

  -- ── Egreso: SOLO si salió plata, y por lo PAGADO (v3: + forma/comprobante) ──
  if v_pagado > 0 then
    insert into public.egresos (
      descripcion, monto, categoria, fecha, usuario_id, turno_id, cuenta_id,
      forma_pago, comprobante
    ) values (
      'Compra a proveedor · factura #' || v_factura_id || v_sufijo_pago,
      v_pagado, v_categoria, v_fecha,
      p_usuario_id,
      case when v_origen = 'turno' then v_turno_id else null end,
      case when v_origen = 'cuenta' then v_cuenta_id else null end,
      v_forma, v_comprobante
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
      -- v3: el comprobante va en la descripción para que se vea al conciliar.
      insert into public.movimientos_cuenta (
        cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo,
        descripcion, categoria, referencia_tipo, referencia_id, usuario_id, fecha
      ) values (
        v_cuenta_id, 'egreso', v_pagado, v_saldo_cta, v_saldo_cta_nuevo,
        'Compra a proveedor · factura #' || v_factura_id || v_sufijo_pago,
        v_categoria, 'egreso', v_egreso_id,
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
                       'mueve_stock', p_mueve_stock, 'origen', v_origen,
                       'forma_pago', v_forma, 'comprobante', v_comprobante));

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

notify pgrst, 'reload schema';
