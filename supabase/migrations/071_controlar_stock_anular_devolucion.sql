-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 071 · controlar_stock en anular y devolución (simetría)   ║
-- ║                                                                      ║
-- ║  La 067 hizo que fn_crear_venta NO descuente stock cuando el producto║
-- ║  tiene controlar_stock = false. Pero fn_anular_venta (062) y         ║
-- ║  fn_crear_devolucion (051) reponían stock SIEMPRE → anular/devolver   ║
-- ║  un producto sin control inventaba mercadería (stock fantasma),       ║
-- ║  movimiento 'entrada' espurio, lotes inflados y —en devolución— un    ║
-- ║  CMV de reversa que la venta nunca asentó.                           ║
-- ║                                                                      ║
-- ║  Acá se gatea SOLO el bloque de inventario (stock + movimiento +     ║
-- ║  lotes + CMV/merma) con coalesce(controlar_stock, true), igual que   ║
-- ║  la 067. El reembolso (efectivo/NC/tarjeta), la reversión de cuentas,║
-- ║  las acreditaciones y el contra-asiento de venta/IVA siguen corriendo║
-- ║  SIEMPRE: la venta cobró plata y eso hay que revertirlo igual.       ║
-- ║                                                                      ║
-- ║  Firmas idénticas → CREATE OR REPLACE reemplaza limpio.              ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.      ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────────────────────
-- 1. fn_anular_venta  (base: 062, + gate controlar_stock en el loop)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_anular_venta(
  p_venta_id integer, p_usuario_id uuid
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_estado text; v_fecha date; v_total numeric;
  v_ahora timestamptz := now(); v_hoy date := current_date;
  v_item record; v_mov record;
  v_stock_ant numeric; v_stock_nuevo numeric;
  v_saldo numeric; v_saldo_nuevo numeric;
  v_tipo_opuesto text; v_lote_id integer;
  v_controlar boolean;
begin
  select estado, fecha::date, total into v_estado, v_fecha, v_total
    from public.ventas where id = p_venta_id for update;
  if v_estado is null then raise exception 'La venta no existe.'; end if;
  if v_estado <> 'completada' then raise exception 'La venta ya estaba anulada.'; end if;
  if public.fn_periodo_cerrado(v_fecha) then
    raise exception 'El período de esa venta está cerrado; no se puede anular.';
  end if;

  for v_item in select producto_id, cantidad from public.items_venta where venta_id = p_venta_id loop
    select stock_actual, coalesce(controlar_stock, true)
      into v_stock_ant, v_controlar from public.productos where id = v_item.producto_id for update;
    if v_stock_ant is null then continue; end if;
    -- Solo repone stock/movimiento/lote si el producto controla stock
    -- (simétrico con la venta: si no descontó, la anulación no repone).
    if v_controlar then
      v_stock_nuevo := v_stock_ant + v_item.cantidad;
      update public.productos set stock_actual = v_stock_nuevo, updated_at = v_ahora
        where id = v_item.producto_id;
      insert into public.movimientos_stock (
        producto_id, tipo, cantidad, stock_anterior, stock_nuevo, referencia_id, usuario_id, nota
      ) values (
        v_item.producto_id, 'entrada', v_item.cantidad, v_stock_ant, v_stock_nuevo,
        p_venta_id, p_usuario_id, 'Anulación venta #' || p_venta_id
      );
      select id into v_lote_id from public.lotes
        where producto_id = v_item.producto_id and estado in ('activo','agotado')
        order by fecha_vencimiento desc, id desc limit 1;
      if v_lote_id is not null then
        update public.lotes set cantidad_actual = cantidad_actual + v_item.cantidad, estado = 'activo'
          where id = v_lote_id;
      end if;
    end if;
  end loop;

  for v_mov in
    select cuenta_id, tipo, monto from public.movimientos_cuenta
      where tipo in ('ingreso', 'egreso')
        and ((referencia_tipo = 'venta' and referencia_id = p_venta_id)
          or (referencia_tipo = 'acreditacion' and referencia_id in (
                select id from public.acreditaciones where venta_id = p_venta_id)))
  loop
    v_tipo_opuesto := case when v_mov.tipo = 'ingreso' then 'egreso' else 'ingreso' end;
    select saldo_actual into v_saldo from public.cuentas where id = v_mov.cuenta_id for update;
    if v_saldo is null then continue; end if;
    v_saldo_nuevo := case when v_tipo_opuesto = 'ingreso' then v_saldo + v_mov.monto else v_saldo - v_mov.monto end;
    insert into public.movimientos_cuenta (
      cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo,
      descripcion, categoria, referencia_tipo, referencia_id, usuario_id, fecha
    ) values (
      v_mov.cuenta_id, v_tipo_opuesto, v_mov.monto, v_saldo, v_saldo_nuevo,
      'Anulación venta #' || p_venta_id, 'venta', 'venta', p_venta_id, p_usuario_id, v_hoy
    );
    update public.cuentas set saldo_actual = v_saldo_nuevo, updated_at = v_ahora where id = v_mov.cuenta_id;
  end loop;

  update public.acreditaciones set estado = 'cancelada', updated_at = v_ahora
    where venta_id = p_venta_id and estado in ('pendiente', 'acreditada');
  delete from public.asientos where origen = 'venta' and referencia_id = p_venta_id;
  update public.ventas set estado = 'anulada' where id = p_venta_id;

  perform public.fn_auditar(p_usuario_id, 'anular_venta', 'venta', p_venta_id,
    jsonb_build_object('total', v_total));
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 2. fn_crear_devolucion  (base: 051, + gate controlar_stock en el loop)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_crear_devolucion(
  p_venta_id integer,
  p_usuario_id uuid,
  p_turno_id integer,
  p_motivo text,
  p_tipo_reembolso text,
  p_cliente_id integer,
  p_items jsonb
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_ahora timestamptz := now();
  v_hoy date := current_date;
  v_venta record;
  v_item jsonb;
  v_iv_id integer;
  v_prod_id integer;
  v_cant integer;
  v_precio numeric;
  v_destino text;
  v_subtotal numeric;
  v_total numeric := 0;
  v_costo_total numeric := 0;
  v_costo_unit numeric;
  v_vendida integer;
  v_ya_dev integer;
  v_stock_ant integer;
  v_stock_nuevo integer;
  v_lote_id integer;
  v_dev_id integer;
  v_nc_id integer;
  v_egreso_id integer;
  v_codigo text;
  v_rest numeric;
  v_acred record;
  v_nuevo_bruto numeric;
  v_nuevo_com numeric;
  v_neto numeric;
  v_iva numeric;
  v_asiento_id integer;
  v_cta_ventas integer;
  v_cta_iva integer;
  v_cta_caja integer;
  v_cta_banco integer;
  v_cta_cmv integer;
  v_cta_merc integer;
  v_cta_haber integer;
  v_controlar boolean;
begin
  select * into v_venta from public.ventas where id = p_venta_id for update;
  if not found then raise exception 'La venta no existe.'; end if;
  if v_venta.estado <> 'completada' then
    raise exception 'Solo se pueden devolver items de ventas completadas.';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_iv_id := nullif(v_item->>'item_venta_id','')::integer;
    v_prod_id := (v_item->>'producto_id')::integer;
    v_cant := (v_item->>'cantidad')::integer;
    v_precio := (v_item->>'precio_unitario')::numeric;
    v_destino := coalesce(v_item->>'destino', 'stock');
    if v_cant <= 0 then continue; end if;

    if v_iv_id is not null then
      select cantidad into v_vendida from public.items_venta where id = v_iv_id;
      select coalesce(sum(cantidad),0) into v_ya_dev
        from public.items_devolucion where item_venta_id = v_iv_id;
      if v_cant > coalesce(v_vendida,0) - coalesce(v_ya_dev,0) then
        raise exception 'No se puede devolver más de lo vendido del producto %.', v_prod_id;
      end if;
    end if;

    -- El reembolso (v_total) se acumula SIEMPRE: la venta cobró.
    v_subtotal := v_cant * v_precio;
    v_total := v_total + v_subtotal;

    -- El inventario y el CMV de reversa SOLO si el producto controla stock.
    select stock_actual, coalesce(controlar_stock, true)
      into v_stock_ant, v_controlar from public.productos where id = v_prod_id for update;
    v_stock_ant := coalesce(v_stock_ant, 0);
    if v_controlar then
      v_costo_unit := public.fn_costo(v_prod_id);
      v_costo_total := v_costo_total + v_costo_unit * v_cant;
      v_stock_nuevo := v_stock_ant + v_cant;
      update public.productos set stock_actual = v_stock_nuevo, updated_at = v_ahora
        where id = v_prod_id;
      insert into public.movimientos_stock (
        producto_id, tipo, cantidad, stock_anterior, stock_nuevo,
        referencia_id, usuario_id, nota
      ) values (
        v_prod_id, 'entrada', v_cant, v_stock_ant, v_stock_nuevo,
        p_venta_id, p_usuario_id, 'Devolución venta #' || p_venta_id
      );

      select id into v_lote_id from public.lotes
        where producto_id = v_prod_id and estado in ('activo','agotado')
        order by fecha_vencimiento desc, id desc limit 1;
      if v_lote_id is not null then
        update public.lotes set cantidad_actual = cantidad_actual + v_cant, estado = 'activo'
          where id = v_lote_id;
      end if;

      if v_destino = 'merma' then
        update public.productos set stock_actual = v_stock_nuevo - v_cant, updated_at = v_ahora
          where id = v_prod_id;
        insert into public.movimientos_stock (
          producto_id, tipo, cantidad, stock_anterior, stock_nuevo,
          referencia_id, usuario_id, nota
        ) values (
          v_prod_id, 'merma', v_cant, v_stock_nuevo, v_stock_nuevo - v_cant,
          p_venta_id, p_usuario_id, 'Merma por devolución dañada venta #' || p_venta_id
        );
        if v_lote_id is not null then
          update public.lotes set cantidad_actual = greatest(cantidad_actual - v_cant, 0)
            where id = v_lote_id;
        end if;
      end if;
    end if;
  end loop;

  if v_total <= 0 then raise exception 'La devolución no tiene items válidos.'; end if;

  insert into public.devoluciones (
    venta_id, turno_id, usuario_id, motivo, tipo_reembolso, total_devuelto, cliente_id
  ) values (
    p_venta_id, p_turno_id, p_usuario_id, p_motivo, p_tipo_reembolso, v_total, p_cliente_id
  ) returning id into v_dev_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    if (v_item->>'cantidad')::integer <= 0 then continue; end if;
    insert into public.items_devolucion (
      devolucion_id, item_venta_id, producto_id, cantidad, precio_unitario, subtotal, destino
    ) values (
      v_dev_id, nullif(v_item->>'item_venta_id','')::integer,
      (v_item->>'producto_id')::integer, (v_item->>'cantidad')::integer,
      (v_item->>'precio_unitario')::numeric,
      (v_item->>'cantidad')::integer * (v_item->>'precio_unitario')::numeric,
      coalesce(v_item->>'destino','stock')
    );
  end loop;

  if p_tipo_reembolso = 'efectivo' then
    insert into public.egresos (descripcion, monto, categoria, fecha, usuario_id, turno_id)
    values ('Devolución venta #' || p_venta_id, v_total, 'devolucion', v_hoy, p_usuario_id, p_turno_id)
    returning id into v_egreso_id;
    update public.devoluciones set egreso_id = v_egreso_id where id = v_dev_id;
  elsif p_tipo_reembolso = 'nota_credito' then
    v_codigo := 'NC-' || to_char(v_ahora, 'YYMMDD') || '-' || lpad((floor(random()*10000))::int::text, 4, '0');
    insert into public.notas_credito (codigo, cliente_id, devolucion_id, monto_original, saldo_disponible, estado)
    values (v_codigo, p_cliente_id, v_dev_id, v_total, v_total, 'activa') returning id into v_nc_id;
    update public.devoluciones set nota_credito_id = v_nc_id where id = v_dev_id;
  elsif p_tipo_reembolso = 'tarjeta' then
    v_rest := v_total;
    for v_acred in
      select * from public.acreditaciones
      where venta_id = p_venta_id and estado = 'pendiente' order by id for update
    loop
      exit when v_rest <= 0;
      if v_rest >= v_acred.monto_bruto then
        update public.acreditaciones set estado = 'cancelada', updated_at = v_ahora where id = v_acred.id;
        v_rest := v_rest - v_acred.monto_bruto;
      else
        v_nuevo_bruto := v_acred.monto_bruto - v_rest;
        v_nuevo_com := round(v_nuevo_bruto * v_acred.comision_pct) / 100;
        update public.acreditaciones
          set monto_bruto = v_nuevo_bruto, comision_monto = v_nuevo_com,
              monto_neto = v_nuevo_bruto - v_nuevo_com, updated_at = v_ahora
          where id = v_acred.id;
        v_rest := 0;
      end if;
    end loop;
  end if;

  if p_tipo_reembolso in ('efectivo','tarjeta') then
    select id into v_cta_ventas from public.plan_cuentas where codigo = '4.1.01';
    select id into v_cta_iva from public.plan_cuentas where codigo = '2.1.02';
    select id into v_cta_caja from public.plan_cuentas where codigo = '1.1.01';
    select id into v_cta_banco from public.plan_cuentas where codigo = '1.1.02';
    select id into v_cta_cmv from public.plan_cuentas where codigo = '5.1.01';
    select id into v_cta_merc from public.plan_cuentas where codigo = '1.1.04';
    v_cta_haber := case when p_tipo_reembolso = 'efectivo' then v_cta_caja else v_cta_banco end;
    if v_cta_ventas is not null and v_cta_iva is not null and v_cta_haber is not null then
      v_neto := round(v_total / 1.21, 2);
      v_iva := round(v_total - v_neto, 2);
      insert into public.asientos (fecha, descripcion, tipo, origen, referencia_id, usuario_id)
      values (v_hoy, 'Devolución venta #' || p_venta_id, 'automatico', 'devolucion', v_dev_id, p_usuario_id)
      returning id into v_asiento_id;
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_ventas, v_neto, 0, 0);
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_iva, v_iva, 0, 1);
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_haber, 0, v_total, 2);
      if v_cta_cmv is not null and v_cta_merc is not null and v_costo_total > 0 then
        v_costo_total := round(v_costo_total, 2);
        insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
        values (v_asiento_id, v_cta_merc, v_costo_total, 0, 3);
        insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
        values (v_asiento_id, v_cta_cmv, 0, v_costo_total, 4);
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'devolucion_id', v_dev_id, 'total_devuelto', v_total,
    'nota_credito_id', v_nc_id, 'codigo_nc', v_codigo
  );
end;
$$;

notify pgrst, 'reload schema';
