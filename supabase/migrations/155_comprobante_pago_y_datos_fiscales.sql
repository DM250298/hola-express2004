-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 155 · N° de comprobante de pago + forma de pago en        ║
-- ║  egresos, compra directa v3, programados con comprobante             ║
-- ║                                                                     ║
-- ║  Pedido: el N° de transferencia (cheque / operación) es OBLIGATORIO ║
-- ║  cuando la forma de pago lo tiene, en las tres puertas de pago a    ║
-- ║  proveedores. Hoy solo pagos_cuenta guarda forma/comprobante; la    ║
-- ║  compra directa (que paga en el acto SIN fila en pagos_cuenta) no   ║
-- ║  registraba ni la forma ni el número.                                ║
-- ║                                                                     ║
-- ║  Se emiten:                                                         ║
-- ║   · egresos + forma_pago + comprobante (nullable, aditivo)          ║
-- ║   · backfill de pto/número históricos al formato AFIP (idempotente) ║
-- ║   · fn_registrar_compra_directa v3 (misma firma de 11 args):        ║
-- ║     lee p_pago.forma_pago / p_pago.comprobante, los guarda en el    ║
-- ║     egreso y los deja visibles en la descripción del egreso y del   ║
-- ║     movimiento (Egresos / Movimientos / Conciliación sin tocar UI); ║
-- ║     raise si la forma exige número y no viene; normaliza pto/nro al ║
-- ║     formato AFIP (00001 / 00012345) y exige los datos fiscales      ║
-- ║     (salvo tipo X), espejo de la UI                                  ║
-- ║   · fn_pagar_cuenta v7 (misma firma): copia forma/comprobante al    ║
-- ║     egreso y al texto del movimiento. SIN guard de comprobante: la  ║
-- ║     llama fn_ejecutar_pago_programado con programados que pueden    ║
-- ║     haber nacido sin número                                          ║
-- ║   · fn_ejecutar_pago_programado v3: LA FIRMA CAMBIA (2 → 3 args,    ║
-- ║     + p_comprobante default null) → drop de la de 2 args primero.   ║
-- ║     El número se carga al EJECUTAR (cuando la transferencia existe) ║
-- ║                                                                     ║
-- ║  REQUIERE: migs 148, 149 y 154 corridas. Correr ANTES del deploy.   ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────────────────────
-- 1. egresos: forma de pago + comprobante (mismo CHECK que pagos_cuenta)
-- ─────────────────────────────────────────────────────────────────────
alter table public.egresos
  add column if not exists forma_pago text,
  add column if not exists comprobante text;

do $$ begin
  alter table public.egresos
    add constraint egresos_forma_pago_check
    check (forma_pago is null or forma_pago in ('efectivo','transferencia','cheque','debito','otro'));
exception when duplicate_object then null; end $$;

comment on column public.egresos.forma_pago is
  'Forma de pago del egreso (mig 155). Solo la llenan los pagos a proveedores (compra directa / fn_pagar_cuenta).';
comment on column public.egresos.comprobante is
  'N° de comprobante del pago: transferencia, cheque u operación (mig 155).';

-- ─────────────────────────────────────────────────────────────────────
-- 1b. Backfill: pto/número históricos al formato AFIP (00001 / 00012345).
--     Hasta ahora las tres puertas guardaban lo tipeado tal cual ("1",
--     "0001", "1234"...); de acá en más todo lo nuevo viaja normalizado y el
--     índice único / los anti-duplicados comparan texto exacto → sin esto,
--     una factura ya cargada como "1-1234" no cruzaría contra "00001-00001234".
--     Idempotente. Se saltean (quedan como están, para revisar a mano) las
--     filas cuya versión normalizada colisionaría con otra fila del mismo
--     CUIT+tipo, y las que tienen más dígitos que el formato (no se truncan).
-- ─────────────────────────────────────────────────────────────────────
with norm as (
  select id, cuit_proveedor, tipo_comprobante,
         lpad(regexp_replace(punto_venta, '\D', '', 'g'), 5, '0') as pto,
         lpad(regexp_replace(numero_comprobante, '\D', '', 'g'), 8, '0') as nro
    from public.facturas_compra
   where punto_venta ~ '\d' and numero_comprobante ~ '\d'
     and length(regexp_replace(punto_venta, '\D', '', 'g')) between 1 and 5
     and length(regexp_replace(numero_comprobante, '\D', '', 'g')) between 1 and 8
)
update public.facturas_compra f
   set punto_venta = n.pto,
       numero_comprobante = n.nro
  from norm n
 where n.id = f.id
   and (f.punto_venta <> n.pto or f.numero_comprobante <> n.nro)
   -- no pisar una fila ya normalizada con la misma clave
   and not exists (
     select 1 from public.facturas_compra g
      where g.id <> f.id
        and g.cuit_proveedor is not distinct from f.cuit_proveedor
        and g.tipo_comprobante is not distinct from f.tipo_comprobante
        and g.punto_venta = n.pto and g.numero_comprobante = n.nro
   )
   -- ni dos filas sin normalizar que normalicen a la misma clave
   and not exists (
     select 1 from norm m
      where m.id <> n.id
        and m.cuit_proveedor is not distinct from n.cuit_proveedor
        and m.tipo_comprobante is not distinct from n.tipo_comprobante
        and m.pto = n.pto and m.nro = n.nro
   );

-- ─────────────────────────────────────────────────────────────────────
-- 2. fn_registrar_compra_directa v3 — misma firma de 11 args (mig 149)
-- ─────────────────────────────────────────────────────────────────────
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

-- ─────────────────────────────────────────────────────────────────────
-- 3. fn_pagar_cuenta v7 — = v6 (mig 148) + forma/comprobante en el egreso
--    y en el texto del movimiento. Misma firma de 8 args → REPLACE limpio.
--    SIN guard de comprobante (fn_ejecutar_pago_programado la llama con
--    programados que pueden no tener número).
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_pagar_cuenta(
  p_cuenta_id integer,
  p_usuario_id uuid,
  p_cuenta_origen_id integer,
  p_monto numeric,
  p_fecha date default null,
  p_nota text default null,
  p_forma_pago text default null,
  p_comprobante text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Fecha "hoy" del NEGOCIO (La Rioja), no la UTC del server (mig 147).
  v_hoy date := (now() at time zone 'America/Argentina/La_Rioja')::date;
  v_monto numeric;
  v_pagado numeric;
  v_aplicado numeric;
  v_pendiente numeric;
  v_aplica numeric;
  v_sobrante numeric;
  v_residuo numeric := 0;
  v_pedido_id integer;
  v_estado text;
  v_proveedor text;
  v_fecha date;
  v_tipo_cuenta text;
  v_es_boveda boolean;
  v_saldo numeric;
  v_saldo_nuevo numeric;
  v_mov_id integer;
  v_egreso_id integer;
  v_pago_id integer;
  v_asiento_id integer;
  v_cta_prov integer;
  v_cta_dif integer;
  v_cta_haber integer;
  v_nuevo_pagado numeric;
  v_completa boolean;
  v_orden integer := 0;
  -- v7: sufijo con el comprobante para la descripción del movimiento/egreso
  v_comprobante text := nullif(btrim(coalesce(p_comprobante, '')), '');
  v_sufijo_pago text := '';
begin
  v_fecha := coalesce(p_fecha, v_hoy);

  -- Guards v3 (consistentes con fn_crear_egreso v2, mig 120).
  if not (select public.fn_tiene_permiso('finanzas')) then
    raise exception 'No tenés permiso para registrar pagos a proveedores.';
  end if;
  if public.fn_periodo_cerrado(v_fecha) then
    raise exception 'El período de ese pago está cerrado; no se puede registrar.';
  end if;
  if p_forma_pago is not null and p_forma_pago not in
     ('efectivo','transferencia','cheque','debito','otro') then
    raise exception 'Forma de pago inválida.';
  end if;
  if v_comprobante is not null then
    v_sufijo_pago := ' · ' || case p_forma_pago
      when 'transferencia' then 'Transferencia '
      when 'cheque' then 'Cheque '
      when 'debito' then 'Débito op. '
      else 'Comp. ' end || v_comprobante;
  end if;

  -- Datos de la deuda
  select c.monto, coalesce(c.monto_pagado, 0), c.pedido_id, c.estado, p.nombre
    into v_monto, v_pagado, v_pedido_id, v_estado, v_proveedor
    from public.cuentas_a_pagar c
    left join public.proveedores p on p.id = c.proveedor_id
    where c.id = p_cuenta_id
    for update of c;  -- solo bloquea cuentas_a_pagar; FOR UPDATE no admite el lado nullable del LEFT JOIN
  if v_monto is null then
    raise exception 'La cuenta no existe.';
  end if;
  if v_estado = 'pagada' then
    raise exception 'Esta cuenta ya está pagada.';
  end if;

  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto del pago debe ser mayor a 0.';
  end if;

  -- Aplicado real a la deuda = Σ(monto − sobrante) del historial.
  select coalesce(sum(monto - coalesce(sobrante, 0)), 0) into v_aplicado
    from public.pagos_cuenta where cuenta_a_pagar_id = p_cuenta_id;
  if v_aplicado = 0 and v_pagado > 0 then
    v_aplicado := v_pagado;  -- compat con pagos legacy sin fila en pagos_cuenta
  end if;

  -- SOBREPAGO (v3): lo que excede el pendiente se registra como diferencia
  -- por redondeo (Debe 5.2.10) y la deuda queda saldada.
  v_pendiente := greatest(v_monto - v_aplicado, 0);
  v_aplica := least(p_monto, v_pendiente);
  v_sobrante := round(p_monto - v_aplica, 2);
  if v_sobrante <= 0.009 then
    -- Tolerancia de centavos (misma que la v2): todo aplica a la deuda.
    v_sobrante := 0;
    v_aplica := p_monto;
  end if;
  if v_aplica <= 0 then
    raise exception 'La deuda ya está cubierta; no hay saldo pendiente que pagar.';
  end if;

  -- CONDONACIÓN (v4): si tras aplicar TODO el pago queda un residuo de hasta
  -- $1 (centavos de redondeo cliente/servidor, o facturas que no dan exacto),
  -- se condona contra 5.2.10 y la deuda cierra sola. Un pago parcial de
  -- verdad (residuo > $1) no se toca.
  v_residuo := round(v_monto - (v_aplicado + v_aplica), 2);
  if v_residuo <= 0.009 or v_residuo > 1.00 then
    v_residuo := 0;
  end if;

  -- Cuenta de tesorería de origen
  select tipo, coalesce(es_caja_fuerte, false), saldo_actual
    into v_tipo_cuenta, v_es_boveda, v_saldo
    from public.cuentas where id = p_cuenta_origen_id for update;
  if v_saldo is null then
    raise exception 'La cuenta de origen del pago no existe.';
  end if;

  v_saldo_nuevo := v_saldo - p_monto;

  -- Guard de negativo SOLO para la bóveda (como fn_crear_egreso v2 / mig 122).
  if v_es_boveda and v_saldo_nuevo < 0 then
    raise exception 'El pago deja la caja fuerte en negativo (saldo actual %).', v_saldo;
  end if;

  -- 1) Movimiento de egreso en la cuenta de origen (baja saldo).
  --    ⚠ referencia_tipo 'cuenta_a_pagar' NO se toca: getSaldoCajaFuerte netea
  --    el circuito de la bóveda con ('egreso','cuenta_a_pagar') exactos.
  --    v7: el comprobante va en la descripción para que se vea al conciliar.
  insert into public.movimientos_cuenta (
    cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo,
    descripcion, categoria, referencia_tipo, referencia_id, usuario_id, fecha
  ) values (
    p_cuenta_origen_id, 'egreso', p_monto, v_saldo, v_saldo_nuevo,
    'Pago a ' || coalesce(v_proveedor, 'proveedor') || ' · cuenta #' || p_cuenta_id || v_sufijo_pago,
    'pago_proveedores', 'cuenta_a_pagar', p_cuenta_id, p_usuario_id, v_fecha
  )
  returning id into v_mov_id;

  update public.cuentas
    set saldo_actual = v_saldo_nuevo, updated_at = now()
    where id = p_cuenta_origen_id;

  -- 2) Egreso (para P&L; excluido del resumen como pago de mercadería).
  --    v7: + forma_pago / comprobante estructurados (mig 155).
  insert into public.egresos (
    descripcion, monto, categoria, fecha, usuario_id, turno_id, cuenta_id,
    forma_pago, comprobante
  )
  values (
    'Pago a ' || coalesce(v_proveedor, 'proveedor')
      || case when v_pedido_id is not null then ' (pedido #' || v_pedido_id || ')' else '' end
      || v_sufijo_pago,
    p_monto, 'pago_proveedores', v_fecha, p_usuario_id, null, p_cuenta_origen_id,
    p_forma_pago, v_comprobante
  )
  returning id into v_egreso_id;

  -- 3) Asiento: Debe Proveedores por lo APLICADO (+ residuo condonado) +
  --    Debe Diferencias por el sobrante / Haber cuenta por el monto REAL
  --    (+ Haber Diferencias por el residuo condonado).
  select id into v_cta_prov from public.plan_cuentas where codigo = '2.1.01';
  select id into v_cta_dif from public.plan_cuentas where codigo = '5.2.10';
  v_cta_haber := case v_tipo_cuenta
    when 'caja' then (select id from public.plan_cuentas where codigo = '1.1.01')
    else (select id from public.plan_cuentas where codigo = '1.1.02')  -- banco / billetera
  end;
  if (v_sobrante > 0 or v_residuo > 0) and v_cta_dif is null then
    raise exception 'Falta la cuenta 5.2.10 Diferencias por Pagos y Redondeos en el plan.';
  end if;
  if v_cta_prov is not null and v_cta_haber is not null then
    insert into public.asientos (fecha, descripcion, tipo, origen, referencia_id, usuario_id)
    values (v_fecha, 'Pago cuenta #' || p_cuenta_id || ' · ' || coalesce(v_proveedor, 'proveedor'),
            'automatico', 'egreso', v_egreso_id, p_usuario_id)
    returning id into v_asiento_id;
    insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
    values (v_asiento_id, v_cta_prov, v_aplica, 0, v_orden);
    v_orden := v_orden + 1;
    if v_sobrante > 0 then
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_dif, v_sobrante, 0, v_orden);
      v_orden := v_orden + 1;
    end if;
    insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
    values (v_asiento_id, v_cta_haber, 0, p_monto, v_orden);
    v_orden := v_orden + 1;
    -- Condonación del residuo (v4): cierra 2.1.01 exacto contra lo acreditado
    -- por la factura; la contra-parte es un Haber en Diferencias (ganancia
    -- por redondeo). Σdebe = aplica + residuo = Σhaber = monto + residuo.
    if v_residuo > 0 then
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_prov, v_residuo, 0, v_orden);
      v_orden := v_orden + 1;
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_dif, 0, v_residuo, v_orden);
    end if;
  end if;

  -- 4) Registrar el pago en el historial (v4: + pago_id de retorno)
  insert into public.pagos_cuenta (
    cuenta_a_pagar_id, cuenta_origen_id, monto, fecha, nota,
    usuario_id, movimiento_id, egreso_id, forma_pago, comprobante, sobrante
  ) values (
    p_cuenta_id, p_cuenta_origen_id, p_monto, v_fecha, p_nota,
    p_usuario_id, v_mov_id, v_egreso_id, p_forma_pago, v_comprobante, v_sobrante
  )
  returning id into v_pago_id;

  -- 5) Acumular y cerrar. monto_pagado = plata REAL que salió; la deuda se
  --    considera cubierta con lo APLICADO + el residuo condonado.
  v_nuevo_pagado := v_pagado + p_monto;
  v_completa := (v_aplicado + v_aplica + v_residuo) >= v_monto - 0.009;
  update public.cuentas_a_pagar
    set monto_pagado = v_nuevo_pagado,
        estado = case when v_completa then 'pagada'::public.estado_cuenta_pagar else estado end,
        fecha_pago = case when v_completa then v_fecha else fecha_pago end
    where id = p_cuenta_id;

  -- 6) v6 (mig 148): con plan de cuotas, el vencimiento del padre pasa a la
  --    próxima cuota impaga (solo si la deuda no quedó saldada).
  if not v_completa then
    perform public.fn_sync_vencimiento_cuotas(p_cuenta_id);
  end if;

  return jsonb_build_object(
    'pagado', p_monto,
    'aplicado', v_aplica,
    'sobrante', v_sobrante,
    'condonado', v_residuo,
    'pago_id', v_pago_id,
    'monto_pagado_total', v_nuevo_pagado,
    'pendiente', greatest(v_monto - (v_aplicado + v_aplica + v_residuo), 0),
    'completa', v_completa,
    'movimiento_id', v_mov_id
  );
end;
$$;

revoke execute on function public.fn_pagar_cuenta(integer, uuid, integer, numeric, date, text, text, text) from public, anon;
grant execute on function public.fn_pagar_cuenta(integer, uuid, integer, numeric, date, text, text, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 4. fn_ejecutar_pago_programado v3 — + p_comprobante. LA FIRMA CAMBIA
--    (2 → 3 args) → drop explícito de la de 2 args primero.
-- ─────────────────────────────────────────────────────────────────────
drop function if exists public.fn_ejecutar_pago_programado(integer, uuid);

create or replace function public.fn_ejecutar_pago_programado(
  p_programado_id integer,
  p_usuario_id uuid,
  p_comprobante text default null  -- v3: n° de transferencia/cheque/operación cargado al ejecutar
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hoy date := (now() at time zone 'America/Argentina/La_Rioja')::date;
  v_prog public.pagos_programados;
  v_comprobante text;
  v_res jsonb;
begin
  select * into v_prog from public.pagos_programados
    where id = p_programado_id for update;
  if not found then
    raise exception 'El pago programado no existe.';
  end if;
  if v_prog.estado <> 'pendiente' then
    raise exception 'Este pago programado ya fue %.', v_prog.estado;
  end if;
  if v_prog.cuenta_origen_id is null then
    raise exception 'El pago programado no tiene cuenta de origen.';
  end if;

  -- v3: el comprobante de la ejecución pisa al que pudiera haber quedado al
  -- programar; queda también en la fila del programado (trazabilidad).
  v_comprobante := coalesce(nullif(btrim(coalesce(p_comprobante, '')), ''), v_prog.comprobante);
  if v_comprobante is distinct from v_prog.comprobante then
    update public.pagos_programados set comprobante = v_comprobante
      where id = p_programado_id;
  end if;

  -- La plata sale HOY (hora local del negocio, mig 147), no en la fecha
  -- programada. fn_pagar_cuenta valida permiso/período/bóveda y condona
  -- residuos si corresponde.
  v_res := public.fn_pagar_cuenta(
    v_prog.cuenta_a_pagar_id,
    p_usuario_id,
    v_prog.cuenta_origen_id,
    v_prog.monto,
    v_hoy,
    v_prog.nota,
    v_prog.forma_pago,
    v_comprobante
  );

  update public.pagos_programados
    set estado = 'ejecutado',
        ejecutado_at = now(),
        pago_id = nullif(v_res->>'pago_id', '')::integer
    where id = p_programado_id;

  return v_res || jsonb_build_object('programado_id', p_programado_id);
end;
$$;

revoke execute on function public.fn_ejecutar_pago_programado(integer, uuid, text) from public, anon;
grant execute on function public.fn_ejecutar_pago_programado(integer, uuid, text) to authenticated;

notify pgrst, 'reload schema';

-- Verificación post-migración (correr aparte):
--   select proname, count(*) from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname = 'public' and proname like 'fn_%'
--     group by proname having count(*) > 1;   → debe dar 0 filas
--   select column_name from information_schema.columns
--     where table_name = 'egresos' and column_name in ('forma_pago','comprobante');  → 2 filas
