-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 084 · Consumo real de insumos + desfasaje vs receta      ║
-- ║                                                                     ║
-- ║  Al cerrar una orden, el empleado confirma cuánto usó REALMENTE de  ║
-- ║  cada insumo. El sistema:                                           ║
-- ║   · guarda teórico (cantidad_consumida) vs real (cantidad_real) y   ║
-- ║     el motivo del desfasaje por insumo,                             ║
-- ║   · AJUSTA el stock por la diferencia (FEFO si usó de más,          ║
-- ║     reintegro al lote más nuevo si usó de menos) → stock fiel,      ║
-- ║   · recostea el elaborado con el consumo REAL.                      ║
-- ║                                                                     ║
-- ║  Cambia la firma de fn_cerrar_orden_produccion (agrega p_consumos), ║
-- ║  así que se DROPEA la versión anterior (3 args) y se recrea.        ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────────────────────
-- 1. Columnas de consumo real y motivo en items_orden_prod
-- ─────────────────────────────────────────────────────────────────────
alter table public.items_orden_prod
  add column if not exists cantidad_real numeric(14,4),
  add column if not exists motivo_desfasaje text;

-- ─────────────────────────────────────────────────────────────────────
-- 2. fn_cerrar_orden_produccion con consumo real (nueva firma)
-- ─────────────────────────────────────────────────────────────────────
drop function if exists public.fn_cerrar_orden_produccion(integer, numeric, uuid);

create or replace function public.fn_cerrar_orden_produccion(
  p_orden_id integer,
  p_cantidad_producida numeric,
  p_usuario_id uuid,
  p_consumos jsonb default '[]'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ahora timestamptz := now();
  v_orden record;
  v_controlar boolean;
  v_stock_ant numeric; v_stock_nuevo numeric;
  v_vida integer; v_lote_id integer;
  v_costo_unit numeric; v_merma numeric;
  v_c jsonb; v_item_id integer; v_real numeric; v_motivo text;
  v_item record; v_delta numeric;
  v_restante numeric; v_usar numeric; v_lote record;
  v_costo_total_real numeric := 0;
begin
  select * into v_orden from public.ordenes_produccion where id = p_orden_id for update;
  if not found then raise exception 'La orden de producción no existe.'; end if;
  if v_orden.estado <> 'iniciada' then
    raise exception 'Solo se puede cerrar una orden iniciada (estado actual: %).', v_orden.estado;
  end if;
  if p_cantidad_producida is null or p_cantidad_producida <= 0 then
    raise exception 'La cantidad producida debe ser mayor a 0. Si se descartó toda la tanda, cancelá la orden para reponer los insumos.';
  end if;

  -- ── 1. Consumo real por insumo: ajusta el item y el stock por la diferencia.
  for v_c in select * from jsonb_array_elements(p_consumos) loop
    v_item_id := (v_c->>'item_id')::integer;
    v_real := (v_c->>'cantidad_real')::numeric;
    v_motivo := nullif(v_c->>'motivo', '');

    select iop.id, iop.insumo_id, iop.cantidad_consumida, iop.costo_unitario,
           coalesce(p.controlar_stock, true) as controlar
      into v_item
      from public.items_orden_prod iop
      join public.productos p on p.id = iop.insumo_id
      where iop.id = v_item_id and iop.orden_id = p_orden_id;
    if not found then continue; end if;
    if v_real is null or v_real < 0 then v_real := v_item.cantidad_consumida; end if;

    v_delta := v_real - v_item.cantidad_consumida; -- >0 usó de más, <0 usó de menos

    update public.items_orden_prod
      set cantidad_real = v_real,
          motivo_desfasaje = case when v_delta <> 0 then v_motivo else null end,
          subtotal = v_real * v_item.costo_unitario
      where id = v_item_id;

    if v_delta <> 0 and v_item.controlar then
      select stock_actual into v_stock_ant from public.productos where id = v_item.insumo_id for update;
      v_stock_ant := coalesce(v_stock_ant, 0);
      v_stock_nuevo := v_stock_ant - v_delta; -- delta>0 descuenta más; delta<0 repone
      update public.productos set stock_actual = v_stock_nuevo, updated_at = v_ahora where id = v_item.insumo_id;

      if v_delta > 0 then
        -- Usó de más: descuento adicional + consumo de lotes por FEFO.
        insert into public.movimientos_stock (
          producto_id, tipo, cantidad, stock_anterior, stock_nuevo, referencia_id, usuario_id, nota
        ) values (
          v_item.insumo_id, 'consumo_produccion'::public.tipo_movimiento, v_delta, v_stock_ant, v_stock_nuevo,
          p_orden_id, p_usuario_id,
          'Consumo real > receta · orden #' || p_orden_id || coalesce(' · ' || v_motivo, '')
        );
        v_restante := v_delta;
        for v_lote in
          select id, cantidad_actual from public.lotes
          where producto_id = v_item.insumo_id and estado = 'activo'::public.estado_lote and cantidad_actual > 0
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
      else
        -- Usó de menos: reintegro al lote más nuevo.
        insert into public.movimientos_stock (
          producto_id, tipo, cantidad, stock_anterior, stock_nuevo, referencia_id, usuario_id, nota
        ) values (
          v_item.insumo_id, 'entrada'::public.tipo_movimiento, -v_delta, v_stock_ant, v_stock_nuevo,
          p_orden_id, p_usuario_id, 'Consumo real < receta · orden #' || p_orden_id
        );
        select id into v_lote_id from public.lotes
          where producto_id = v_item.insumo_id and estado in ('activo','agotado')
          order by fecha_vencimiento desc, id desc limit 1;
        if v_lote_id is not null then
          update public.lotes
            set cantidad_actual = cantidad_actual + (-v_delta), estado = 'activo'::public.estado_lote
            where id = v_lote_id;
        end if;
      end if;
    end if;
  end loop;

  -- Items sin consumo real reportado: real = teórico (sin desfasaje).
  update public.items_orden_prod
    set cantidad_real = cantidad_consumida
    where orden_id = p_orden_id and cantidad_real is null;

  -- ── 2. Costo REAL total de la orden (sobre lo realmente consumido).
  select coalesce(sum(coalesce(cantidad_real, cantidad_consumida) * costo_unitario), 0)
    into v_costo_total_real
    from public.items_orden_prod where orden_id = p_orden_id;

  update public.ordenes_produccion set costo_total = v_costo_total_real where id = p_orden_id;

  v_costo_unit := case when p_cantidad_producida > 0 then v_costo_total_real / p_cantidad_producida else 0 end;
  v_merma := v_orden.cantidad_planificada - p_cantidad_producida;
  v_lote_id := null;

  -- ── 3. Ingreso del producido (igual que antes).
  select coalesce(controlar_stock, true) into v_controlar
    from public.productos where id = v_orden.producto_id for update;

  if v_controlar then
    select stock_actual into v_stock_ant from public.productos where id = v_orden.producto_id for update;
    v_stock_ant := coalesce(v_stock_ant, 0);
    v_stock_nuevo := v_stock_ant + p_cantidad_producida;
    update public.productos set stock_actual = v_stock_nuevo, updated_at = v_ahora where id = v_orden.producto_id;
    insert into public.movimientos_stock (
      producto_id, tipo, cantidad, stock_anterior, stock_nuevo, referencia_id, usuario_id, nota
    ) values (
      v_orden.producto_id, 'ingreso_produccion'::public.tipo_movimiento, p_cantidad_producida,
      v_stock_ant, v_stock_nuevo, p_orden_id, p_usuario_id, 'Ingreso producción #' || p_orden_id
    );

    select vida_util_dias into v_vida from public.recetas
      where producto_id = v_orden.producto_id and activa = true;
    insert into public.lotes (
      producto_id, fecha_vencimiento, cantidad_inicial, cantidad_actual, estado, fecha_ingreso
    ) values (
      v_orden.producto_id, current_date + coalesce(v_vida, 0),
      p_cantidad_producida, p_cantidad_producida, 'activo'::public.estado_lote, v_ahora
    ) returning id into v_lote_id;

    if v_merma > 0 then
      insert into public.movimientos_stock (
        producto_id, tipo, cantidad, stock_anterior, stock_nuevo, referencia_id, usuario_id, nota
      ) values (
        v_orden.producto_id, 'merma'::public.tipo_movimiento, v_merma,
        v_stock_nuevo, v_stock_nuevo, p_orden_id, p_usuario_id, 'Merma de rinde producción #' || p_orden_id
      );
    end if;
  end if;

  -- Costo materializado con el costo REAL unitario.
  perform public.fn_set_costo(v_orden.producto_id, v_costo_unit);

  update public.ordenes_produccion
    set estado = 'cerrada', cantidad_producida = p_cantidad_producida,
        lote_id = v_lote_id, fecha_cierre = v_ahora, updated_at = v_ahora
    where id = p_orden_id;

  return jsonb_build_object(
    'orden_id', p_orden_id, 'lote_id', v_lote_id,
    'costo_unitario', v_costo_unit, 'costo_total', v_costo_total_real,
    'merma', greatest(v_merma, 0)
  );
end $$;

grant execute on function public.fn_cerrar_orden_produccion(integer, numeric, uuid, jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 3. Vista de desfasajes: una fila por insumo donde lo real difirió de la
--    receta, con la diferencia en cantidad y en $. security_invoker = on
--    para que respete la RLS de producción (solo la ven admin/encargado).
-- ─────────────────────────────────────────────────────────────────────
drop view if exists public.vista_desfasajes_produccion;
create view public.vista_desfasajes_produccion
with (security_invoker = on) as
select
  iop.id,
  iop.orden_id,
  op.producto_id            as elaborado_id,
  pe.nombre                 as elaborado_nombre,
  iop.insumo_id,
  pi.nombre                 as insumo_nombre,
  pi.unidad                 as insumo_unidad,
  iop.cantidad_consumida    as teorico,
  iop.cantidad_real         as real_usado,
  (iop.cantidad_real - iop.cantidad_consumida)                       as diferencia,
  iop.costo_unitario,
  ((iop.cantidad_real - iop.cantidad_consumida) * iop.costo_unitario) as diferencia_costo,
  iop.motivo_desfasaje,
  op.usuario_id,
  op.fecha_cierre
from public.items_orden_prod iop
join public.ordenes_produccion op on op.id = iop.orden_id
join public.productos pe on pe.id = op.producto_id
join public.productos pi on pi.id = iop.insumo_id
where op.estado = 'cerrada'
  and iop.cantidad_real is not null
  and iop.cantidad_real <> iop.cantidad_consumida;

grant select on public.vista_desfasajes_produccion to authenticated;

notify pgrst, 'reload schema';
