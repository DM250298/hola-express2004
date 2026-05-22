-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 015 · FASE 0 — Operación atómica: anular venta           ║
-- ║                                                                     ║
-- ║  Devuelve el stock, revierte los movimientos de cuenta y marca la   ║
-- ║  venta como anulada — todo dentro de una única transacción.         ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

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
begin
  -- 1. Verificar estado
  select estado into v_estado
    from public.ventas where id = p_venta_id for update;
  if v_estado is null then
    raise exception 'La venta no existe.';
  end if;
  if v_estado <> 'completada' then
    raise exception 'La venta ya estaba anulada.';
  end if;

  -- 2. Devolver el stock de cada item
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
  end loop;

  -- 3. Revertir los movimientos de cuenta de la venta
  for v_mov in
    select cuenta_id, tipo, monto
      from public.movimientos_cuenta
      where referencia_tipo = 'venta'
        and referencia_id = p_venta_id
        and tipo in ('ingreso', 'egreso')
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

  -- 4. Marcar la venta como anulada
  update public.ventas set estado = 'anulada' where id = p_venta_id;
end;
$$;

notify pgrst, 'reload schema';
