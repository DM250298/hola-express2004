-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 046 · R0 — Correcciones de integridad financiera         ║
-- ║                                                                     ║
-- ║  Arregla descuadres detectados en la auditoría:                     ║
-- ║   V1 · Anular venta NO cancelaba las acreditaciones (clearing) →    ║
-- ║        se cobraban ventas anuladas. Ahora las cancela y revierte    ║
-- ║        el dinero si ya se había acreditado.                         ║
-- ║   V2 · Anular venta NO revertía el asiento contable. Ahora lo borra.║
-- ║   V3 · Anular venta NO restauraba los lotes. Ahora repone al lote   ║
-- ║        activo más nuevo del producto.                               ║
-- ║   C1 · Las comisiones de ventas a plazo no se registraban como      ║
-- ║        gasto. Ahora al acreditar entra el bruto y sale la comisión  ║
-- ║        (igual que en las ventas inmediatas).                        ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────────────────────
-- fn_anular_venta v2  (V1 + V2 + V3)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_anular_venta(
  p_venta_id integer,
  p_usuario_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_estado text;
  v_ahora timestamptz := now();
  v_hoy date := current_date;
  v_item record;
  v_mov record;
  v_stock_ant integer;
  v_stock_nuevo integer;
  v_saldo numeric;
  v_saldo_nuevo numeric;
  v_tipo_opuesto text;
  v_lote_id integer;
begin
  select estado into v_estado
    from public.ventas where id = p_venta_id for update;
  if v_estado is null then
    raise exception 'La venta no existe.';
  end if;
  if v_estado <> 'completada' then
    raise exception 'La venta ya estaba anulada.';
  end if;

  -- 2. Devolver el stock + restaurar lotes (V3)
  for v_item in
    select producto_id, cantidad
      from public.items_venta where venta_id = p_venta_id
  loop
    select stock_actual into v_stock_ant
      from public.productos where id = v_item.producto_id for update;
    if v_stock_ant is null then
      continue;
    end if;
    v_stock_nuevo := v_stock_ant + v_item.cantidad;
    update public.productos
      set stock_actual = v_stock_nuevo, updated_at = v_ahora
      where id = v_item.producto_id;
    insert into public.movimientos_stock (
      producto_id, tipo, cantidad, stock_anterior, stock_nuevo,
      referencia_id, usuario_id, nota
    ) values (
      v_item.producto_id, 'entrada', v_item.cantidad,
      v_stock_ant, v_stock_nuevo, p_venta_id, p_usuario_id,
      'Anulación venta #' || p_venta_id
    );

    -- V3: reponer al lote activo/agotado más nuevo (si el producto usa lotes)
    select id into v_lote_id
      from public.lotes
      where producto_id = v_item.producto_id
        and estado in ('activo', 'agotado')
      order by fecha_vencimiento desc, id desc
      limit 1;
    if v_lote_id is not null then
      update public.lotes
        set cantidad_actual = cantidad_actual + v_item.cantidad,
            estado = 'activo'
        where id = v_lote_id;
    end if;
  end loop;

  -- 3. Revertir movimientos de cuenta de la venta Y de sus acreditaciones (V1)
  for v_mov in
    select cuenta_id, tipo, monto
      from public.movimientos_cuenta
      where tipo in ('ingreso', 'egreso')
        and (
          (referencia_tipo = 'venta' and referencia_id = p_venta_id)
          or (referencia_tipo = 'acreditacion' and referencia_id in (
                select id from public.acreditaciones where venta_id = p_venta_id
             ))
        )
  loop
    v_tipo_opuesto := case
      when v_mov.tipo = 'ingreso' then 'egreso' else 'ingreso'
    end;
    select saldo_actual into v_saldo
      from public.cuentas where id = v_mov.cuenta_id for update;
    if v_saldo is null then
      continue;
    end if;
    v_saldo_nuevo := case
      when v_tipo_opuesto = 'ingreso' then v_saldo + v_mov.monto
      else v_saldo - v_mov.monto
    end;
    insert into public.movimientos_cuenta (
      cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo,
      descripcion, categoria, referencia_tipo, referencia_id, usuario_id, fecha
    ) values (
      v_mov.cuenta_id, v_tipo_opuesto, v_mov.monto, v_saldo, v_saldo_nuevo,
      'Anulación venta #' || p_venta_id, 'venta', 'venta',
      p_venta_id, p_usuario_id, v_hoy
    );
    update public.cuentas
      set saldo_actual = v_saldo_nuevo, updated_at = v_ahora
      where id = v_mov.cuenta_id;
  end loop;

  -- V1: cancelar las acreditaciones pendientes / acreditadas de esta venta
  update public.acreditaciones
    set estado = 'cancelada', updated_at = v_ahora
    where venta_id = p_venta_id and estado in ('pendiente', 'acreditada');

  -- V2: borrar el asiento contable automático de la venta
  delete from public.asientos
    where origen = 'venta' and referencia_id = p_venta_id;

  -- 4. Marcar la venta como anulada
  update public.ventas set estado = 'anulada' where id = p_venta_id;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- fn_acreditar_pago v2  (C1)
--   Al acreditar entra el BRUTO y sale la COMISIÓN (gasto), igual que en
--   las ventas inmediatas. Efecto neto sobre el saldo = monto neto.
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
  v_saldo numeric;
  v_mov_id integer;
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

  select saldo_actual into v_saldo_ant
    from public.cuentas where id = v_acred.cuenta_id for update;

  -- Ingreso por el monto bruto
  v_saldo := v_saldo_ant + v_acred.monto_bruto;
  insert into public.movimientos_cuenta (
    cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo,
    descripcion, categoria, referencia_tipo, referencia_id, usuario_id, fecha
  ) values (
    v_acred.cuenta_id, 'ingreso', v_acred.monto_bruto, v_saldo_ant, v_saldo,
    'Acreditación ' || v_acred.medio_pago || ' · Venta #' || v_acred.venta_id,
    'acreditacion', 'acreditacion', v_acred.id, p_usuario_id, v_fecha
  ) returning id into v_mov_id;

  -- Egreso por la comisión (queda registrada como gasto)
  if v_acred.comision_monto > 0 then
    insert into public.movimientos_cuenta (
      cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo,
      descripcion, categoria, referencia_tipo, referencia_id, usuario_id, fecha
    ) values (
      v_acred.cuenta_id, 'egreso', v_acred.comision_monto,
      v_saldo, v_saldo - v_acred.comision_monto,
      'Comisión ' || v_acred.medio_pago || ' (' || v_acred.comision_pct ||
        '%) · Venta #' || v_acred.venta_id,
      'comisiones', 'acreditacion', v_acred.id, p_usuario_id, v_fecha
    );
    v_saldo := v_saldo - v_acred.comision_monto;
  end if;

  update public.cuentas
    set saldo_actual = v_saldo, updated_at = now()
    where id = v_acred.cuenta_id;

  update public.acreditaciones
    set estado = 'acreditada', fecha_real = v_fecha,
        movimiento_id = v_mov_id, updated_at = now()
    where id = p_acreditacion_id;

  return jsonb_build_object(
    'movimiento_id', v_mov_id,
    'monto_neto', v_acred.monto_neto,
    'saldo_nuevo', v_saldo
  );
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- fn_aplicar_conciliacion v2  (C1 en el camino de conciliación)
--   Misma lógica: bruto ingreso + comisión egreso, ambos conciliados.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_aplicar_conciliacion(
  p_usuario_id uuid,
  p_cuenta_id integer,
  p_nombre_archivo text,
  p_lineas jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_extracto_id integer;
  v_linea jsonb;
  v_accion text;
  v_ref_id integer;
  v_estado text;
  v_match_tipo text;
  v_monto numeric;
  v_fecha date;
  v_total integer := 0;
  v_conciliadas integer := 0;
  v_anomalias integer := 0;
  v_monto_conc numeric := 0;
  v_acred record;
  v_saldo_ant numeric;
  v_saldo numeric;
  v_mov_id integer;
begin
  insert into public.extractos_bancarios (cuenta_id, usuario_id, nombre_archivo)
  values (p_cuenta_id, p_usuario_id, p_nombre_archivo)
  returning id into v_extracto_id;

  for v_linea in select * from jsonb_array_elements(p_lineas) loop
    v_total := v_total + 1;
    v_accion := coalesce(v_linea->>'accion', 'anomalia');
    v_ref_id := nullif(v_linea->>'ref_id', '')::integer;
    v_monto := (v_linea->>'monto')::numeric;
    v_fecha := nullif(v_linea->>'fecha', '')::date;
    v_estado := 'anomalia';
    v_match_tipo := null;

    if v_accion = 'acreditar' and v_ref_id is not null then
      select * into v_acred from public.acreditaciones
        where id = v_ref_id and estado = 'pendiente' for update;
      if found and v_acred.cuenta_id is not null then
        select saldo_actual into v_saldo_ant
          from public.cuentas where id = v_acred.cuenta_id for update;

        -- Ingreso bruto (conciliado)
        v_saldo := v_saldo_ant + v_acred.monto_bruto;
        insert into public.movimientos_cuenta (
          cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo,
          descripcion, categoria, referencia_tipo, referencia_id,
          usuario_id, fecha, conciliado, fecha_conciliacion
        ) values (
          v_acred.cuenta_id, 'ingreso', v_acred.monto_bruto, v_saldo_ant, v_saldo,
          'Acreditación ' || v_acred.medio_pago || ' · Venta #' || v_acred.venta_id ||
            ' (conciliada)',
          'acreditacion', 'acreditacion', v_acred.id,
          p_usuario_id, coalesce(v_fecha, current_date), true, now()
        ) returning id into v_mov_id;

        -- Egreso comisión (conciliado)
        if v_acred.comision_monto > 0 then
          insert into public.movimientos_cuenta (
            cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo,
            descripcion, categoria, referencia_tipo, referencia_id,
            usuario_id, fecha, conciliado, fecha_conciliacion
          ) values (
            v_acred.cuenta_id, 'egreso', v_acred.comision_monto,
            v_saldo, v_saldo - v_acred.comision_monto,
            'Comisión ' || v_acred.medio_pago || ' · Venta #' || v_acred.venta_id,
            'comisiones', 'acreditacion', v_acred.id,
            p_usuario_id, coalesce(v_fecha, current_date), true, now()
          );
          v_saldo := v_saldo - v_acred.comision_monto;
        end if;

        update public.cuentas
          set saldo_actual = v_saldo, updated_at = now()
          where id = v_acred.cuenta_id;

        update public.acreditaciones
          set estado = 'acreditada', fecha_real = coalesce(v_fecha, current_date),
              movimiento_id = v_mov_id, updated_at = now()
          where id = v_acred.id;

        v_estado := 'conciliada';
        v_match_tipo := 'acreditacion';
        v_conciliadas := v_conciliadas + 1;
        v_monto_conc := v_monto_conc + v_monto;
      end if;

    elsif v_accion = 'conciliar_mov' and v_ref_id is not null then
      update public.movimientos_cuenta
        set conciliado = true, fecha_conciliacion = now()
        where id = v_ref_id and conciliado = false;
      if found then
        v_estado := 'conciliada';
        v_match_tipo := 'movimiento';
        v_conciliadas := v_conciliadas + 1;
        v_monto_conc := v_monto_conc + v_monto;
      end if;

    elsif v_accion = 'ignorar' then
      v_estado := 'ignorada';
    end if;

    if v_estado = 'anomalia' then
      v_anomalias := v_anomalias + 1;
    end if;

    insert into public.lineas_extracto (
      extracto_id, fecha, descripcion, monto, id_externo,
      estado, match_tipo, match_id
    ) values (
      v_extracto_id, v_fecha, v_linea->>'descripcion', v_monto,
      nullif(v_linea->>'id_externo', ''),
      v_estado, v_match_tipo,
      case when v_estado = 'conciliada' then v_ref_id else null end
    );
  end loop;

  update public.extractos_bancarios
    set lineas_total = v_total, lineas_conciliadas = v_conciliadas,
        lineas_anomalia = v_anomalias, monto_conciliado = v_monto_conc
    where id = v_extracto_id;

  return jsonb_build_object(
    'extracto_id', v_extracto_id, 'total', v_total,
    'conciliadas', v_conciliadas, 'anomalias', v_anomalias
  );
end;
$$;

notify pgrst, 'reload schema';
