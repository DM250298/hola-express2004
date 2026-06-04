-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 048: retención de Ingresos Brutos por cuenta            ║
-- ║                                                                     ║
-- ║  Agrega `cuentas.retencion_iibb_porcentaje` y modifica las RPCs    ║
-- ║  de venta y acreditación para descontar el IIBB del saldo de la    ║
-- ║  cuenta destino, en paralelo a la comisión del medio de pago.      ║
-- ║                                                                     ║
-- ║  Por qué a nivel cuenta y no a nivel medio:                        ║
-- ║   · La tasa de IIBB que aplica el agente de retención (ej: MP)     ║
-- ║     depende de la inscripción del comercio, no de la tarjeta.      ║
-- ║   · Es una sola tasa por cuenta → un único campo a mantener.       ║
-- ║                                                                     ║
-- ║  Bonus: este script consolida fn_crear_venta. Hoy puede haber dos  ║
-- ║  versiones en la DB (4-arg y 6-arg) por la gotcha de Postgres      ║
-- ║  "CREATE OR REPLACE no pisa firmas distintas". Se dropean ambas    ║
-- ║  y se crea una única canónica con clearing digital + IIBB.         ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────────────────────
-- 1. Columna en cuentas
-- ─────────────────────────────────────────────────────────────────────
alter table public.cuentas
  add column if not exists retencion_iibb_porcentaje numeric(5,2) not null default 0;

comment on column public.cuentas.retencion_iibb_porcentaje is
  'Tasa de retención de IIBB que el agente de retención (ej: MP) aplica sobre cada ingreso a esta cuenta. Ej: 3.00 = 3%. Se descuenta automáticamente del saldo al registrar la venta, igual que la comisión.';

-- ─────────────────────────────────────────────────────────────────────
-- 2. Dropear ambas versiones legacy de fn_crear_venta
-- ─────────────────────────────────────────────────────────────────────
drop function if exists public.fn_crear_venta(integer, uuid, jsonb, jsonb);
drop function if exists public.fn_crear_venta(integer, uuid, jsonb, jsonb, uuid, integer);

-- ─────────────────────────────────────────────────────────────────────
-- 3. fn_crear_venta v4 — canónica: cliente_uuid + clearing + IIBB
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_crear_venta(
  p_turno_id integer,
  p_usuario_id uuid,
  p_pagos jsonb,
  p_items jsonb,
  p_cliente_uuid uuid default null,
  p_cliente_id integer default null
) returns public.ventas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total numeric := 0;
  v_medio_principal text;
  v_venta public.ventas;
  v_hoy date := current_date;
  v_ahora timestamptz := now();
  v_pago jsonb;
  v_item jsonb;
  v_medio text;
  v_monto numeric;
  v_cuenta_id integer;
  v_comision numeric;
  v_comision_monto numeric;
  v_iibb_pct numeric;
  v_iibb_monto numeric;
  v_dias_acred integer;
  v_pago_venta_id integer;
  v_saldo numeric;
  v_saldo_nuevo numeric;
  v_prod_id integer;
  v_cantidad integer;
  v_precio numeric;
  v_stock_ant integer;
  v_stock_nuevo integer;
  v_lote record;
  v_restante integer;
  v_usar integer;
  v_costo_unit numeric;
  v_total_costo numeric := 0;
  v_pagos_no_efec numeric := 0;
  v_neto numeric;
  v_iva numeric;
  v_efectivo numeric;
  v_no_efec numeric;
  v_asiento_id integer;
  v_orden integer := 0;
  v_cta_ventas integer;
  v_cta_iva integer;
  v_cta_caja integer;
  v_cta_banco integer;
  v_cta_cmv integer;
  v_cta_merc integer;
begin
  -- Idempotencia para reenvíos offline
  if p_cliente_uuid is not null then
    select * into v_venta from public.ventas
      where cliente_uuid = p_cliente_uuid;
    if found then
      return v_venta;
    end if;
  end if;

  if p_pagos is null or jsonb_array_length(p_pagos) = 0 then
    raise exception 'La venta debe tener al menos un pago.';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_total := v_total
      + (v_item->>'precio_unitario')::numeric * (v_item->>'cantidad')::numeric;
  end loop;

  select p->>'medio_pago' into v_medio_principal
  from jsonb_array_elements(p_pagos) p
  order by (p->>'monto')::numeric desc
  limit 1;

  insert into public.ventas
    (turno_id, usuario_id, total, medio_pago, estado, cliente_uuid, cliente_id)
  values
    (p_turno_id, p_usuario_id, v_total, v_medio_principal, 'completada',
     p_cliente_uuid, p_cliente_id)
  returning * into v_venta;

  for v_pago in select * from jsonb_array_elements(p_pagos) loop
    insert into public.pagos_venta (venta_id, medio_pago, monto)
    values (v_venta.id, v_pago->>'medio_pago', (v_pago->>'monto')::numeric)
    returning id into v_pago_venta_id;

    v_medio := v_pago->>'medio_pago';
    v_monto := (v_pago->>'monto')::numeric;

    if v_medio <> 'efectivo' then
      v_pagos_no_efec := v_pagos_no_efec + v_monto;
    end if;

    select cuenta_id, coalesce(comision_porcentaje, 0),
           coalesce(dias_acreditacion, 0)
      into v_cuenta_id, v_comision, v_dias_acred
      from public.medios_pago where codigo = v_medio;
    if v_cuenta_id is null then
      continue;
    end if;

    v_comision_monto := round(v_monto * v_comision) / 100;

    -- IIBB se calcula sobre el bruto, según la tasa de la cuenta destino
    select coalesce(retencion_iibb_porcentaje, 0)
      into v_iibb_pct
      from public.cuentas where id = v_cuenta_id;
    v_iibb_monto := round(v_monto * v_iibb_pct) / 100;

    -- BIFURCACIÓN: con plazo (clearing) vs acreditación inmediata
    if v_dias_acred > 0 then
      -- Acreditación pendiente: NO toca saldo. IIBB se descontará al
      -- acreditarse, en fn_acreditar_pago. El monto_neto guardado acá
      -- es solo bruto − comisión; la retención de IIBB se aplica recién
      -- cuando la plata efectivamente entra al banco.
      insert into public.acreditaciones (
        venta_id, pago_venta_id, medio_pago, cuenta_id,
        monto_bruto, comision_pct, comision_monto, monto_neto,
        fecha_venta, fecha_estimada, estado, usuario_id
      ) values (
        v_venta.id, v_pago_venta_id, v_medio, v_cuenta_id,
        v_monto, v_comision, v_comision_monto, v_monto - v_comision_monto,
        v_hoy, v_hoy + v_dias_acred, 'pendiente', p_usuario_id
      );
    else
      -- Acreditación inmediata: ingresa al banco, descuenta comisión y IIBB
      select saldo_actual into v_saldo
        from public.cuentas where id = v_cuenta_id for update;
      if v_saldo is null then
        continue;
      end if;
      v_saldo_nuevo := v_saldo + v_monto;
      insert into public.movimientos_cuenta (
        cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo,
        descripcion, categoria, referencia_tipo, referencia_id, usuario_id, fecha
      ) values (
        v_cuenta_id, 'ingreso', v_monto, v_saldo, v_saldo_nuevo,
        'Venta #' || v_venta.id || ' · ' || v_medio,
        'venta', 'venta', v_venta.id, p_usuario_id, v_hoy
      );
      if v_comision_monto > 0 then
        insert into public.movimientos_cuenta (
          cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo,
          descripcion, categoria, referencia_tipo, referencia_id, usuario_id, fecha
        ) values (
          v_cuenta_id, 'egreso', v_comision_monto,
          v_saldo_nuevo, v_saldo_nuevo - v_comision_monto,
          'Comisión ' || v_medio || ' (' || v_comision || '%) · Venta #' || v_venta.id,
          'comisiones', 'venta', v_venta.id, p_usuario_id, v_hoy
        );
        v_saldo_nuevo := v_saldo_nuevo - v_comision_monto;
      end if;
      if v_iibb_monto > 0 then
        insert into public.movimientos_cuenta (
          cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo,
          descripcion, categoria, referencia_tipo, referencia_id, usuario_id, fecha
        ) values (
          v_cuenta_id, 'egreso', v_iibb_monto,
          v_saldo_nuevo, v_saldo_nuevo - v_iibb_monto,
          'Retención IIBB (' || v_iibb_pct || '%) · Venta #' || v_venta.id,
          'iibb', 'venta', v_venta.id, p_usuario_id, v_hoy
        );
        v_saldo_nuevo := v_saldo_nuevo - v_iibb_monto;
      end if;
      update public.cuentas
        set saldo_actual = v_saldo_nuevo, updated_at = v_ahora
        where id = v_cuenta_id;
    end if;
  end loop;

  -- Items + stock + lotes + costo
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_prod_id := (v_item->>'producto_id')::integer;
    v_cantidad := (v_item->>'cantidad')::integer;
    v_precio := (v_item->>'precio_unitario')::numeric;

    select stock_actual, coalesce(precio_costo, 0)
      into v_stock_ant, v_costo_unit
      from public.productos where id = v_prod_id for update;
    v_stock_ant := coalesce(v_stock_ant, 0);
    v_stock_nuevo := v_stock_ant - v_cantidad;
    v_total_costo := v_total_costo + v_costo_unit * v_cantidad;

    insert into public.items_venta
      (venta_id, producto_id, cantidad, precio_unitario, subtotal)
    values
      (v_venta.id, v_prod_id, v_cantidad, v_precio, v_precio * v_cantidad);

    update public.productos
      set stock_actual = v_stock_nuevo, updated_at = v_ahora
      where id = v_prod_id;

    insert into public.movimientos_stock (
      producto_id, tipo, cantidad, stock_anterior, stock_nuevo,
      referencia_id, usuario_id, nota
    ) values (
      v_prod_id, 'venta', v_cantidad, v_stock_ant, v_stock_nuevo,
      v_venta.id, p_usuario_id, 'Venta #' || v_venta.id
    );

    v_restante := v_cantidad;
    for v_lote in
      select id, cantidad_actual
        from public.lotes
        where producto_id = v_prod_id
          and estado = 'activo'
          and cantidad_actual > 0
        order by fecha_vencimiento asc
        for update
    loop
      exit when v_restante <= 0;
      v_usar := least(v_lote.cantidad_actual, v_restante);
      update public.lotes
        set cantidad_actual = v_lote.cantidad_actual - v_usar,
            estado = (case
              when v_lote.cantidad_actual - v_usar = 0 then 'agotado'
              else 'activo'
            end)::estado_lote
        where id = v_lote.id;
      v_restante := v_restante - v_usar;
    end loop;
  end loop;

  -- Asiento contable automático (sin cambios respecto a v3)
  select id into v_cta_ventas from public.plan_cuentas where codigo = '4.1.01';
  select id into v_cta_iva from public.plan_cuentas where codigo = '2.1.02';
  select id into v_cta_caja from public.plan_cuentas where codigo = '1.1.01';
  select id into v_cta_banco from public.plan_cuentas where codigo = '1.1.02';
  select id into v_cta_cmv from public.plan_cuentas where codigo = '5.1.01';
  select id into v_cta_merc from public.plan_cuentas where codigo = '1.1.04';

  if v_total > 0 and v_cta_ventas is not null and v_cta_iva is not null
     and v_cta_caja is not null and v_cta_banco is not null then
    v_neto := round(v_total / 1.21, 2);
    v_iva := round(v_total - v_neto, 2);
    v_no_efec := least(v_pagos_no_efec, v_total);
    v_efectivo := v_total - v_no_efec;

    insert into public.asientos (fecha, descripcion, tipo, origen, referencia_id, usuario_id)
    values (v_hoy, 'Venta #' || v_venta.id, 'automatico', 'venta', v_venta.id, p_usuario_id)
    returning id into v_asiento_id;

    if v_efectivo > 0 then
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_caja, v_efectivo, 0, v_orden);
      v_orden := v_orden + 1;
    end if;
    if v_no_efec > 0 then
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_banco, v_no_efec, 0, v_orden);
      v_orden := v_orden + 1;
    end if;
    insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
    values (v_asiento_id, v_cta_ventas, 0, v_neto, v_orden);
    v_orden := v_orden + 1;
    insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
    values (v_asiento_id, v_cta_iva, 0, v_iva, v_orden);
    v_orden := v_orden + 1;

    if v_cta_cmv is not null and v_cta_merc is not null and v_total_costo > 0 then
      v_total_costo := round(v_total_costo, 2);
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_cmv, v_total_costo, 0, v_orden);
      v_orden := v_orden + 1;
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_merc, 0, v_total_costo, v_orden);
    end if;
  end if;

  return v_venta;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 4. fn_acreditar_pago v2 — descuenta IIBB sobre el monto bruto al
--    acreditarse una venta con plazo (clearing digital).
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_acreditar_pago(
  p_acreditacion_id integer,
  p_usuario_id uuid,
  p_fecha_real date
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_acred record;
  v_saldo_ant numeric;
  v_saldo_nuevo numeric;
  v_mov_id integer;
  v_iibb_pct numeric;
  v_iibb_monto numeric;
  v_fecha date := coalesce(p_fecha_real, current_date);
begin
  select * into v_acred from public.acreditaciones
    where id = p_acreditacion_id for update;
  if not found then
    raise exception 'La acreditación no existe.';
  end if;
  if v_acred.estado <> 'pendiente' then
    raise exception 'La acreditación ya está en estado %.', v_acred.estado;
  end if;
  if v_acred.cuenta_id is null then
    raise exception 'No hay cuenta bancaria asociada al medio de pago.';
  end if;

  -- IIBB de la cuenta destino, sobre el bruto original de la venta
  select coalesce(retencion_iibb_porcentaje, 0)
    into v_iibb_pct
    from public.cuentas where id = v_acred.cuenta_id;
  v_iibb_monto := round(v_acred.monto_bruto * v_iibb_pct) / 100;

  select saldo_actual into v_saldo_ant
    from public.cuentas where id = v_acred.cuenta_id for update;
  v_saldo_nuevo := v_saldo_ant + v_acred.monto_neto;

  insert into public.movimientos_cuenta (
    cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo,
    descripcion, categoria, referencia_tipo, referencia_id, usuario_id, fecha
  ) values (
    v_acred.cuenta_id, 'ingreso', v_acred.monto_neto, v_saldo_ant, v_saldo_nuevo,
    'Acreditación ' || v_acred.medio_pago || ' · Venta #' || v_acred.venta_id ||
      ' (neto, comisión ' || v_acred.comision_pct || '%)',
    'acreditacion', 'acreditacion', v_acred.id, p_usuario_id, v_fecha
  )
  returning id into v_mov_id;

  if v_iibb_monto > 0 then
    insert into public.movimientos_cuenta (
      cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo,
      descripcion, categoria, referencia_tipo, referencia_id, usuario_id, fecha
    ) values (
      v_acred.cuenta_id, 'egreso', v_iibb_monto,
      v_saldo_nuevo, v_saldo_nuevo - v_iibb_monto,
      'Retención IIBB (' || v_iibb_pct || '%) · Acreditación #' || v_acred.id,
      'iibb', 'acreditacion', v_acred.id, p_usuario_id, v_fecha
    );
    v_saldo_nuevo := v_saldo_nuevo - v_iibb_monto;
  end if;

  update public.cuentas
    set saldo_actual = v_saldo_nuevo, updated_at = now()
    where id = v_acred.cuenta_id;

  update public.acreditaciones
    set estado = 'acreditada',
        fecha_real = v_fecha,
        movimiento_id = v_mov_id,
        updated_at = now()
    where id = p_acreditacion_id;

  return jsonb_build_object(
    'movimiento_id', v_mov_id,
    'monto_neto', v_acred.monto_neto,
    'iibb_retenido', v_iibb_monto,
    'saldo_nuevo', v_saldo_nuevo
  );
end;
$$;

notify pgrst, 'reload schema';
