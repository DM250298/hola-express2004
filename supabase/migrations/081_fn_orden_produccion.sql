-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 081 · RPCs de la orden de producción (Modelo B, Fase 2)  ║
-- ║                                                                     ║
-- ║  · fn_iniciar_orden_produccion  → borrador → iniciada. Explota la   ║
-- ║    receta, descuenta insumos por FEFO (réplica de fn_crear_venta),  ║
-- ║    movimiento 'consumo_produccion', snapshot en items_orden_prod.   ║
-- ║  · fn_cerrar_orden_produccion   → iniciada → cerrada. Ingresa lo     ║
-- ║    REALMENTE producido ('ingreso_produccion'), crea lote con        ║
-- ║    vencimiento, materializa costo con fn_set_costo, registra merma  ║
-- ║    de rinde. Rechaza cantidad_producida = 0 (viola lotes>0).        ║
-- ║  · fn_cancelar_orden_produccion → repone insumos consumidos (al     ║
-- ║    lote más nuevo, como fn_anular_venta) si estaba iniciada.        ║
-- ║                                                                     ║
-- ║  Las 3 son SECURITY DEFINER (bypassean RLS). Gatean el bloque de    ║
-- ║  inventario con coalesce(controlar_stock, true) igual que la 067/   ║
-- ║  071 para no inventar/destruir stock fantasma. Convierten la unidad ║
-- ║  de receta a la de stock con fn_convertir_unidad.                   ║
-- ║                                                                     ║
-- ║  ⚠️ Requiere la 078 (enum) y 080 (helpers) ya aplicadas.            ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────────────────────
-- fn_iniciar_orden_produccion
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_iniciar_orden_produccion(
  p_orden_id integer, p_usuario_id uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ahora timestamptz := now();
  v_orden record;
  v_rendimiento numeric;
  v_factor numeric;
  v_ing record;
  v_unidad_insumo text;
  v_controlar boolean;
  v_cant numeric;          -- cantidad a consumir en la unidad de stock del insumo
  v_costo_unit numeric;
  v_stock_ant numeric;
  v_stock_nuevo numeric;
  v_restante numeric;
  v_usar numeric;
  v_lote record;
  v_costo_total numeric := 0;
begin
  select * into v_orden from public.ordenes_produccion where id = p_orden_id for update;
  if not found then raise exception 'La orden de producción no existe.'; end if;
  if v_orden.estado <> 'borrador' then
    raise exception 'Solo se puede iniciar una orden en borrador (estado actual: %).', v_orden.estado;
  end if;
  if v_orden.receta_id is null then
    raise exception 'La orden no tiene receta asociada.';
  end if;

  select rendimiento into v_rendimiento
    from public.recetas where id = v_orden.receta_id and activa = true;
  if v_rendimiento is null then
    raise exception 'La receta no existe o está inactiva.';
  end if;
  v_factor := v_orden.cantidad_planificada / v_rendimiento;   -- cuántas tandas

  for v_ing in
    select insumo_id, cantidad, unidad, merma_pct
    from public.receta_ingredientes where receta_id = v_orden.receta_id
  loop
    select unidad, coalesce(controlar_stock, true)
      into v_unidad_insumo, v_controlar
      from public.productos where id = v_ing.insumo_id for update;

    -- Escalado por tandas + merma teórica, convertido a la unidad de stock.
    v_cant := public.fn_convertir_unidad(
      v_ing.cantidad * v_factor * (1 + v_ing.merma_pct / 100.0),
      v_ing.unidad, v_unidad_insumo);
    v_costo_unit := public.fn_costo(v_ing.insumo_id);

    -- Bloque de inventario SOLO si el insumo controla stock.
    if v_controlar then
      select stock_actual into v_stock_ant from public.productos where id = v_ing.insumo_id for update;
      v_stock_ant := coalesce(v_stock_ant, 0);
      v_stock_nuevo := v_stock_ant - v_cant;
      update public.productos set stock_actual = v_stock_nuevo, updated_at = v_ahora
        where id = v_ing.insumo_id;

      insert into public.movimientos_stock (
        producto_id, tipo, cantidad, stock_anterior, stock_nuevo, referencia_id, usuario_id, nota
      ) values (
        v_ing.insumo_id, 'consumo_produccion'::public.tipo_movimiento, v_cant,
        v_stock_ant, v_stock_nuevo, p_orden_id, p_usuario_id,
        'Consumo orden producción #' || p_orden_id
      );

      -- FEFO: consume los lotes del insumo por vencimiento ascendente.
      v_restante := v_cant;
      for v_lote in
        select id, cantidad_actual from public.lotes
        where producto_id = v_ing.insumo_id and estado = 'activo'::public.estado_lote and cantidad_actual > 0
        order by fecha_vencimiento asc for update
      loop
        exit when v_restante <= 0;
        v_usar := least(v_lote.cantidad_actual, v_restante);
        update public.lotes
          set cantidad_actual = v_lote.cantidad_actual - v_usar,
              estado = (case when v_lote.cantidad_actual - v_usar = 0 then 'agotado' else 'activo' end)::public.estado_lote
          where id = v_lote.id;
        v_restante := v_restante - v_usar;
      end loop;
    end if;

    -- Snapshot de consumo y costo SIEMPRE (también sin control, para costear).
    insert into public.items_orden_prod (orden_id, insumo_id, cantidad_consumida, costo_unitario, subtotal)
    values (p_orden_id, v_ing.insumo_id, v_cant, v_costo_unit, v_cant * v_costo_unit);
    v_costo_total := v_costo_total + v_cant * v_costo_unit;
  end loop;

  update public.ordenes_produccion
    set estado = 'iniciada', fecha_inicio = v_ahora, costo_total = v_costo_total,
        usuario_id = coalesce(usuario_id, p_usuario_id), updated_at = v_ahora
    where id = p_orden_id;

  return jsonb_build_object('orden_id', p_orden_id, 'costo_total', v_costo_total);
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- fn_cerrar_orden_produccion
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_cerrar_orden_produccion(
  p_orden_id integer, p_cantidad_producida numeric, p_usuario_id uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ahora timestamptz := now();
  v_orden record;
  v_controlar boolean;
  v_stock_ant numeric;
  v_stock_nuevo numeric;
  v_vida integer;
  v_lote_id integer;
  v_costo_unit numeric;
  v_merma numeric;
begin
  select * into v_orden from public.ordenes_produccion where id = p_orden_id for update;
  if not found then raise exception 'La orden de producción no existe.'; end if;
  if v_orden.estado <> 'iniciada' then
    raise exception 'Solo se puede cerrar una orden iniciada (estado actual: %).', v_orden.estado;
  end if;
  if p_cantidad_producida is null or p_cantidad_producida <= 0 then
    raise exception 'La cantidad producida debe ser mayor a 0. Si se descartó toda la tanda, cancelá la orden para reponer los insumos.';
  end if;

  v_costo_unit := v_orden.costo_total / p_cantidad_producida;
  v_merma := v_orden.cantidad_planificada - p_cantidad_producida;

  select coalesce(controlar_stock, true) into v_controlar
    from public.productos where id = v_orden.producto_id for update;

  if v_controlar then
    -- Ingreso del producido.
    select stock_actual into v_stock_ant from public.productos where id = v_orden.producto_id for update;
    v_stock_ant := coalesce(v_stock_ant, 0);
    v_stock_nuevo := v_stock_ant + p_cantidad_producida;
    update public.productos set stock_actual = v_stock_nuevo, updated_at = v_ahora
      where id = v_orden.producto_id;
    insert into public.movimientos_stock (
      producto_id, tipo, cantidad, stock_anterior, stock_nuevo, referencia_id, usuario_id, nota
    ) values (
      v_orden.producto_id, 'ingreso_produccion'::public.tipo_movimiento, p_cantidad_producida,
      v_stock_ant, v_stock_nuevo, p_orden_id, p_usuario_id, 'Ingreso producción #' || p_orden_id
    );

    -- Lote del producido con vencimiento = hoy + vida_util_dias.
    select vida_util_dias into v_vida from public.recetas
      where producto_id = v_orden.producto_id and activa = true;
    insert into public.lotes (
      producto_id, fecha_vencimiento, cantidad_inicial, cantidad_actual, estado, fecha_ingreso
    ) values (
      v_orden.producto_id, current_date + coalesce(v_vida, 0),
      p_cantidad_producida, p_cantidad_producida, 'activo'::public.estado_lote, v_ahora
    ) returning id into v_lote_id;

    -- Merma de rinde (informativa: no descuenta, ya se ingresó lo real).
    if v_merma > 0 then
      insert into public.movimientos_stock (
        producto_id, tipo, cantidad, stock_anterior, stock_nuevo, referencia_id, usuario_id, nota
      ) values (
        v_orden.producto_id, 'merma'::public.tipo_movimiento, v_merma,
        v_stock_nuevo, v_stock_nuevo, p_orden_id, p_usuario_id,
        'Merma de rinde producción #' || p_orden_id
      );
    end if;
  end if;

  -- Costeo materializado SIEMPRE (el costo del producido es válido aun sin
  -- control de stock); fn_crear_venta lo leerá vía fn_costo para el CMV.
  perform public.fn_set_costo(v_orden.producto_id, v_costo_unit);

  update public.ordenes_produccion
    set estado = 'cerrada', cantidad_producida = p_cantidad_producida,
        lote_id = v_lote_id, fecha_cierre = v_ahora, updated_at = v_ahora
    where id = p_orden_id;

  return jsonb_build_object(
    'orden_id', p_orden_id, 'lote_id', v_lote_id,
    'costo_unitario', v_costo_unit, 'merma', greatest(v_merma, 0)
  );
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- fn_cancelar_orden_produccion
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_cancelar_orden_produccion(
  p_orden_id integer, p_usuario_id uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ahora timestamptz := now();
  v_orden record;
  v_item record;
  v_controlar boolean;
  v_stock_ant numeric;
  v_stock_nuevo numeric;
  v_lote_id integer;
begin
  select * into v_orden from public.ordenes_produccion where id = p_orden_id for update;
  if not found then raise exception 'La orden de producción no existe.'; end if;
  if v_orden.estado = 'cerrada' then
    raise exception 'No se puede cancelar una orden cerrada (usá un ajuste de stock).';
  end if;
  if v_orden.estado = 'cancelada' then
    return jsonb_build_object('orden_id', p_orden_id, 'estado', 'cancelada');
  end if;

  -- Si estaba iniciada, repone los insumos consumidos (al lote más nuevo,
  -- como fn_anular_venta). Solo los que controlan stock.
  if v_orden.estado = 'iniciada' then
    for v_item in
      select insumo_id, cantidad_consumida from public.items_orden_prod where orden_id = p_orden_id
    loop
      select coalesce(controlar_stock, true) into v_controlar
        from public.productos where id = v_item.insumo_id for update;
      if not v_controlar then continue; end if;

      select stock_actual into v_stock_ant from public.productos where id = v_item.insumo_id for update;
      v_stock_ant := coalesce(v_stock_ant, 0);
      v_stock_nuevo := v_stock_ant + v_item.cantidad_consumida;
      update public.productos set stock_actual = v_stock_nuevo, updated_at = v_ahora
        where id = v_item.insumo_id;

      insert into public.movimientos_stock (
        producto_id, tipo, cantidad, stock_anterior, stock_nuevo, referencia_id, usuario_id, nota
      ) values (
        v_item.insumo_id, 'entrada'::public.tipo_movimiento, v_item.cantidad_consumida,
        v_stock_ant, v_stock_nuevo, p_orden_id, p_usuario_id,
        'Cancelación producción #' || p_orden_id
      );

      select id into v_lote_id from public.lotes
        where producto_id = v_item.insumo_id and estado in ('activo','agotado')
        order by fecha_vencimiento desc, id desc limit 1;
      if v_lote_id is not null then
        update public.lotes
          set cantidad_actual = cantidad_actual + v_item.cantidad_consumida,
              estado = 'activo'::public.estado_lote
          where id = v_lote_id;
      end if;
    end loop;
  end if;

  update public.ordenes_produccion set estado = 'cancelada', updated_at = v_ahora where id = p_orden_id;
  return jsonb_build_object('orden_id', p_orden_id, 'estado', 'cancelada');
end $$;

grant execute on function public.fn_iniciar_orden_produccion(integer, uuid) to authenticated;
grant execute on function public.fn_cerrar_orden_produccion(integer, numeric, uuid) to authenticated;
grant execute on function public.fn_cancelar_orden_produccion(integer, uuid) to authenticated;

notify pgrst, 'reload schema';
