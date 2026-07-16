-- ╔═════════════════════════════════════════════════════════════════════╗
-- ║  114 · fn_anular_venta: el reverso conserva la categoría original    ║
-- ║                                                                       ║
-- ║  Bug: al anular una venta, el loop de reversión de movimientos_      ║
-- ║  cuenta insertaba el movimiento opuesto con categoría hardcodeada    ║
-- ║  'venta'. Los egresos de comisión ('comisiones') y retención         ║
-- ║  ('iibb') se revertían con la categoría equivocada, y el P&L         ║
-- ║  (que suma esas categorías con signo) no neteaba las anulaciones:    ║
-- ║  comisiones/IIBB sobreestimados y resultado subestimado.             ║
-- ║                                                                       ║
-- ║  v9 = versión de la mig 112 ÍNTEGRA con un solo cambio: el cursor    ║
-- ║  trae `categoria` y el insert del reverso usa la original.           ║
-- ║  Los reversos históricos (categoría 'venta') no se tocan.            ║
-- ╚═════════════════════════════════════════════════════════════════════╝

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
  v_comp record; v_cant_comp numeric;
begin
  select estado, fecha::date, total into v_estado, v_fecha, v_total
    from public.ventas where id = p_venta_id for update;
  if v_estado is null then raise exception 'La venta no existe.'; end if;
  if v_estado <> 'completada' then raise exception 'La venta ya estaba anulada.'; end if;
  if public.fn_periodo_cerrado(v_fecha) then
    raise exception 'El período de esa venta está cerrado; no se puede anular.';
  end if;

  for v_item in select producto_id, cantidad from public.items_venta where venta_id = p_venta_id loop
    if exists (select 1 from public.producto_componentes where producto_id = v_item.producto_id) then
      -- ── Combo: la venta descontó componentes → la anulación los repone. ──
      for v_comp in
        select pc.componente_id, pc.cantidad
        from public.producto_componentes pc
        where pc.producto_id = v_item.producto_id
        order by pc.id
      loop
        v_cant_comp := v_comp.cantidad * v_item.cantidad;
        select stock_actual, coalesce(controlar_stock, true)
          into v_stock_ant, v_controlar from public.productos
          where id = v_comp.componente_id for update;
        if v_stock_ant is null then continue; end if;
        if v_controlar then
          v_stock_nuevo := v_stock_ant + v_cant_comp;
          update public.productos set stock_actual = v_stock_nuevo, updated_at = v_ahora
            where id = v_comp.componente_id;
          insert into public.movimientos_stock (
            producto_id, tipo, cantidad, stock_anterior, stock_nuevo, referencia_id, usuario_id, nota
          ) values (
            v_comp.componente_id, 'entrada', v_cant_comp, v_stock_ant, v_stock_nuevo,
            p_venta_id, p_usuario_id, 'Anulación venta #' || p_venta_id || ' (combo)'
          );
          select id into v_lote_id from public.lotes
            where producto_id = v_comp.componente_id and estado in ('activo','agotado')
            order by fecha_vencimiento desc, id desc limit 1;
          if v_lote_id is not null then
            update public.lotes set cantidad_actual = cantidad_actual + v_cant_comp, estado = 'activo'
              where id = v_lote_id;
          end if;
        end if;
      end loop;
    else
      -- ── Producto común: idéntico a la 101. ──
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
    end if;
  end loop;

  for v_mov in
    -- v9: se trae también `categoria` para que el reverso la conserve
    -- (comisiones/iibb netean en el P&L en lugar de quedar como 'venta').
    select cuenta_id, tipo, monto, categoria from public.movimientos_cuenta
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
      v_mov.cuenta_id, v_tipo_opuesto::public.tipo_movimiento_cuenta, v_mov.monto, v_saldo, v_saldo_nuevo,
      'Anulación venta #' || p_venta_id, coalesce(v_mov.categoria, 'venta'),
      'venta', p_venta_id, p_usuario_id, v_hoy
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

notify pgrst, 'reload schema';
