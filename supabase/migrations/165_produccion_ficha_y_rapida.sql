-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 165 · Producción: ficha de elaboración + modo rápido     ║
-- ║                                                                     ║
-- ║  1. Columnas de ficha en `recetas` (pasos, conservación, alérgenos  ║
-- ║     y override del texto de ingredientes). Alimentan la etiqueta    ║
-- ║     de elaboración y el panel de receta. Todas nullable: si están   ║
-- ║     vacías la UI cae a los valores por defecto.                     ║
-- ║                                                                     ║
-- ║  2. fn_cerrar_orden_produccion REEMITIDA con la MISMA firma de 4    ║
-- ║     argumentos de la mig 084 (cambiar la firma crearía una          ║
-- ║     sobrecarga duplicada y PostgREST no podría elegir candidato).   ║
-- ║     Único cambio: el vencimiento del lote se calcula con la fecha   ║
-- ║     LOCAL de La Rioja y no con current_date (UTC). El local es 24h  ║
-- ║     y elaboran de noche: entre las 21:00 y las 24:00 argentinas     ║
-- ║     current_date ya es el día siguiente y el lote salía con un día  ║
-- ║     de más. Mismo bug y mismo remedio que la mig 147.               ║
-- ║                                                                     ║
-- ║  3. fn_produccion_rapida: crea + inicia + cierra la orden en UNA    ║
-- ║     transacción, para la tanda diaria de un solo paso. Reusa las    ║
-- ║     dos RPCs existentes, así que no duplica lógica de consumo,      ║
-- ║     costeo, lotes ni movimientos de stock.                          ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────────────────────
-- 1. Ficha de elaboración en recetas
-- ─────────────────────────────────────────────────────────────────────
alter table public.recetas
  add column if not exists pasos                 text,
  add column if not exists conservacion          text,
  add column if not exists alergenos             text,
  add column if not exists ingredientes_etiqueta text;

comment on column public.recetas.pasos is
  'Instrucciones de preparación (texto libre, una línea por paso). Se muestran en el panel de receta.';
comment on column public.recetas.conservacion is
  'Leyenda de conservación impresa en la etiqueta. NULL = la UI usa "Mantener refrigerado (0 a 5 °C)".';
comment on column public.recetas.alergenos is
  'Alérgenos para la línea "CONTIENE:" de la etiqueta. NULL = no se imprime la línea.';
comment on column public.recetas.ingredientes_etiqueta is
  'Override del texto de ingredientes de la etiqueta. NULL = se arma con los nombres de receta_ingredientes.';

-- ─────────────────────────────────────────────────────────────────────
-- 2. fn_cerrar_orden_produccion — misma firma (084), vencimiento local
--    OJO: cuerpo copiado tal cual de la 084; el único cambio está en el
--    insert del lote (v_hoy en lugar de current_date).
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_cerrar_orden_produccion(
  p_orden_id integer,
  p_cantidad_producida numeric,
  p_usuario_id uuid,
  p_consumos jsonb default '[]'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ahora timestamptz := now();
  -- Fecha del día en La Rioja, no en UTC (ver cabecera y mig 147).
  v_hoy date := (now() at time zone 'America/Argentina/La_Rioja')::date;
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
      v_orden.producto_id, v_hoy + coalesce(v_vida, 0),
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
-- 3. fn_produccion_rapida · crear + iniciar + cerrar en una transacción
--
--    Para la tanda diaria: el empleado elige receta y cantidad y listo.
--    Si el inicio falla (receta inactiva, etc.) la orden ni siquiera
--    queda creada — todo o nada.
--
--    security definer ⇒ saltea la RLS de ordenes_produccion, así que el
--    permiso se chequea a mano (las policies de la 079 usan la misma
--    clave 'produccion').
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_produccion_rapida(
  p_producto_id integer,
  p_receta_id integer,
  p_cantidad numeric,
  p_usuario_id uuid,
  p_nota text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_orden_id integer;
  v_res jsonb;
begin
  if not public.fn_tiene_permiso('produccion') then
    raise exception 'No tenés permiso para registrar producción.';
  end if;
  if p_cantidad is null or p_cantidad <= 0 then
    raise exception 'La cantidad a elaborar debe ser mayor a 0.';
  end if;

  insert into public.ordenes_produccion (
    producto_id, receta_id, cantidad_planificada, usuario_id, estado, nota
  ) values (
    p_producto_id, p_receta_id, p_cantidad, p_usuario_id, 'borrador',
    coalesce(nullif(p_nota, ''), 'Elaboración rápida')
  ) returning id into v_orden_id;

  perform public.fn_iniciar_orden_produccion(v_orden_id, p_usuario_id);
  v_res := public.fn_cerrar_orden_produccion(v_orden_id, p_cantidad, p_usuario_id, '[]'::jsonb);

  -- Atribución del cierre (el RPC de cierre no la escribe; ver mig 093).
  update public.ordenes_produccion
    set usuario_cierre = p_usuario_id where id = v_orden_id;

  return v_res || jsonb_build_object('orden_id', v_orden_id);
end $$;

grant execute on function public.fn_produccion_rapida(integer, integer, numeric, uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 4. Recargar el schema cache de PostgREST (firma nueva + columnas nuevas)
-- ─────────────────────────────────────────────────────────────────────
notify pgrst, 'reload schema';
