-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║ 164 · v22: las bonificadas (desc 100%) se pricean con el costo de   ║
-- ║ LISTA                                                                ║
-- ║                                                                      ║
-- ║ PROBLEMA: la v21 obligaba a tipear el precio a mano en un renglón    ║
-- ║ bonificado — en modo margen, fn_precio_venta recibía el costo landed ║
-- ║ (post-descuento = $0) y daba precio $0, así que la UI bloqueaba el   ║
-- ║ guardado. Pedido del dueño: el producto regalado (10 + 1 de regalo)  ║
-- ║ sale a la venta al MISMO precio que el pagado, sin tipear nada.      ║
-- ║                                                                      ║
-- ║ FIX = v22 (cuerpo v21 de la mig 157, íntegro, MISMA firma 12 args):  ║
-- ║ la base del lado VENTA pasa a ser una cascada:                       ║
-- ║   landed → costo de LISTA landed (pre-descuento × factor de gastos)  ║
-- ║   → costo conservado (fn_costo).                                     ║
-- ║ El descuento del comprobante se ignora SOLO para pricear. Para un    ║
-- ║ renglón normal (landed > 0) la primera pata gana → comportamiento    ║
-- ║ IDÉNTICO a la v21. El margen deducido de un precio manual usa la     ║
-- ║ misma cascada (antes: landed → fn_costo), igual que muestra la UI.   ║
-- ║ El precio MAYORISTA se reprecia con la misma base (antes la           ║
-- ║ bonificada no lo repreciaba).                                        ║
-- ║                                                                      ║
-- ║ SOLO cambia el lado venta: el costo guardado (fn_set_costo),         ║
-- ║ proveedor_producto, historial_costos e items_pedido siguen con las   ║
-- ║ guardas v20/v21 (una bonificada NO pisa el costo real → CMV sano).   ║
-- ║                                                                      ║
-- ║ ORDEN: correr DESPUÉS de la 157 (la 158-163 no tocan esta RPC).      ║
-- ║ Misma firma → create or replace directo, sin drops. Verificación     ║
-- ║ al final del archivo.                                                ║
-- ╚══════════════════════════════════════════════════════════════════════╝

create or replace function public.fn_guardar_factura_compra(
  p_cuenta_id integer,
  p_pedido_id integer,
  p_proveedor_id integer,
  p_fecha date,
  p_afecta_precio_venta boolean,
  p_usuario_id uuid,
  p_lineas jsonb,
  p_percepciones jsonb default '{"iva":0,"iibb":0,"otros":0}'::jsonb,
  p_gastos_no_debitables numeric default 0,
  p_pago jsonb default null,
  p_redondeo numeric default 0,
  p_cuotas jsonb default null  -- v18: null = no tocar el plan · [] = quitarlo · [..] = redefinirlo
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  -- Fecha "hoy" del NEGOCIO (La Rioja), no la UTC del server (mig 147).
  v_hoy date := (now() at time zone 'America/Argentina/La_Rioja')::date;
  v_ahora timestamptz := now();
  v_linea jsonb;
  v_neto numeric := 0;
  v_iva_total numeric := 0;
  v_total numeric := 0;
  v_factura_id integer;
  v_prod_id integer;
  v_costo_sin_iva numeric;
  v_desc numeric;
  v_iva_compra numeric;
  v_margen numeric;
  v_iva_venta numeric;
  v_cant numeric;
  v_costo_neto numeric;
  v_costo_con_iva numeric;
  v_costo_landed numeric;
  v_costo_lista_landed numeric;  -- v22: costo pre-descuento × factor (pricing de bonificadas)
  v_base_precio numeric;         -- v22: cascada landed → lista landed → costo conservado
  v_precio_sin_iva numeric;
  v_precio_con_iva numeric;
  v_asiento_id integer;
  v_cta_merc integer;
  v_cta_iva_cred integer;
  v_cta_prov integer;
  v_cta_dif integer;
  v_costo_ant numeric;
  v_var_pct numeric;
  -- Percepciones
  v_perc_iva numeric := coalesce((p_percepciones->>'iva')::numeric, 0);
  v_perc_iibb numeric := coalesce((p_percepciones->>'iibb')::numeric, 0);
  v_perc_otros numeric := coalesce((p_percepciones->>'otros')::numeric, 0);
  v_cta_perc_iva integer;
  v_cta_perc_iibb integer;
  v_cta_perc_otros integer;
  -- Gastos no debitables + redondeo del comprobante (v16)
  v_gastos numeric := round(coalesce(p_gastos_no_debitables, 0), 2);
  v_redondeo numeric := round(coalesce(p_redondeo, 0), 2);
  v_factor numeric := 1;
  v_orden integer := 0;
  -- Reconciliación de stock (v12)
  v_item_pedido_id integer;
  v_venc date;
  v_recibida numeric;
  v_facturada_prev numeric;
  v_reflejada numeric;
  v_delta numeric;
  v_stock_ant numeric;
  v_stock_nuevo numeric;
  -- Precio manual (v13): precio de venta tipeado por fila (par coherente, mig 126)
  v_precio_manual numeric;
  -- Pagos previos + pagos integrados (v14/v15) / programados (v16)
  v_aplicado numeric := 0;
  v_pagado_prev numeric;
  v_pagos jsonb;
  v_pago jsonb;
  v_pago_cuenta integer;
  v_pago_monto numeric;
  v_pago_fecha date;
begin
  -- Guard de permiso (v14): SECURITY DEFINER + delete/reescritura de stock,
  -- costos y asientos → no puede quedar ejecutable sin gate. Los tres puntos
  -- de entrada de la UI ya exigen 'finanzas'.
  if not (select public.fn_tiene_permiso('finanzas')) then
    raise exception 'No tenés permiso para cargar facturas de compra.';
  end if;

  -- Guard de período cerrado (fix v13: la v12 lo había perdido; venía de la 053).
  if public.fn_periodo_cerrado(p_fecha) then
    raise exception 'El período contable de % está cerrado: no se pueden cargar ni editar facturas de ese mes.',
      to_char(p_fecha, 'MM/YYYY');
  end if;

  -- Lock de la deuda ANTES de leer sus pagos (v14): un fn_pagar_cuenta
  -- concurrente (que lockea esta misma fila al arrancar) espera a que esta
  -- transacción commitee, y la re-derivación de estado de más abajo nunca
  -- trabaja con un aplicado viejo.
  select coalesce(monto_pagado, 0) into v_pagado_prev
    from public.cuentas_a_pagar where id = p_cuenta_id for update;
  if not found then
    raise exception 'La cuenta a pagar #% no existe.', p_cuenta_id;
  end if;
  select coalesce(sum(monto - coalesce(sobrante, 0)), 0) into v_aplicado
    from public.pagos_cuenta where cuenta_a_pagar_id = p_cuenta_id;
  if v_aplicado = 0 and v_pagado_prev > 0 then
    v_aplicado := v_pagado_prev;  -- compat con pagos legacy sin fila en pagos_cuenta
  end if;

  delete from public.facturas_compra where cuenta_id = p_cuenta_id;

  -- Primer loop: neto e IVA sobre lo GRAVADO (sin los gastos).
  for v_linea in select * from jsonb_array_elements(p_lineas) loop
    v_costo_sin_iva := (v_linea->>'costo_sin_iva')::numeric;
    v_desc := coalesce((v_linea->>'descuento_porcentaje')::numeric, 0);
    v_iva_compra := coalesce((v_linea->>'iva_compra_porcentaje')::numeric, 0);
    v_cant := (v_linea->>'cantidad')::numeric;
    v_costo_neto := round(v_costo_sin_iva * (1 - v_desc / 100), 2);
    v_costo_con_iva := round(v_costo_neto * (1 + v_iva_compra / 100), 2);
    v_neto := v_neto + v_costo_neto * v_cant;
    v_iva_total := v_iva_total + (v_costo_con_iva - v_costo_neto) * v_cant;
  end loop;
  v_neto := round(v_neto, 2);
  v_iva_total := round(v_iva_total, 2);
  v_perc_iva := round(coalesce(v_perc_iva, 0), 2);
  v_perc_iibb := round(coalesce(v_perc_iibb, 0), 2);
  v_perc_otros := round(coalesce(v_perc_otros, 0), 2);

  -- Factor de prorrateo de los gastos no debitables (por neto).
  if v_neto > 0 then
    v_factor := 1 + v_gastos / v_neto;
  end if;

  -- v16: el redondeo del comprobante entra al total (así el total del sistema
  -- da EXACTO como el papel). No prorratea al costo ni genera IVA crédito.
  v_total := round(
    v_neto + v_iva_total + v_perc_iva + v_perc_iibb + v_perc_otros + v_gastos + v_redondeo, 2
  );

  -- Guard v14: el total no puede quedar por debajo de lo ya APLICADO en pagos
  -- (aplicado = Σ(monto − sobrante): un sobrepago legítimo no bloquea
  -- re-ediciones; se leyó arriba, ya con la deuda lockeada).
  if v_aplicado > v_total + 0.009 then
    raise exception 'El total de la factura (%) es menor a lo ya pagado (%). Anulá los pagos primero.',
      v_total, v_aplicado;
  end if;

  insert into public.facturas_compra (
    cuenta_id, pedido_id, proveedor_id, fecha, neto, iva_total, total,
    afecta_precio_venta, usuario_id,
    percepcion_iva, percepcion_iibb, percepcion_otros, gastos_no_debitables, redondeo
  ) values (
    p_cuenta_id, p_pedido_id, p_proveedor_id, p_fecha, v_neto, v_iva_total, v_total,
    p_afecta_precio_venta, p_usuario_id,
    v_perc_iva, v_perc_iibb, v_perc_otros, v_gastos, v_redondeo
  ) returning id into v_factura_id;

  -- Segundo loop: costo LANDED = costo neto × factor (gastos prorrateados)
  -- + RECONCILIACIÓN DE STOCK por renglón del pedido.
  for v_linea in select * from jsonb_array_elements(p_lineas) loop
    v_prod_id := (v_linea->>'producto_id')::integer;
    v_costo_sin_iva := (v_linea->>'costo_sin_iva')::numeric;
    v_desc := coalesce((v_linea->>'descuento_porcentaje')::numeric, 0);
    v_iva_compra := coalesce((v_linea->>'iva_compra_porcentaje')::numeric, 0);
    v_margen := coalesce((v_linea->>'margen_porcentaje')::numeric, 0);
    v_iva_venta := coalesce((v_linea->>'iva_venta_porcentaje')::numeric, 0);
    v_cant := (v_linea->>'cantidad')::numeric;
    v_costo_neto := round(v_costo_sin_iva * (1 - v_desc / 100), 2);
    v_costo_con_iva := round(v_costo_neto * (1 + v_iva_compra / 100), 2);
    v_costo_landed := round(v_costo_neto * v_factor, 2);

    -- v20: el costo previo se lee ANTES del lado venta — con una bonificada
    -- (landed $0) es la base para deducir el margen del par coherente.
    -- v21: coalesce — fn_costo devuelve NULL si el producto no tiene fila en
    -- costos_producto, y fn_margen_desde_precio revienta con p_costo NULL.
    v_costo_ant := coalesce(public.fn_costo(v_prod_id), 0);

    -- v22: base del lado VENTA en cascada. El descuento del comprobante se
    -- ignora SOLO para pricear (el regalo se vende como el pagado); el lado
    -- compra (neto, IVA, landed, costo guardado) no cambia. Espejo del
    -- cliente: costoPricing = costoFinal > 0 ? costoFinal : lista × factor.
    v_costo_lista_landed := round(v_costo_sin_iva * v_factor, 2);
    v_base_precio := case
      when v_costo_landed > 0 then v_costo_landed
      when v_costo_lista_landed > 0 then v_costo_lista_landed
      else v_costo_ant
    end;

    -- ── Lado venta (v13): el precio tipeado manda; sin precio, manda el margen ──
    v_precio_manual := nullif(v_linea->>'precio_venta', '')::numeric;
    if v_precio_manual is not null and v_precio_manual > 0 then
      -- PRECIO MANDA: se respeta tal cual (repricearlo con fn_precio_venta lo
      -- subiría al múltiplo siguiente) y se guarda el PAR COHERENTE deduciendo
      -- el margen real (precedente: mig 126, importación par coherente).
      -- v22: bonificada (landed $0) → el margen se deduce contra la MISMA
      -- cascada (lista landed → conservado), igual que muestra la UI.
      v_precio_con_iva := round(v_precio_manual, 2);
      v_margen := public.fn_margen_desde_precio(v_base_precio, v_precio_con_iva, v_iva_venta);
    else
      -- MARGEN MANDA (v22): con la base en cascada una bonificada con costo
      -- de lista da precio real (redondea techo a múltiplos, camino v12).
      v_precio_con_iva := public.fn_precio_venta(v_base_precio, v_margen, v_iva_venta);
    end if;
    v_precio_sin_iva := round(v_precio_con_iva / (1 + v_iva_venta / 100), 2);

    if v_costo_ant > 0 and v_costo_landed > 0 and v_costo_landed <> v_costo_ant then
      v_var_pct := round(((v_costo_landed - v_costo_ant) / v_costo_ant) * 100, 2);
      insert into public.historial_costos (
        producto_id, proveedor_id, costo_anterior, costo_nuevo, variacion_pct, origen, pedido_id, usuario_id
      ) values (
        v_prod_id, p_proveedor_id, v_costo_ant, v_costo_landed, v_var_pct, 'factura', p_pedido_id, p_usuario_id
      );
    end if;

    insert into public.items_factura_compra (
      factura_id, producto_id, cantidad, costo_sin_iva,
      descuento_porcentaje, iva_compra_porcentaje, costo_con_iva,
      margen_porcentaje, iva_venta_porcentaje, precio_sin_iva, precio_con_iva
    ) values (
      v_factura_id, v_prod_id, v_cant, v_costo_sin_iva,
      v_desc, v_iva_compra, v_costo_con_iva,
      v_margen, v_iva_venta, v_precio_sin_iva, v_precio_con_iva
    );

    if p_afecta_precio_venta then
      update public.productos
        -- v21: caso residual bonificada SIN ninguna base de costo →
        -- fn_precio_venta(0,…) da $0; no se pisa el precio/margen vigentes
        -- con eso (vendible a $0). Con costo de lista (v22) esto no ocurre.
        set precio_venta = case when v_precio_con_iva > 0 then v_precio_con_iva else precio_venta end,
            margen = case when v_precio_con_iva > 0 then v_margen else margen end,
            -- v19 (de mig 153): el precio MAYORISTA se recalcula desde SU margen.
            -- v22: con la MISMA base en cascada que el minorista (antes la
            -- bonificada no lo repreciaba; para renglones normales es idéntico).
            precio_mayorista = case
              when margen_mayorista is not null and v_base_precio > 0
                then public.fn_precio_venta(v_base_precio, margen_mayorista, v_iva_venta)
              else precio_mayorista
            end,
            pendiente_precio = case when v_precio_con_iva > 0 then false else pendiente_precio end,
            updated_at = v_ahora
        where id = v_prod_id;
    end if;
    -- v20: bonificada (landed $0) → NO se pisa el costo guardado: el CMV de
    -- las ventas siguientes sigue usando el último costo real.
    if v_costo_landed > 0 then
      perform public.fn_set_costo(v_prod_id, v_costo_landed);

      update public.proveedor_producto set costo = v_costo_landed, updated_at = v_ahora
        where proveedor_id = p_proveedor_id and producto_id = v_prod_id;
    end if;

    -- ── RECONCILIACIÓN DE STOCK (v12) ─────────────────────────────────
    v_item_pedido_id := nullif(v_linea->>'item_pedido_id', '')::integer;
    v_venc := nullif(v_linea->>'fecha_vencimiento', '')::date;

    if v_item_pedido_id is not null then
      -- Base = lo que el stock ya refleja de este renglón:
      --   antes de la 1ª factura → lo recibido; después → lo ya facturado.
      select cantidad_recibida, cantidad_facturada
        into v_recibida, v_facturada_prev
        from public.items_pedido where id = v_item_pedido_id for update;

      v_reflejada := coalesce(v_facturada_prev, v_recibida, 0);
      v_delta := v_cant - v_reflejada;

      if v_delta <> 0 then
        select stock_actual into v_stock_ant
          from public.productos where id = v_prod_id for update;
        v_stock_ant := coalesce(v_stock_ant, 0);
        v_stock_nuevo := v_stock_ant + v_delta;
        update public.productos set stock_actual = v_stock_nuevo, updated_at = v_ahora
          where id = v_prod_id;

        insert into public.movimientos_stock (
          producto_id, tipo, cantidad, stock_anterior, stock_nuevo,
          referencia_id, usuario_id, nota
        ) values (
          v_prod_id,
          (case when v_delta > 0 then 'entrada' else 'salida' end)::public.tipo_movimiento,
          abs(v_delta), v_stock_ant, v_stock_nuevo,
          p_cuenta_id, p_usuario_id,
          'Factura compra (cuenta #' || p_cuenta_id || '): stock '
            || v_reflejada::text || ' → ' || v_cant::text
        );

        perform public.fn_ajustar_lote_factura(v_prod_id, p_pedido_id, v_delta, v_venc);
      elsif v_venc is not null then
        -- Sin cambio de cantidad: solo corrige el vencimiento del lote.
        update public.lotes set fecha_vencimiento = v_venc
          where producto_id = v_prod_id and pedido_origen_id = p_pedido_id
            and estado = 'activo'::public.estado_lote;
      end if;

      update public.items_pedido
        set precio_costo = v_costo_landed,
            subtotal = round(v_costo_landed * v_cant, 2),
            cantidad_facturada = v_cant
        where id = v_item_pedido_id;
    end if;
  end loop;

  -- v14: si hay pagos previos, el estado se RE-DERIVA contra el total nuevo
  -- (la v13 podía dejar 'pagada' con saldo al re-facturar al alza, o
  -- 'pendiente' con saldo 0 si los pagos ya cubrían el total nuevo).
  -- Con aplicado 0 no se toca el estado (cuentas legacy no se reabren).
  update public.cuentas_a_pagar
    set monto = v_total, provisoria = false, tiene_factura = true,
        estado = case
          when v_aplicado > 0 and v_aplicado >= v_total - 0.009
            then 'pagada'::public.estado_cuenta_pagar
          when v_aplicado > 0
            then 'pendiente'::public.estado_cuenta_pagar
          else estado
        end,
        fecha_pago = case
          when v_aplicado > 0 and v_aplicado >= v_total - 0.009
            then coalesce(fecha_pago, v_hoy)
          when v_aplicado > 0
            then null
          else fecha_pago
        end
    where id = p_cuenta_id;

  -- pedidos.total = suma de TODAS las facturas cargadas del pedido +
  -- suma de las provisorias que todavía NO tienen factura (su estimado).
  update public.pedidos
    set total = coalesce((
          select sum(fc.total) from public.facturas_compra fc
          where fc.pedido_id = p_pedido_id
        ), 0)
        + coalesce((
          select sum(cap.monto) from public.cuentas_a_pagar cap
          where cap.pedido_id = p_pedido_id and cap.tiene_factura = false
        ), 0),
        updated_at = v_ahora
    where id = p_pedido_id;

  delete from public.asientos where origen = 'factura_compra' and referencia_id = p_cuenta_id;
  select id into v_cta_merc from public.plan_cuentas where codigo = '1.1.04';
  select id into v_cta_iva_cred from public.plan_cuentas where codigo = '1.1.05';
  select id into v_cta_prov from public.plan_cuentas where codigo = '2.1.01';
  select id into v_cta_dif from public.plan_cuentas where codigo = '5.2.10';
  select id into v_cta_perc_iva from public.plan_cuentas where codigo = '1.1.07';
  select id into v_cta_perc_iibb from public.plan_cuentas where codigo = '1.1.08';
  select id into v_cta_perc_otros from public.plan_cuentas where codigo = '1.1.09';

  if v_redondeo <> 0 and v_cta_dif is null then
    raise exception 'Falta la cuenta 5.2.10 Diferencias por Pagos y Redondeos en el plan.';
  end if;

  if v_total > 0 and v_cta_merc is not null and v_cta_iva_cred is not null and v_cta_prov is not null then
    insert into public.asientos (fecha, descripcion, tipo, origen, referencia_id, usuario_id)
    values (p_fecha, 'Factura compra · Pedido #' || p_pedido_id, 'automatico', 'factura_compra', p_cuenta_id, p_usuario_id)
    returning id into v_asiento_id;

    insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
    values (v_asiento_id, v_cta_merc, round(v_neto + v_gastos, 2), 0, v_orden);
    v_orden := v_orden + 1;
    if v_iva_total > 0 then
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_iva_cred, v_iva_total, 0, v_orden);
      v_orden := v_orden + 1;
    end if;
    if v_perc_iva > 0 and v_cta_perc_iva is not null then
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_perc_iva, v_perc_iva, 0, v_orden);
      v_orden := v_orden + 1;
    end if;
    if v_perc_iibb > 0 and v_cta_perc_iibb is not null then
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_perc_iibb, v_perc_iibb, 0, v_orden);
      v_orden := v_orden + 1;
    end if;
    if v_perc_otros > 0 and v_cta_perc_otros is not null then
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_perc_otros, v_perc_otros, 0, v_orden);
      v_orden := v_orden + 1;
    end if;
    -- v16: redondeo positivo (el papel dice MÁS que el cálculo) → Debe 5.2.10.
    if v_redondeo > 0 then
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_dif, v_redondeo, 0, v_orden);
      v_orden := v_orden + 1;
    end if;
    insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
    values (v_asiento_id, v_cta_prov, 0, v_total, v_orden);
    v_orden := v_orden + 1;
    -- v16: redondeo negativo (el papel dice MENOS) → Haber 5.2.10 (balancea:
    -- el Haber a Proveedores ya bajó con el total).
    if v_redondeo < 0 then
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_dif, 0, abs(v_redondeo), v_orden);
    end if;
  end if;

  -- ── Pagos integrados (v15) / PROGRAMADOS (v16) ───────────────────────
  -- v17: el corte real/programado usa la fecha LOCAL del negocio, no la UTC
  -- del server (que a la noche ya está en "mañana" y ejecutaba en el acto
  -- pagos que debían quedar programados).
  if p_pago is not null then
    if jsonb_typeof(p_pago) = 'object' then
      v_pagos := jsonb_build_array(p_pago);  -- compat v14: un solo pago
    elsif jsonb_typeof(p_pago) = 'array' then
      v_pagos := p_pago;
    else
      raise exception 'p_pago inválido: se espera un objeto o una lista de pagos.';
    end if;

    if jsonb_array_length(v_pagos) > 0 then
      -- Error claro en vez del "ya está pagada" de fn_pagar_cuenta: con los
      -- pagos previos cubriendo el total, ningún pago nuevo puede tener éxito.
      if v_aplicado >= v_total - 0.009 then
        raise exception 'La deuda ya quedó cubierta por los pagos previos: guardá la factura sin el pago.';
      end if;

      for v_pago in select * from jsonb_array_elements(v_pagos) loop
        v_pago_cuenta := nullif(v_pago->>'cuenta_origen_id', '')::integer;
        v_pago_monto := nullif(v_pago->>'monto', '')::numeric;
        v_pago_fecha := coalesce(nullif(v_pago->>'fecha', '')::date, v_hoy);
        if v_pago_cuenta is null or v_pago_monto is null or v_pago_monto <= 0 then
          raise exception 'Datos del pago incompletos: la cuenta de origen y el monto son obligatorios.';
        end if;
        if v_pago_fecha > v_hoy then
          insert into public.pagos_programados (
            cuenta_a_pagar_id, cuenta_origen_id, monto, forma_pago,
            comprobante, nota, fecha_programada, usuario_id
          ) values (
            p_cuenta_id, v_pago_cuenta, round(v_pago_monto, 2),
            nullif(v_pago->>'forma_pago', ''),
            nullif(btrim(coalesce(v_pago->>'comprobante', '')), ''),
            nullif(btrim(coalesce(v_pago->>'nota', '')), ''),
            v_pago_fecha, p_usuario_id
          );
        else
          perform public.fn_pagar_cuenta(
            p_cuenta_id,
            p_usuario_id,
            v_pago_cuenta,
            round(v_pago_monto, 2),
            v_pago_fecha,
            nullif(btrim(coalesce(v_pago->>'nota', '')), ''),
            nullif(v_pago->>'forma_pago', ''),
            nullif(btrim(coalesce(v_pago->>'comprobante', '')), '')
          );
        end if;
      end loop;
    end if;
  end if;

  -- ── Plan de cuotas del saldo (v18, mig 148) ──────────────────────────
  -- Va al FINAL a propósito: los pagos de p_pago ya insertaron en
  -- pagos_cuenta dentro de esta misma transacción, así el saldo que valida
  -- fn_definir_cuotas_cuenta es el saldo POST-pagos. El re-lock de la misma
  -- fila en la misma transacción es un no-op.
  if p_cuotas is not null then
    perform public.fn_definir_cuotas_cuenta(p_cuenta_id, p_usuario_id, p_cuotas);
  end if;
end;
$$;

grant execute on function public.fn_guardar_factura_compra(
  integer, integer, integer, date, boolean, uuid, jsonb, jsonb, numeric, jsonb, numeric, jsonb)
  to authenticated;

notify pgrst, 'reload schema';

-- ── VERIFICACIÓN 1: debe devolver UNA sola fila (12 args) ──────────────
-- select oid::regprocedure from pg_proc
--  where proname = 'fn_guardar_factura_compra' and pronamespace = 'public'::regnamespace;

-- ── VERIFICACIÓN 2 (T1): sin funciones fn_% duplicadas → 0 filas ───────
-- select proname, count(*) from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public' and proname like 'fn_%'
--  group by proname having count(*) > 1;
