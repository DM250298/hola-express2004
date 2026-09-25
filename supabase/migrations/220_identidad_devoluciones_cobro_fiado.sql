-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 220 · Identidad y turno en devoluciones y cobro de fiado ║
-- ║                                                                     ║
-- ║  Último seguimiento de la 218 (identidad = sesión). Estas dos RPCs  ║
-- ║  seguían aceptando el p_usuario_id que manda la pantalla (stock,    ║
-- ║  egreso, asiento, cta. cte. a nombre de otro). Además               ║
-- ║  fn_crear_devolucion NUNCA tuvo revoke a anon: cualquiera con la    ║
-- ║  clave pública podía registrar devoluciones (reembolsos y vales).   ║
-- ║                                                                     ║
-- ║  · fn_crear_devolucion (base 171 ÍNTEGRA): identidad = auth.uid();  ║
-- ║      permiso 'devoluciones'; turno propio (o Finanzas) y ABIERTO;   ║
-- ║      sin turno solo Finanzas; revoke a public/anon.                 ║
-- ║  · fn_cobrar_cta_cte   (base 141 ÍNTEGRA): identidad = auth.uid();  ║
-- ║      cobro en caja → turno propio (o Finanzas) y ABIERTO. El cobro  ║
-- ║      por tesorería y el resto de los controles de la 141 no cambian.║
-- ║                                                                     ║
-- ║  Mismas firmas → create or replace, sin sobrecargas. Los controles  ║
-- ║  solo corren con JWT 'authenticated' (fn_rol_jwt de la 218).        ║
-- ║  Roles verificados en la copia de prod (2026-09-25): cajero,        ║
-- ║  encargado y admin tienen 'devoluciones'.                           ║
-- ║                                                                     ║
-- ║  Requiere la 218. Ejecutar UNA sola vez, COMPLETO, en el SQL        ║
-- ║  Editor. Primero PRUEBA, después PRODUCCIÓN. Después: chequeo T1.   ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────────────────────
-- 1. fn_crear_devolucion · base 171 íntegra + bloque "220"
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
  v_cant numeric;
  v_precio numeric;
  v_destino text;
  v_subtotal numeric;
  v_total numeric := 0;
  v_costo_total numeric := 0;
  v_costo_unit numeric;
  v_vendida numeric;
  v_ya_dev numeric;
  v_stock_ant numeric;
  v_stock_nuevo numeric;
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
  v_comp record;
  v_cant_comp numeric;
  -- v-cc: devolución abonada a la cuenta corriente del deudor original
  v_cta_deudores integer;
  v_dev_deudor_tipo text;
  v_dev_deudor_id integer;
  -- v-iva (mig 163): IVA del contra-asiento prorrateado por la venta original
  v_ratio_gravado numeric;
  v_base_dev numeric;
  v_factor_iva numeric;
  v_orden integer := 0;
  -- v-costo (mig 171): costo congelado por ítem devuelto
  v_item_dev_id integer;
  v_costo_item numeric;
  v_costo_incompleto boolean;
  -- 220
  v_finanzas_220 boolean := false;
  v_turno_dueno_220 uuid;
  v_turno_estado_220 text;
begin
  -- ── 220 · IDENTIDAD, PERMISO Y TURNO ─────────────────────────────────
  -- Con sesión de usuario: quien devuelve es auth.uid() (stock, egreso,
  -- asiento y cta. cte. quedan a su nombre), necesita el permiso
  -- 'devoluciones' y la devolución va contra SU turno ABIERTO (el reembolso
  -- en efectivo sale del cajón: no puede cargarse sobre un arqueo que ya se
  -- contó). Sin turno, solo Finanzas. service_role / SQL Editor: sin cambios.
  p_usuario_id := public.fn_usuario_efectivo(p_usuario_id);
  if public.fn_rol_jwt() = 'authenticated' then
    if p_usuario_id is null then
      raise exception 'SESION_CAMBIO: la sesión no es válida. Volvé a iniciar sesión.';
    end if;
    if not coalesce((select public.fn_tiene_permiso('devoluciones')), false) then
      raise exception 'No tenés permiso para hacer devoluciones.';
    end if;
    v_finanzas_220 := coalesce((select public.fn_tiene_permiso('finanzas')), false);
    if p_turno_id is null then
      if not v_finanzas_220 then
        raise exception 'Las devoluciones se registran desde el POS, con tu turno de caja abierto.';
      end if;
    else
      select usuario_id, estado::text into v_turno_dueno_220, v_turno_estado_220
        from public.caja_turnos where id = p_turno_id;
      if v_turno_dueno_220 is null then
        raise exception 'El turno de caja #% no existe.', p_turno_id;
      end if;
      if v_turno_dueno_220 <> p_usuario_id and not v_finanzas_220 then
        raise exception 'TURNO_AJENO: el turno de caja #% no es tuyo. Recargá la página.', p_turno_id;
      end if;
      if v_turno_estado_220 <> 'abierto' then
        raise exception 'TURNO_CERRADO: el turno #% ya está cerrado; la devolución no se puede cargar contra él.', p_turno_id;
      end if;
    end if;
  end if;

  select * into v_venta from public.ventas where id = p_venta_id for update;
  if not found then raise exception 'La venta no existe.'; end if;
  if v_venta.estado <> 'completada' then
    raise exception 'Solo se pueden devolver items de ventas completadas.';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_iv_id := nullif(v_item->>'item_venta_id','')::integer;
    v_prod_id := (v_item->>'producto_id')::integer;
    v_cant := (v_item->>'cantidad')::numeric;
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

    if exists (select 1 from public.producto_componentes where producto_id = v_prod_id) then
      -- ── Combo: la venta descontó componentes → la devolución los repone
      --    (o los merma, si vuelven dañados). ──
      for v_comp in
        select pc.componente_id, pc.cantidad
        from public.producto_componentes pc
        where pc.producto_id = v_prod_id
        order by pc.id
      loop
        v_cant_comp := v_comp.cantidad * v_cant;
        select stock_actual, coalesce(controlar_stock, true)
          into v_stock_ant, v_controlar from public.productos
          where id = v_comp.componente_id for update;
        v_stock_ant := coalesce(v_stock_ant, 0);
        if v_controlar then
          v_costo_unit := public.fn_costo(v_comp.componente_id);
          v_costo_total := v_costo_total + v_costo_unit * v_cant_comp;
          v_stock_nuevo := v_stock_ant + v_cant_comp;
          update public.productos set stock_actual = v_stock_nuevo, updated_at = v_ahora
            where id = v_comp.componente_id;
          insert into public.movimientos_stock (
            producto_id, tipo, cantidad, stock_anterior, stock_nuevo,
            referencia_id, usuario_id, nota
          ) values (
            v_comp.componente_id, 'entrada', v_cant_comp, v_stock_ant, v_stock_nuevo,
            p_venta_id, p_usuario_id, 'Devolución venta #' || p_venta_id || ' (combo)'
          );

          select id into v_lote_id from public.lotes
            where producto_id = v_comp.componente_id and estado in ('activo','agotado')
            order by fecha_vencimiento desc, id desc limit 1;
          if v_lote_id is not null then
            update public.lotes set cantidad_actual = cantidad_actual + v_cant_comp, estado = 'activo'
              where id = v_lote_id;
          end if;

          if v_destino = 'merma' then
            update public.productos set stock_actual = v_stock_nuevo - v_cant_comp, updated_at = v_ahora
              where id = v_comp.componente_id;
            insert into public.movimientos_stock (
              producto_id, tipo, cantidad, stock_anterior, stock_nuevo,
              referencia_id, usuario_id, nota
            ) values (
              v_comp.componente_id, 'merma', v_cant_comp, v_stock_nuevo, v_stock_nuevo - v_cant_comp,
              p_venta_id, p_usuario_id, 'Merma por devolución dañada venta #' || p_venta_id || ' (combo)'
            );
            if v_lote_id is not null then
              update public.lotes set cantidad_actual = greatest(cantidad_actual - v_cant_comp, 0)
                where id = v_lote_id;
            end if;
          end if;
        end if;
      end loop;
    else
      -- ── Producto común: idéntico a la 076. ──
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
    end if;
  end loop;

  if v_total <= 0 then raise exception 'La devolución no tiene items válidos.'; end if;

  insert into public.devoluciones (
    venta_id, turno_id, usuario_id, motivo, tipo_reembolso, total_devuelto, cliente_id
  ) values (
    p_venta_id, p_turno_id, p_usuario_id, p_motivo, p_tipo_reembolso, v_total, p_cliente_id
  ) returning id into v_dev_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    if (v_item->>'cantidad')::numeric <= 0 then continue; end if;
    insert into public.items_devolucion (
      devolucion_id, item_venta_id, producto_id, cantidad, precio_unitario, subtotal, destino
    ) values (
      v_dev_id, nullif(v_item->>'item_venta_id','')::integer,
      (v_item->>'producto_id')::integer, (v_item->>'cantidad')::numeric,
      (v_item->>'precio_unitario')::numeric,
      (v_item->>'cantidad')::numeric * (v_item->>'precio_unitario')::numeric,
      coalesce(v_item->>'destino','stock')
    ) returning id into v_item_dev_id;  -- v-costo

    -- ── v-costo (mig 171): costo unitario congelado del ítem devuelto.
    -- Congela lo que USÓ el contra-CMV de arriba (fn_costo con la receta
    -- VIGENTE; fn_costo es stable → mismo valor dentro de la transacción).
    -- FAIL-CLOSED, igual que la venta: si algún componente con control de
    -- stock no tiene costo cargado (fn_costo NULL o <= 0), NO se inserta
    -- fila — un costo parcial sería un dato falso, y en ese caso el propio
    -- contra-asiento tampoco emitió CMV (v_costo_total quedó NULL). ──
    v_prod_id := (v_item->>'producto_id')::integer;
    if exists (select 1 from public.producto_componentes where producto_id = v_prod_id) then
      select sum(public.fn_costo(pc.componente_id) * pc.cantidad) filter (where coalesce(pr.controlar_stock, true)),
             bool_or(coalesce(pr.controlar_stock, true)
                     and coalesce(public.fn_costo(pc.componente_id), 0) <= 0)
        into v_costo_item, v_costo_incompleto
        from public.producto_componentes pc
        join public.productos pr on pr.id = pc.componente_id
        where pc.producto_id = v_prod_id;
    else
      select case when coalesce(pr.controlar_stock, true)
                   then public.fn_costo(v_prod_id) else 0 end
        into v_costo_item
        from public.productos pr where pr.id = v_prod_id;
      v_costo_incompleto := false;
    end if;
    if not coalesce(v_costo_incompleto, false) and coalesce(v_costo_item, 0) > 0 then
      insert into public.costos_item_devolucion (item_devolucion_id, costo_unitario)
      values (v_item_dev_id, round(v_costo_item, 4));
    end if;
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
  elsif p_tipo_reembolso = 'cuenta_corriente' then
    -- ── v-cc: abona la deuda del deudor ORIGINAL de esta venta. No se pide
    -- el deudor por parámetro (evitaría acreditar a la cuenta equivocada):
    -- se busca el consumo fiado de la venta. Si la venta no se fió, error.
    -- Si el consumo ya fue descontado del sueldo, el abono queda como saldo
    -- a favor y se compensa con el próximo fiado. ──
    select 'cliente'::text, cliente_id into v_dev_deudor_tipo, v_dev_deudor_id
      from public.cuenta_corriente_cliente
      where venta_id = p_venta_id and tipo = 'consumo' limit 1;
    if v_dev_deudor_id is null then
      select 'empleado'::text, empleado_id into v_dev_deudor_tipo, v_dev_deudor_id
        from public.cuenta_corriente_empleado
        where venta_id = p_venta_id and tipo = 'consumo' limit 1;
    end if;
    if v_dev_deudor_id is null then
      raise exception 'Esta venta no fue fiada; elegí otro tipo de reembolso.';
    end if;
    if v_dev_deudor_tipo = 'cliente' then
      insert into public.cuenta_corriente_cliente
        (cliente_id, fecha, tipo, concepto, monto, venta_id, usuario_id)
      values (v_dev_deudor_id, v_hoy, 'ajuste',
              'Devolución venta #' || p_venta_id, -v_total, p_venta_id, p_usuario_id);
    else
      insert into public.cuenta_corriente_empleado
        (empleado_id, fecha, tipo, concepto, monto, venta_id, usuario_id)
      values (v_dev_deudor_id, v_hoy, 'ajuste',
              'Devolución venta #' || p_venta_id, -v_total, p_venta_id, p_usuario_id);
    end if;
  end if;

  if p_tipo_reembolso in ('efectivo','tarjeta','cuenta_corriente') then
    select id into v_cta_ventas from public.plan_cuentas where codigo = '4.1.01';
    select id into v_cta_iva from public.plan_cuentas where codigo = '2.1.02';
    select id into v_cta_caja from public.plan_cuentas where codigo = '1.1.01';
    select id into v_cta_banco from public.plan_cuentas where codigo = '1.1.02';
    select id into v_cta_deudores from public.plan_cuentas where codigo = '1.1.03';  -- v-cc
    select id into v_cta_cmv from public.plan_cuentas where codigo = '5.1.01';
    select id into v_cta_merc from public.plan_cuentas where codigo = '1.1.04';
    v_cta_haber := case p_tipo_reembolso
      when 'efectivo' then v_cta_caja
      when 'cuenta_corriente' then v_cta_deudores  -- v-cc: baja la deuda contable
      else v_cta_banco end;
    if v_cta_ventas is not null and v_cta_iva is not null and v_cta_haber is not null then
      -- ── v-iva (mig 163) ────────────────────────────────────────────────
      -- El IVA del contra-asiento se prorratea por la proporción GRAVADA de
      -- la venta original. Sin esto, devolver una venta cobrada en efectivo
      -- (que no generó débito fiscal) debitaría 2.1.02 por IVA que nunca se
      -- acreditó. Las ventas anteriores a la 163 tienen base_gravada = total
      -- por el backfill → ratio 1 → el asiento de siempre.
      v_ratio_gravado := case
        when coalesce(v_venta.total, 0) > 0
          then least(coalesce(v_venta.base_gravada, v_venta.total) / v_venta.total, 1)
        else 0 end;
      select 1 + coalesce(iva_alicuota_general, 21) / 100 into v_factor_iva
        from public.config_fiscal where id = 1;
      v_factor_iva := coalesce(v_factor_iva, 1.21);

      v_base_dev := round(v_total * v_ratio_gravado, 2);
      v_iva  := round(v_base_dev - round(v_base_dev / v_factor_iva, 2), 2);
      v_neto := round(v_total - v_iva, 2);

      insert into public.asientos (fecha, descripcion, tipo, origen, referencia_id, usuario_id)
      values (v_hoy, 'Devolución venta #' || p_venta_id, 'automatico', 'devolucion', v_dev_id, p_usuario_id)
      returning id into v_asiento_id;
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_ventas, v_neto, 0, v_orden); v_orden := v_orden + 1;
      if v_iva > 0 then   -- v-iva: sin IVA en la venta, no hay IVA que revertir
        insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
        values (v_asiento_id, v_cta_iva, v_iva, 0, v_orden); v_orden := v_orden + 1;
      end if;
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_haber, 0, v_total, v_orden); v_orden := v_orden + 1;
      if v_cta_cmv is not null and v_cta_merc is not null and v_costo_total > 0 then
        v_costo_total := round(v_costo_total, 2);
        insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
        values (v_asiento_id, v_cta_merc, v_costo_total, 0, v_orden); v_orden := v_orden + 1;
        insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
        values (v_asiento_id, v_cta_cmv, 0, v_costo_total, v_orden);
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'devolucion_id', v_dev_id, 'total_devuelto', v_total,
    'nota_credito_id', v_nc_id, 'codigo_nc', v_codigo
  );
end;
$$;

revoke all on function public.fn_crear_devolucion(integer, uuid, integer, text, text, integer, jsonb) from public, anon;
grant execute on function public.fn_crear_devolucion(integer, uuid, integer, text, text, integer, jsonb) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────
-- 2. fn_cobrar_cta_cte · base 141 íntegra + bloque "220"
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_cobrar_cta_cte(
  p_deudor_tipo text,
  p_deudor_id   integer,
  p_monto       numeric,
  p_usuario_id  uuid,
  p_cuenta_id   integer default null,   -- cobro por tesorería (Finanzas)
  p_turno_id    integer default null,   -- cobro en efectivo en la caja del POS
  p_fecha       date    default null,
  p_nota        text    default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fecha date := coalesce(p_fecha, current_date);
  v_nombre text; v_saldo numeric; v_mov_id integer; v_cc_id integer;
  v_tipo_cuenta text; v_es_boveda boolean; v_saldo_cta numeric; v_saldo_nuevo numeric;
  v_asiento_id integer; v_cta_deudores integer; v_cta_debe integer;
  -- 220
  v_finanzas_220 boolean := false;
  v_turno_dueno_220 uuid;
  v_turno_estado_220 text;
begin
  -- ── 220 · IDENTIDAD Y TURNO ──────────────────────────────────────────
  -- Con sesión de usuario: quien cobra es auth.uid() (movimiento, asiento y
  -- cta. cte. quedan a su nombre). El cobro en caja va contra SU turno
  -- ABIERTO (entra al arqueo: no puede sumarse a un cierre ya contado);
  -- Finanzas puede usar el turno de otro, nunca uno cerrado. El cobro por
  -- tesorería no cambia. service_role / SQL Editor: sin cambios.
  p_usuario_id := public.fn_usuario_efectivo(p_usuario_id);
  if public.fn_rol_jwt() = 'authenticated' then
    if p_usuario_id is null then
      raise exception 'SESION_CAMBIO: la sesión no es válida. Volvé a iniciar sesión.';
    end if;
    if p_turno_id is not null then
      v_finanzas_220 := coalesce((select public.fn_tiene_permiso('finanzas')), false);
      select usuario_id, estado::text into v_turno_dueno_220, v_turno_estado_220
        from public.caja_turnos where id = p_turno_id;
      if v_turno_dueno_220 is null then
        raise exception 'El turno de caja #% no existe.', p_turno_id;
      end if;
      if v_turno_dueno_220 <> p_usuario_id and not v_finanzas_220 then
        raise exception 'TURNO_AJENO: el turno de caja #% no es tuyo. Recargá la página.', p_turno_id;
      end if;
      if v_turno_estado_220 <> 'abierto' then
        raise exception 'TURNO_CERRADO: el turno #% ya está cerrado; el cobro no se puede cargar contra él.', p_turno_id;
      end if;
    end if;
  end if;

  -- REGLA DE ORO (mig 120, espejo para ingresos): un cobro en la caja del
  -- POS entra al cajón y se computa en el ARQUEO; NO puede además acreditar
  -- una cuenta de tesorería (contaría el efectivo dos veces).
  if p_cuenta_id is not null and p_turno_id is not null then
    raise exception 'Un cobro en caja no puede acreditar una cuenta (doble conteo del efectivo).';
  end if;
  if p_cuenta_id is null and p_turno_id is null then
    raise exception 'Indicá de dónde entra la plata: caja del turno o cuenta de tesorería.';
  end if;
  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto del cobro debe ser mayor a 0.';
  end if;
  if p_deudor_tipo is null or p_deudor_tipo not in ('cliente', 'empleado') then
    raise exception 'Tipo de deudor inválido: %', coalesce(p_deudor_tipo, '(null)');
  end if;
  if public.fn_periodo_cerrado(v_fecha) then
    raise exception 'El período contable de esa fecha está cerrado.';
  end if;

  -- Permisos: cobrar por tesorería exige el permiso de fiado; cobrar en caja
  -- alcanza con ser el dueño del turno ABIERTO (el cajero cobra sin permiso
  -- de finanzas, igual que registra ventas).
  if p_cuenta_id is not null then
    if not (select public.fn_tiene_permiso('cuenta_corriente')) then
      raise exception 'No tenés permiso para cobrar desde una cuenta de tesorería.';
    end if;
  else
    if not exists (
      select 1 from public.caja_turnos
      where id = p_turno_id and estado = 'abierto'
        and (usuario_id = auth.uid() or auth.uid() is null)
    ) and not (select public.fn_tiene_permiso('cuenta_corriente')) then
      raise exception 'Solo podés cobrar fiado contra tu propio turno abierto.';
    end if;
  end if;

  -- Deudor + saldo, con FOR UPDATE del deudor (serializa contra un fiado
  -- simultáneo de fn_crear_venta, que bloquea la misma fila).
  if p_deudor_tipo = 'cliente' then
    select nombre into v_nombre from public.clientes where id = p_deudor_id for update;
    select coalesce(sum(monto), 0) into v_saldo
      from public.cuenta_corriente_cliente where cliente_id = p_deudor_id;
  else
    select btrim(coalesce(nombre, '') || ' ' || coalesce(apellido, '')) into v_nombre
      from public.empleados where id = p_deudor_id for update;
    select coalesce(sum(monto), 0) into v_saldo
      from public.cuenta_corriente_empleado where empleado_id = p_deudor_id;
  end if;
  if v_nombre is null then raise exception 'El deudor no existe.'; end if;
  if p_monto > v_saldo + 0.009 then
    raise exception 'El cobro ($%) supera la deuda ($%).', round(p_monto, 2), round(v_saldo, 2);
  end if;

  select id into v_cta_deudores from public.plan_cuentas where codigo = '1.1.03';

  if p_cuenta_id is not null then
    -- ── Cobro por tesorería: acredita la cuenta elegida. ──
    select tipo, coalesce(es_caja_fuerte, false), saldo_actual
      into v_tipo_cuenta, v_es_boveda, v_saldo_cta
      from public.cuentas where id = p_cuenta_id for update;
    if v_saldo_cta is null then raise exception 'La cuenta de destino no existe.'; end if;
    v_saldo_nuevo := v_saldo_cta + p_monto;
    insert into public.movimientos_cuenta (
      cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo,
      descripcion, categoria, referencia_tipo, referencia_id, usuario_id, fecha
    ) values (
      p_cuenta_id, 'ingreso', p_monto, v_saldo_cta, v_saldo_nuevo,
      'Cobro cta. cte. · ' || v_nombre, 'cobro_cta_cte', 'cta_cte', p_deudor_id,
      p_usuario_id, v_fecha
    ) returning id into v_mov_id;
    update public.cuentas set saldo_actual = v_saldo_nuevo, updated_at = now()
      where id = p_cuenta_id;
    v_cta_debe := case v_tipo_cuenta
      when 'caja' then (select id from public.plan_cuentas where codigo = '1.1.01')
      else (select id from public.plan_cuentas where codigo = '1.1.02')
    end;
  else
    -- ── Cobro en la caja del POS: NO toca movimientos_cuenta (candado 118).
    --    La plata queda en el cajón; el esperado del cierre la suma vía
    --    fn_cobros_fiado_turno y entra a la bóveda por sangría + arqueo. ──
    v_cta_debe := (select id from public.plan_cuentas where codigo = '1.1.01');
  end if;

  if v_cta_deudores is not null and v_cta_debe is not null then
    insert into public.asientos (fecha, descripcion, tipo, origen, referencia_id, usuario_id)
    values (v_fecha, 'Cobro cta. cte. · ' || v_nombre, 'automatico', 'cobro_cta_cte',
            p_deudor_id, p_usuario_id)
    returning id into v_asiento_id;
    insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
    values (v_asiento_id, v_cta_debe, p_monto, 0, 0);
    insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
    values (v_asiento_id, v_cta_deudores, 0, p_monto, 1);
  end if;

  if p_deudor_tipo = 'cliente' then
    insert into public.cuenta_corriente_cliente
      (cliente_id, fecha, tipo, concepto, monto, turno_id, cuenta_id, movimiento_id, asiento_id, usuario_id)
    values (p_deudor_id, v_fecha, 'pago_libre',
            coalesce(nullif(btrim(p_nota), ''), 'Cobro de cuenta corriente'),
            -p_monto, p_turno_id, p_cuenta_id, v_mov_id, v_asiento_id, p_usuario_id)
    returning id into v_cc_id;
  else
    insert into public.cuenta_corriente_empleado
      (empleado_id, fecha, tipo, concepto, monto, turno_id, cuenta_id, movimiento_id, asiento_id, usuario_id)
    values (p_deudor_id, v_fecha, 'pago_libre',
            coalesce(nullif(btrim(p_nota), ''), 'Cobro de cuenta corriente'),
            -p_monto, p_turno_id, p_cuenta_id, v_mov_id, v_asiento_id, p_usuario_id)
    returning id into v_cc_id;
  end if;

  return jsonb_build_object(
    'movimiento_cta_cte_id', v_cc_id,
    'saldo_anterior', v_saldo,
    'saldo_nuevo', v_saldo - p_monto,
    'asiento_id', v_asiento_id,
    'movimiento_id', v_mov_id
  );
end $$;

revoke all on function public.fn_cobrar_cta_cte(text, integer, numeric, uuid, integer, integer, date, text) from public, anon;
grant execute on function public.fn_cobrar_cta_cte(text, integer, numeric, uuid, integer, integer, date, text) to authenticated, service_role;

notify pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────────
-- Chequeos post-migración (correr a mano):
--   T1 (0 filas):
--     select proname, count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname = 'public' and proname like 'fn_%' group by proname having count(*) > 1;
--   anon sin acceso (las dos false):
--     select has_function_privilege('anon', 'public.fn_crear_devolucion(integer,uuid,integer,text,text,integer,jsonb)', 'execute'),
--            has_function_privilege('anon', 'public.fn_cobrar_cta_cte(text,integer,numeric,uuid,integer,integer,date,text)', 'execute');
-- ─────────────────────────────────────────────────────────────────────
