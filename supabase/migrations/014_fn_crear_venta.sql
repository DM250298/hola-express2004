-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 014 · FASE 0 — Operación atómica: crear venta            ║
-- ║                                                                     ║
-- ║  Toda la venta (cabecera, pagos, movimientos de cuenta, items,      ║
-- ║  stock y descuento FIFO de lotes) ocurre dentro de UNA función      ║
-- ║  transaccional. Si algo falla, NO queda nada a medias.              ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

create or replace function public.fn_crear_venta(
  p_turno_id integer,
  p_usuario_id uuid,
  p_pagos jsonb,
  p_items jsonb
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
  -- pago
  v_medio text;
  v_monto numeric;
  v_cuenta_id integer;
  v_comision numeric;
  v_comision_monto numeric;
  v_saldo numeric;
  v_saldo_nuevo numeric;
  -- item
  v_prod_id integer;
  v_cantidad integer;
  v_precio numeric;
  v_stock_ant integer;
  v_stock_nuevo integer;
  -- lotes
  v_lote record;
  v_restante integer;
  v_usar integer;
begin
  if p_pagos is null or jsonb_array_length(p_pagos) = 0 then
    raise exception 'La venta debe tener al menos un pago.';
  end if;

  -- Total de la venta
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_total := v_total
      + (v_item->>'precio_unitario')::numeric * (v_item->>'cantidad')::integer;
  end loop;

  -- Medio principal = pago de mayor monto
  select p->>'medio_pago' into v_medio_principal
  from jsonb_array_elements(p_pagos) p
  order by (p->>'monto')::numeric desc
  limit 1;

  -- 1. Cabecera de la venta
  insert into public.ventas (turno_id, usuario_id, total, medio_pago, estado)
  values (p_turno_id, p_usuario_id, v_total, v_medio_principal, 'completada')
  returning * into v_venta;

  -- 2. Pagos (split payment)
  for v_pago in select * from jsonb_array_elements(p_pagos) loop
    insert into public.pagos_venta (venta_id, medio_pago, monto)
    values (
      v_venta.id,
      v_pago->>'medio_pago',
      (v_pago->>'monto')::numeric
    );
  end loop;

  -- 3. Reflejar los pagos en las cuentas configuradas
  for v_pago in select * from jsonb_array_elements(p_pagos) loop
    v_medio := v_pago->>'medio_pago';
    v_monto := (v_pago->>'monto')::numeric;

    select cuenta_id, coalesce(comision_porcentaje, 0)
      into v_cuenta_id, v_comision
      from public.medios_pago where codigo = v_medio;

    if v_cuenta_id is null then
      continue;
    end if;

    select saldo_actual into v_saldo
      from public.cuentas where id = v_cuenta_id for update;
    if v_saldo is null then
      continue;
    end if;

    -- Ingreso por el monto del pago
    v_saldo_nuevo := v_saldo + v_monto;
    insert into public.movimientos_cuenta (
      cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo,
      descripcion, categoria, referencia_tipo, referencia_id, usuario_id, fecha
    ) values (
      v_cuenta_id, 'ingreso', v_monto, v_saldo, v_saldo_nuevo,
      'Venta #' || v_venta.id || ' · ' || v_medio,
      'venta', 'venta', v_venta.id, p_usuario_id, v_hoy
    );

    -- Egreso por la comisión bancaria (si aplica)
    v_comision_monto := round(v_monto * v_comision) / 100;
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

    update public.cuentas
      set saldo_actual = v_saldo_nuevo, updated_at = v_ahora
      where id = v_cuenta_id;
  end loop;

  -- 4. Items + stock + movimientos + descuento FIFO de lotes
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_prod_id := (v_item->>'producto_id')::integer;
    v_cantidad := (v_item->>'cantidad')::integer;
    v_precio := (v_item->>'precio_unitario')::numeric;

    select stock_actual into v_stock_ant
      from public.productos where id = v_prod_id for update;
    v_stock_ant := coalesce(v_stock_ant, 0);
    v_stock_nuevo := v_stock_ant - v_cantidad;

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

    -- FIFO: descuenta de los lotes que vencen antes
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
            estado = case
              when v_lote.cantidad_actual - v_usar = 0 then 'agotado'
              else 'activo'
            end
        where id = v_lote.id;
      v_restante := v_restante - v_usar;
    end loop;
  end loop;

  return v_venta;
end;
$$;

notify pgrst, 'reload schema';
