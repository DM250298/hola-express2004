-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 153 · Listas de precios: minorista / mayorista           ║
-- ║                                                                     ║
-- ║  PROBLEMA: el sistema vende con un único precio (precio_venta).     ║
-- ║  El negocio necesita vender también al por mayor con un precio      ║
-- ║  distinto por producto, elegible por cliente o a mano en el POS.    ║
-- ║                                                                     ║
-- ║  DISEÑO (2 listas fijas, sin tabla genérica):                       ║
-- ║   · productos.{precio_mayorista, margen_mayorista} nullable, PAR    ║
-- ║     COHERENTE como el minorista (precio_venta/margen). NULL = el    ║
-- ║     producto no tiene lista mayorista → fallback: se vende a        ║
-- ║     precio minorista aunque la venta sea mayorista.                 ║
-- ║   · clientes.lista_precio: lista asignada al cliente (el POS la     ║
-- ║     aplica sola al elegirlo; el cajero puede pisar con el toggle).  ║
-- ║   · items_venta.lista_precio = lista APLICADA a ese ítem (captura   ║
-- ║     el fallback ítem por ítem). ventas.lista_precio derivada:       ║
-- ║     'mayorista' si algún ítem lo es.                                ║
-- ║   · La lista viaja como clave opcional 'lista_precio' DENTRO de     ║
-- ║     cada ítem de p_items (patrón deudor-en-p_pagos de la v10):      ║
-- ║     la FIRMA de fn_crear_venta NO cambia. Payloads viejos (cola     ║
-- ║     offline, cobros_terminal.items persistidos) no traen la clave   ║
-- ║     → coalesce a 'minorista' (correcto: se vendieron a ese precio). ║
-- ║   · El precio mayorista NO encola etiquetas (trg_etiqueta_precio    ║
-- ║     solo mira precio_venta — góndola = minorista, no se toca).      ║
-- ║   · fn_guardar_factura_compra v14: con afecta_precio_venta, el      ║
-- ║     precio mayorista se recalcula SIEMPRE desde SU margen (margen   ║
-- ║     manda; no hay precio mayorista manual en la factura). Sin       ║
-- ║     margen_mayorista → queda como estaba.                           ║
-- ║                                                                     ║
-- ║  Firmas intactas en ambas RPCs → create or replace limpio, sin      ║
-- ║  DROP. Correr el chequeo T1 después (debe dar 0 duplicados).        ║
-- ║  REQUIERE: migs 140 (fn_crear_venta v10) y 138 (factura v13).       ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────────────────────
-- 1. Columnas nuevas.
-- ─────────────────────────────────────────────────────────────────────
alter table public.productos
  add column if not exists precio_mayorista numeric(12,2),
  add column if not exists margen_mayorista numeric;

alter table public.clientes
  add column if not exists lista_precio text not null default 'minorista'
    constraint clientes_lista_precio_check check (lista_precio in ('minorista','mayorista'));

alter table public.ventas
  add column if not exists lista_precio text not null default 'minorista'
    constraint ventas_lista_precio_check check (lista_precio in ('minorista','mayorista'));

alter table public.items_venta
  add column if not exists lista_precio text not null default 'minorista'
    constraint items_venta_lista_precio_check check (lista_precio in ('minorista','mayorista'));

-- ─────────────────────────────────────────────────────────────────────
-- 2. fn_crear_venta v11 · v10 (mig 140) ÍNTEGRA + lista de precios.
--    Misma firma de 7 args → create or replace limpio.
--    Cambios marcados con "v11".
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_crear_venta(
  p_turno_id integer, p_usuario_id uuid, p_pagos jsonb, p_items jsonb,
  p_cliente_uuid uuid default null, p_cliente_id integer default null,
  p_forzar_turno boolean default false
) returns public.ventas
language plpgsql security definer set search_path = public
as $$
declare
  v_total numeric := 0; v_medio_principal text; v_venta public.ventas;
  v_hoy date := current_date; v_ahora timestamptz := now();
  v_pago jsonb; v_item jsonb; v_medio text; v_monto numeric;
  v_cuenta_id integer; v_comision numeric; v_comision_monto numeric;
  v_comision_override numeric; v_iibb_override numeric;
  v_iibb_pct numeric; v_iibb_monto numeric; v_dias_acred integer;
  v_desc_comision text; v_desc_iibb text;
  v_pago_venta_id integer; v_saldo numeric; v_saldo_nuevo numeric;
  v_nc record; v_nc_codigo text;
  v_prod_id integer; v_cantidad numeric; v_precio numeric;
  v_stock_ant numeric; v_stock_nuevo numeric; v_lote record;
  v_restante numeric; v_usar numeric; v_costo_unit numeric;
  v_controlar boolean;
  v_comp record; v_cant_comp numeric; v_nombre_combo text;
  v_total_costo numeric := 0; v_pagos_no_efec numeric := 0;
  v_neto numeric; v_iva numeric; v_efectivo numeric; v_no_efec numeric;
  v_asiento_id integer; v_orden integer := 0;
  v_cta_ventas integer; v_cta_iva integer; v_cta_caja integer;
  v_cta_banco integer; v_cta_cmv integer; v_cta_merc integer;
  -- v10: fiado (cuenta corriente)
  v_pagos_ctacte numeric := 0; v_ctacte numeric;
  v_deudor_tipo text; v_deudor_id integer;
  v_deudor_nombre text; v_deudor_activo boolean;
  v_limite numeric; v_saldo_deuda numeric;
  v_cta_deudores integer; v_cc_cliente_id integer;
  v_cc_ya_fiado boolean := false;
  -- v11: lista de precios de la venta y del ítem
  v_lista_venta text := 'minorista';
  v_item_lista text;
begin
  if p_cliente_uuid is not null then
    select * into v_venta from public.ventas where cliente_uuid = p_cliente_uuid;
    if found then return v_venta; end if;
  end if;
  if p_pagos is null or jsonb_array_length(p_pagos) = 0 then
    raise exception 'La venta debe tener al menos un pago.';
  end if;

  -- p_forzar_turno es un bypass PRIVILEGIADO (imputar a un turno cerrado): solo
  -- lo puede usar el servidor. Con service_role auth.uid() es null (webhook /
  -- conciliación → pasa); un usuario logueado que lo intente por rpc directo
  -- (auth.uid() no null) es rechazado. Mismo idiom que la mig 088.
  if p_forzar_turno and auth.uid() is not null then
    raise exception 'p_forzar_turno está reservado al servidor (service_role).';
  end if;

  -- El turno de caja debe estar abierto para registrar la venta, SALVO que
  -- se fuerce (p_forzar_turno = true): el webhook/conciliación de un cobro
  -- con terminal ya aprobado imputa la venta a su turno original aunque esté
  -- cerrado (la plata con tarjeta va a la cuenta/clearing, no al arqueo).
  if not p_forzar_turno and not exists (
    select 1 from public.caja_turnos where id = p_turno_id and estado = 'abierto'
  ) then
    raise exception 'No hay un turno de caja abierto para registrar la venta.';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_total := v_total + (v_item->>'precio_unitario')::numeric * (v_item->>'cantidad')::numeric;
    -- v11: payloads viejos (cola offline / cobros_terminal previos al deploy)
    -- no traen la clave → coalesce a minorista. Valor inválido = fail-loud.
    v_item_lista := coalesce(nullif(v_item->>'lista_precio', ''), 'minorista');
    if v_item_lista not in ('minorista', 'mayorista') then
      raise exception 'Lista de precios inválida: %', v_item_lista;
    end if;
    if v_item_lista = 'mayorista' then v_lista_venta := 'mayorista'; end if;
  end loop;

  select p->>'medio_pago' into v_medio_principal
  from jsonb_array_elements(p_pagos) p order by (p->>'monto')::numeric desc limit 1;

  -- El header se inserta atajando la carrera POS ↔ webhook: si otra
  -- transacción ya creó esta venta (mismo cliente_uuid, índice único parcial
  -- ventas_cliente_uuid_key de la mig 027), devolvemos la existente como éxito
  -- idempotente en vez de reventar con unique_violation.
  begin
    insert into public.ventas (turno_id, usuario_id, total, medio_pago, estado, cliente_uuid, cliente_id, lista_precio)
    values (p_turno_id, p_usuario_id, v_total, v_medio_principal, 'completada', p_cliente_uuid, p_cliente_id, v_lista_venta)
    returning * into v_venta;
  exception when unique_violation then
    select * into v_venta from public.ventas where cliente_uuid = p_cliente_uuid;
    return v_venta;
  end;

  for v_pago in select * from jsonb_array_elements(p_pagos) loop
    insert into public.pagos_venta (venta_id, medio_pago, monto)
    values (v_venta.id, v_pago->>'medio_pago', (v_pago->>'monto')::numeric)
    returning id into v_pago_venta_id;
    v_medio := v_pago->>'medio_pago'; v_monto := (v_pago->>'monto')::numeric;

    -- v10: el fiado no es efectivo NI banco → acumulador propio para que el
    -- asiento lo mande a Deudores por Ventas y no a Bancos.
    if v_medio = 'cuenta_corriente' then
      v_pagos_ctacte := v_pagos_ctacte + v_monto;
    elsif v_medio <> 'efectivo' then
      v_pagos_no_efec := v_pagos_no_efec + v_monto;
    end if;

    if v_medio = 'nota_credito' then
      v_nc_codigo := v_pago->>'nc_codigo';
      if v_nc_codigo is null or btrim(v_nc_codigo) = '' then
        raise exception 'Falta el código de la nota de crédito.'; end if;
      select * into v_nc from public.notas_credito where codigo = v_nc_codigo and estado = 'activa' for update;
      if not found then raise exception 'Nota de crédito % no válida o ya usada.', v_nc_codigo; end if;
      if v_nc.saldo_disponible + 0.01 < v_monto then
        raise exception 'Saldo insuficiente en la nota de crédito (disp. %).', v_nc.saldo_disponible; end if;
      update public.notas_credito
        set saldo_disponible = saldo_disponible - v_monto,
            estado = case when saldo_disponible - v_monto <= 0.005 then 'usada' else 'activa' end
        where id = v_nc.id;
      continue;
    end if;

    -- ── v10 · CUENTA CORRIENTE (fiado). Molde: branch nota_credito. ──
    -- El pago NO mueve plata: genera deuda del cliente o del empleado.
    -- El medio existe en medios_pago con cuenta_id NULL, así que aun sin
    -- este branch nunca acreditaría nada — acá además valida y carga.
    if v_medio = 'cuenta_corriente' then
      if v_cc_ya_fiado then
        raise exception 'Solo puede haber una línea de cuenta corriente por venta.';
      end if;
      v_cc_ya_fiado := true;

      v_deudor_tipo := v_pago->>'deudor_tipo';
      v_deudor_id   := nullif(v_pago->>'deudor_id', '')::integer;

      if v_deudor_tipo is null or v_deudor_tipo not in ('cliente', 'empleado')
         or v_deudor_id is null then
        raise exception 'Falta indicar a quién se le fía (cliente o empleado).';
      end if;
      if v_monto is null or v_monto <= 0 then
        raise exception 'El monto de la cuenta corriente debe ser mayor a 0.';
      end if;

      -- FOR UPDATE sobre la fila del deudor: serializa dos fiados
      -- simultáneos al mismo deudor → el control de tope no se burla.
      if v_deudor_tipo = 'cliente' then
        select c.nombre, c.activo into v_deudor_nombre, v_deudor_activo
          from public.clientes c where c.id = v_deudor_id for update;
        v_cc_cliente_id := v_deudor_id;
      else
        select btrim(coalesce(e.nombre, '') || ' ' || coalesce(e.apellido, '')), e.activo
          into v_deudor_nombre, v_deudor_activo
          from public.empleados e where e.id = v_deudor_id for update;
      end if;
      if v_deudor_nombre is null then
        raise exception 'El deudor de la cuenta corriente no existe.';
      end if;
      if not coalesce(v_deudor_activo, false) then
        raise exception 'La cuenta de % está dada de baja; no se le puede fiar.', v_deudor_nombre;
      end if;

      -- Tope de crédito: BLOQUEA (decisión del dueño). Sin fila o 0 = no se fía.
      if v_deudor_tipo = 'cliente' then
        select coalesce(l.monto, 0) into v_limite from public.limite_credito l
          where l.cliente_id = v_deudor_id;
        select coalesce(sum(x.monto), 0) into v_saldo_deuda
          from public.cuenta_corriente_cliente x where x.cliente_id = v_deudor_id;
      else
        select coalesce(l.monto, 0) into v_limite from public.limite_credito l
          where l.empleado_id = v_deudor_id;
        select coalesce(sum(x.monto), 0) into v_saldo_deuda
          from public.cuenta_corriente_empleado x where x.empleado_id = v_deudor_id;
      end if;
      v_limite := coalesce(v_limite, 0);

      -- Tolerancia de centavo, como el resto del sistema (0.009). El prefijo
      -- CTACTE_LIMITE lo usa el front para un toast entendible.
      if v_saldo_deuda + v_monto > v_limite + 0.009 then
        raise exception
          'CTACTE_LIMITE: % no tiene cupo para fiar $%. Debe $% y su tope es $%.',
          v_deudor_nombre, round(v_monto, 2), round(v_saldo_deuda, 2), round(v_limite, 2);
      end if;

      if v_deudor_tipo = 'cliente' then
        insert into public.cuenta_corriente_cliente
          (cliente_id, fecha, tipo, concepto, monto, venta_id, turno_id, usuario_id)
        values (v_deudor_id, v_hoy, 'consumo', 'Venta #' || v_venta.id,
                v_monto, v_venta.id, p_turno_id, p_usuario_id);
      else
        insert into public.cuenta_corriente_empleado
          (empleado_id, fecha, tipo, concepto, monto, venta_id, turno_id, usuario_id)
        values (v_deudor_id, v_hoy, 'consumo', 'Venta #' || v_venta.id,
                v_monto, v_venta.id, p_turno_id, p_usuario_id);
      end if;

      continue;
    end if;

    select cuenta_id, coalesce(comision_porcentaje, 0), coalesce(dias_acreditacion, 0)
      into v_cuenta_id, v_comision, v_dias_acred from public.medios_pago where codigo = v_medio;
    if v_cuenta_id is null then continue; end if;

    -- Overrides reales de MP (pesos). Si no vienen, se calcula con la tabla.
    v_comision_override := nullif(v_pago->>'comision_monto', '')::numeric;
    v_iibb_override := nullif(v_pago->>'iibb_monto', '')::numeric;
    v_comision_monto := coalesce(v_comision_override, round(v_monto * v_comision) / 100);

    if v_dias_acred > 0 then
      insert into public.acreditaciones (
        venta_id, pago_venta_id, medio_pago, cuenta_id, monto_bruto, comision_pct,
        comision_monto, monto_neto, fecha_venta, fecha_estimada, estado, usuario_id
      ) values (
        v_venta.id, v_pago_venta_id, v_medio, v_cuenta_id, v_monto, v_comision,
        v_comision_monto, v_monto - v_comision_monto, v_hoy, v_hoy + v_dias_acred, 'pendiente', p_usuario_id);
    else
      select saldo_actual, coalesce(retencion_iibb_porcentaje, 0)
        into v_saldo, v_iibb_pct from public.cuentas where id = v_cuenta_id for update;
      if v_saldo is null then continue; end if;
      v_iibb_monto := coalesce(v_iibb_override, round(v_monto * v_iibb_pct) / 100);

      v_saldo_nuevo := v_saldo + v_monto;
      insert into public.movimientos_cuenta (cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo,
        descripcion, categoria, referencia_tipo, referencia_id, usuario_id, fecha)
      values (v_cuenta_id, 'ingreso', v_monto, v_saldo, v_saldo_nuevo,
        'Venta #' || v_venta.id || ' · ' || v_medio, 'venta', 'venta', v_venta.id, p_usuario_id, v_hoy);

      if v_comision_monto > 0 then
        v_desc_comision := case
          when v_comision_override is not null
            then 'Comisión ' || v_medio || ' (MP real) · Venta #' || v_venta.id
          else 'Comision ' || v_medio || ' (' || v_comision || '%) Venta #' || v_venta.id
        end;
        insert into public.movimientos_cuenta (cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo,
          descripcion, categoria, referencia_tipo, referencia_id, usuario_id, fecha)
        values (v_cuenta_id, 'egreso', v_comision_monto, v_saldo_nuevo, v_saldo_nuevo - v_comision_monto,
          v_desc_comision, 'comisiones', 'venta', v_venta.id, p_usuario_id, v_hoy);
        v_saldo_nuevo := v_saldo_nuevo - v_comision_monto;
      end if;

      if v_iibb_monto > 0 then
        v_desc_iibb := case
          when v_iibb_override is not null
            then 'Retención IIBB (MP real) · Venta #' || v_venta.id
          else 'Retención IIBB (' || v_iibb_pct || '%) · Venta #' || v_venta.id
        end;
        insert into public.movimientos_cuenta (cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo,
          descripcion, categoria, referencia_tipo, referencia_id, usuario_id, fecha)
        values (v_cuenta_id, 'egreso', v_iibb_monto, v_saldo_nuevo, v_saldo_nuevo - v_iibb_monto,
          v_desc_iibb, 'iibb', 'venta', v_venta.id, p_usuario_id, v_hoy);
        v_saldo_nuevo := v_saldo_nuevo - v_iibb_monto;
      end if;

      update public.cuentas set saldo_actual = v_saldo_nuevo, updated_at = v_ahora where id = v_cuenta_id;
    end if;
  end loop;

  -- v10: si se fió a un cliente del CRM y la venta no traía cliente, se
  -- asocia solo — el historial de compras tiene que incluir lo fiado.
  if p_cliente_id is null and v_cc_cliente_id is not null then
    update public.ventas set cliente_id = v_cc_cliente_id where id = v_venta.id;
    v_venta.cliente_id := v_cc_cliente_id;
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_prod_id := (v_item->>'producto_id')::integer;
    v_cantidad := (v_item->>'cantidad')::numeric;
    v_precio := (v_item->>'precio_unitario')::numeric;
    v_item_lista := coalesce(nullif(v_item->>'lista_precio', ''), 'minorista');  -- v11

    if exists (select 1 from public.producto_componentes where producto_id = v_prod_id) then
      -- ── Combo/pack: el item se registra con el combo, pero el stock,
      --    los lotes y el CMV salen de los COMPONENTES. ──
      insert into public.items_venta (venta_id, producto_id, cantidad, precio_unitario, subtotal, lista_precio)
      values (v_venta.id, v_prod_id, v_cantidad, v_precio, v_precio * v_cantidad, v_item_lista);

      select nombre into v_nombre_combo from public.productos where id = v_prod_id;

      for v_comp in
        select pc.componente_id, pc.cantidad
        from public.producto_componentes pc
        where pc.producto_id = v_prod_id
        order by pc.id
      loop
        v_cant_comp := v_comp.cantidad * v_cantidad;
        select stock_actual, coalesce(controlar_stock, true)
          into v_stock_ant, v_controlar from public.productos
          where id = v_comp.componente_id for update;
        v_stock_ant := coalesce(v_stock_ant, 0);
        if v_controlar then
          v_costo_unit := public.fn_costo(v_comp.componente_id);
          v_total_costo := v_total_costo + v_costo_unit * v_cant_comp;
          v_stock_nuevo := v_stock_ant - v_cant_comp;
          update public.productos set stock_actual = v_stock_nuevo, updated_at = v_ahora
            where id = v_comp.componente_id;
          insert into public.movimientos_stock (producto_id, tipo, cantidad, stock_anterior, stock_nuevo,
            referencia_id, usuario_id, nota)
          values (v_comp.componente_id, 'venta', v_cant_comp, v_stock_ant, v_stock_nuevo, v_venta.id,
            p_usuario_id, 'Venta #' || v_venta.id || ' (combo ' || coalesce(v_nombre_combo, v_prod_id::text) || ')');
          v_restante := v_cant_comp;
          for v_lote in select id, cantidad_actual from public.lotes
              where producto_id = v_comp.componente_id and estado = 'activo'::public.estado_lote and cantidad_actual > 0
              order by fecha_vencimiento asc for update loop
            exit when v_restante <= 0;
            v_usar := least(v_lote.cantidad_actual, v_restante);
            update public.lotes set cantidad_actual = v_lote.cantidad_actual - v_usar,
              estado = (case when v_lote.cantidad_actual - v_usar = 0 then 'agotado' else 'activo' end)::public.estado_lote
              where id = v_lote.id;
            v_restante := v_restante - v_usar;
          end loop;
        end if;
      end loop;
    else
      -- ── Producto común: idéntico a la v7 (072). ──
      select stock_actual, coalesce(controlar_stock, true)
        into v_stock_ant, v_controlar from public.productos where id = v_prod_id for update;
      v_stock_ant := coalesce(v_stock_ant, 0);

      -- El item se registra siempre.
      insert into public.items_venta (venta_id, producto_id, cantidad, precio_unitario, subtotal, lista_precio)
      values (v_venta.id, v_prod_id, v_cantidad, v_precio, v_precio * v_cantidad, v_item_lista);

      -- Solo los productos con control de stock afectan inventario, movimientos,
      -- lotes y CMV. Los demás (servicios, granel sin control) quedan afuera.
      if v_controlar then
        v_costo_unit := public.fn_costo(v_prod_id);
        v_total_costo := v_total_costo + v_costo_unit * v_cantidad;
        v_stock_nuevo := v_stock_ant - v_cantidad;
        update public.productos set stock_actual = v_stock_nuevo, updated_at = v_ahora where id = v_prod_id;
        insert into public.movimientos_stock (producto_id, tipo, cantidad, stock_anterior, stock_nuevo,
          referencia_id, usuario_id, nota)
        values (v_prod_id, 'venta', v_cantidad, v_stock_ant, v_stock_nuevo, v_venta.id, p_usuario_id, 'Venta #' || v_venta.id);
        v_restante := v_cantidad;
        for v_lote in select id, cantidad_actual from public.lotes
            where producto_id = v_prod_id and estado = 'activo'::public.estado_lote and cantidad_actual > 0
            order by fecha_vencimiento asc for update loop
          exit when v_restante <= 0;
          v_usar := least(v_lote.cantidad_actual, v_restante);
          update public.lotes set cantidad_actual = v_lote.cantidad_actual - v_usar,
            estado = (case when v_lote.cantidad_actual - v_usar = 0 then 'agotado' else 'activo' end)::public.estado_lote
            where id = v_lote.id;
          v_restante := v_restante - v_usar;
        end loop;
      end if;
    end if;
  end loop;

  select id into v_cta_ventas from public.plan_cuentas where codigo = '4.1.01';
  select id into v_cta_iva from public.plan_cuentas where codigo = '2.1.02';
  select id into v_cta_caja from public.plan_cuentas where codigo = '1.1.01';
  select id into v_cta_banco from public.plan_cuentas where codigo = '1.1.02';
  select id into v_cta_deudores from public.plan_cuentas where codigo = '1.1.03';  -- v10
  select id into v_cta_cmv from public.plan_cuentas where codigo = '5.1.01';
  select id into v_cta_merc from public.plan_cuentas where codigo = '1.1.04';

  -- v10 fail-loud: si se fió y no existe 1.1.03, el asiento quedaría
  -- descuadrado en silencio. Mejor abortar la venta entera.
  if v_pagos_ctacte > 0 and v_cta_deudores is null then
    raise exception 'Falta la cuenta 1.1.03 Deudores por Ventas en el plan; no se puede fiar.';
  end if;

  if v_total > 0 and v_cta_ventas is not null and v_cta_iva is not null
     and v_cta_caja is not null and v_cta_banco is not null then
    v_neto := round(v_total / 1.21, 2); v_iva := round(v_total - v_neto, 2);
    -- v10 · Prelación: primero el fiado, después lo no-efectivo; el resto
    -- es efectivo (antes: no_efec y el resto efectivo).
    v_ctacte := least(v_pagos_ctacte, v_total);
    v_no_efec := least(v_pagos_no_efec, v_total - v_ctacte);
    v_efectivo := v_total - v_no_efec - v_ctacte;
    insert into public.asientos (fecha, descripcion, tipo, origen, referencia_id, usuario_id)
    values (v_hoy, 'Venta #' || v_venta.id, 'automatico', 'venta', v_venta.id, p_usuario_id)
    returning id into v_asiento_id;
    if v_efectivo > 0 then
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_caja, v_efectivo, 0, v_orden); v_orden := v_orden + 1; end if;
    if v_no_efec > 0 then
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_banco, v_no_efec, 0, v_orden); v_orden := v_orden + 1; end if;
    if v_ctacte > 0 then   -- v10: el fiado debita Deudores por Ventas
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_deudores, v_ctacte, 0, v_orden); v_orden := v_orden + 1; end if;
    insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
    values (v_asiento_id, v_cta_ventas, 0, v_neto, v_orden); v_orden := v_orden + 1;
    insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
    values (v_asiento_id, v_cta_iva, 0, v_iva, v_orden); v_orden := v_orden + 1;
    if v_cta_cmv is not null and v_cta_merc is not null and v_total_costo > 0 then
      v_total_costo := round(v_total_costo, 2);
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_cmv, v_total_costo, 0, v_orden); v_orden := v_orden + 1;
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_merc, 0, v_total_costo, v_orden);
    end if;
  end if;

  -- Cierra el intento de cobro con terminal si esta venta vino de uno: su
  -- cliente_uuid ES el id del intento. Así el POS —que registra al instante—
  -- también deja el intento en 'registrada' y no queda como "sin conciliar"
  -- fantasma hasta que llegue el webhook. Para ventas normales (uuid random)
  -- no matchea ninguna fila → no-op. Security definer: bypassa la RLS.
  if p_cliente_uuid is not null then
    update public.cobros_terminal
      set venta_id = v_venta.id, estado = 'registrada', updated_at = v_ahora
      where id = p_cliente_uuid and venta_id is null;
  end if;

  return v_venta;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 3. fn_guardar_factura_compra v14 · v13 (mig 138) ÍNTEGRA + repriceo
--    del precio mayorista. Misma firma de 9 args → replace limpio.
--    Cambio único marcado con "v14".
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_guardar_factura_compra(
  p_cuenta_id integer,
  p_pedido_id integer,
  p_proveedor_id integer,
  p_fecha date,
  p_afecta_precio_venta boolean,
  p_usuario_id uuid,
  p_lineas jsonb,
  p_percepciones jsonb default '{"iva":0,"iibb":0,"otros":0}'::jsonb,
  p_gastos_no_debitables numeric default 0
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_ahora timestamptz := now();
  v_linea jsonb;
  v_neto numeric := 0;
  v_iva_total numeric := 0;
  v_total numeric := 0;
  v_factura_id integer;
  v_prod_id integer;
  v_costo_sin_iva numeric;
  v_desc numeric;
  v_iva_compra numeric;
  v_margen numeric;
  v_iva_venta numeric;
  v_cant numeric;
  v_costo_neto numeric;
  v_costo_con_iva numeric;
  v_costo_landed numeric;
  v_precio_sin_iva numeric;
  v_precio_con_iva numeric;
  v_asiento_id integer;
  v_cta_merc integer;
  v_cta_iva_cred integer;
  v_cta_prov integer;
  v_costo_ant numeric;
  v_var_pct numeric;
  -- Percepciones
  v_perc_iva numeric := coalesce((p_percepciones->>'iva')::numeric, 0);
  v_perc_iibb numeric := coalesce((p_percepciones->>'iibb')::numeric, 0);
  v_perc_otros numeric := coalesce((p_percepciones->>'otros')::numeric, 0);
  v_cta_perc_iva integer;
  v_cta_perc_iibb integer;
  v_cta_perc_otros integer;
  -- Gastos no debitables
  v_gastos numeric := round(coalesce(p_gastos_no_debitables, 0), 2);
  v_factor numeric := 1;
  v_orden integer := 0;
  -- Reconciliación de stock (v12)
  v_item_pedido_id integer;
  v_venc date;
  v_recibida numeric;
  v_facturada_prev numeric;
  v_reflejada numeric;
  v_delta numeric;
  v_stock_ant numeric;
  v_stock_nuevo numeric;
  -- Precio manual (v13): precio de venta tipeado por fila (par coherente, mig 126)
  v_precio_manual numeric;
begin
  -- Guard de período cerrado (fix v13: la v12 lo había perdido; venía de la 053).
  if public.fn_periodo_cerrado(p_fecha) then
    raise exception 'El período contable de % está cerrado: no se pueden cargar ni editar facturas de ese mes.',
      to_char(p_fecha, 'MM/YYYY');
  end if;

  delete from public.facturas_compra where cuenta_id = p_cuenta_id;

  -- Primer loop: neto e IVA sobre lo GRAVADO (sin los gastos).
  for v_linea in select * from jsonb_array_elements(p_lineas) loop
    v_costo_sin_iva := (v_linea->>'costo_sin_iva')::numeric;
    v_desc := coalesce((v_linea->>'descuento_porcentaje')::numeric, 0);
    v_iva_compra := coalesce((v_linea->>'iva_compra_porcentaje')::numeric, 0);
    v_cant := (v_linea->>'cantidad')::numeric;
    v_costo_neto := round(v_costo_sin_iva * (1 - v_desc / 100), 2);
    v_costo_con_iva := round(v_costo_neto * (1 + v_iva_compra / 100), 2);
    v_neto := v_neto + v_costo_neto * v_cant;
    v_iva_total := v_iva_total + (v_costo_con_iva - v_costo_neto) * v_cant;
  end loop;
  v_neto := round(v_neto, 2);
  v_iva_total := round(v_iva_total, 2);
  v_perc_iva := round(coalesce(v_perc_iva, 0), 2);
  v_perc_iibb := round(coalesce(v_perc_iibb, 0), 2);
  v_perc_otros := round(coalesce(v_perc_otros, 0), 2);

  -- Factor de prorrateo de los gastos no debitables (por neto).
  if v_neto > 0 then
    v_factor := 1 + v_gastos / v_neto;
  end if;

  v_total := round(
    v_neto + v_iva_total + v_perc_iva + v_perc_iibb + v_perc_otros + v_gastos, 2
  );

  insert into public.facturas_compra (
    cuenta_id, pedido_id, proveedor_id, fecha, neto, iva_total, total,
    afecta_precio_venta, usuario_id,
    percepcion_iva, percepcion_iibb, percepcion_otros, gastos_no_debitables
  ) values (
    p_cuenta_id, p_pedido_id, p_proveedor_id, p_fecha, v_neto, v_iva_total, v_total,
    p_afecta_precio_venta, p_usuario_id,
    v_perc_iva, v_perc_iibb, v_perc_otros, v_gastos
  ) returning id into v_factura_id;

  -- Segundo loop: costo LANDED = costo neto × factor (gastos prorrateados)
  -- + RECONCILIACIÓN DE STOCK por renglón del pedido.
  for v_linea in select * from jsonb_array_elements(p_lineas) loop
    v_prod_id := (v_linea->>'producto_id')::integer;
    v_costo_sin_iva := (v_linea->>'costo_sin_iva')::numeric;
    v_desc := coalesce((v_linea->>'descuento_porcentaje')::numeric, 0);
    v_iva_compra := coalesce((v_linea->>'iva_compra_porcentaje')::numeric, 0);
    v_margen := coalesce((v_linea->>'margen_porcentaje')::numeric, 0);
    v_iva_venta := coalesce((v_linea->>'iva_venta_porcentaje')::numeric, 0);
    v_cant := (v_linea->>'cantidad')::numeric;
    v_costo_neto := round(v_costo_sin_iva * (1 - v_desc / 100), 2);
    v_costo_con_iva := round(v_costo_neto * (1 + v_iva_compra / 100), 2);
    v_costo_landed := round(v_costo_neto * v_factor, 2);

    -- ── Lado venta (v13): el precio tipeado manda; sin precio, manda el margen ──
    v_precio_manual := nullif(v_linea->>'precio_venta', '')::numeric;
    if v_precio_manual is not null and v_precio_manual > 0 then
      -- PRECIO MANDA: se respeta tal cual (repricearlo con fn_precio_venta lo
      -- subiría al múltiplo siguiente) y se guarda el PAR COHERENTE deduciendo
      -- el margen real (precedente: mig 126, importación par coherente).
      v_precio_con_iva := round(v_precio_manual, 2);
      v_margen := public.fn_margen_desde_precio(v_costo_landed, v_precio_con_iva, v_iva_venta);
    else
      -- MARGEN MANDA: camino v12 sin cambios (redondea techo a múltiplos).
      v_precio_con_iva := public.fn_precio_venta(v_costo_landed, v_margen, v_iva_venta);
    end if;
    v_precio_sin_iva := round(v_precio_con_iva / (1 + v_iva_venta / 100), 2);

    v_costo_ant := public.fn_costo(v_prod_id);
    if v_costo_ant > 0 and v_costo_landed > 0 and v_costo_landed <> v_costo_ant then
      v_var_pct := round(((v_costo_landed - v_costo_ant) / v_costo_ant) * 100, 2);
      insert into public.historial_costos (
        producto_id, proveedor_id, costo_anterior, costo_nuevo, variacion_pct, origen, pedido_id, usuario_id
      ) values (
        v_prod_id, p_proveedor_id, v_costo_ant, v_costo_landed, v_var_pct, 'factura', p_pedido_id, p_usuario_id
      );
    end if;

    insert into public.items_factura_compra (
      factura_id, producto_id, cantidad, costo_sin_iva,
      descuento_porcentaje, iva_compra_porcentaje, costo_con_iva,
      margen_porcentaje, iva_venta_porcentaje, precio_sin_iva, precio_con_iva
    ) values (
      v_factura_id, v_prod_id, v_cant, v_costo_sin_iva,
      v_desc, v_iva_compra, v_costo_con_iva,
      v_margen, v_iva_venta, v_precio_sin_iva, v_precio_con_iva
    );

    if p_afecta_precio_venta then
      update public.productos
        set precio_venta = v_precio_con_iva,
            margen = v_margen,
            -- v14: el precio MAYORISTA se recalcula SIEMPRE desde SU margen
            -- (margen manda; en la factura no hay precio mayorista manual),
            -- con el mismo costo landed. Sin margen_mayorista → queda igual.
            precio_mayorista = case
              when margen_mayorista is not null
                then public.fn_precio_venta(v_costo_landed, margen_mayorista, v_iva_venta)
              else precio_mayorista
            end,
            pendiente_precio = case when v_precio_con_iva > 0 then false else pendiente_precio end,
            updated_at = v_ahora
        where id = v_prod_id;
    end if;
    perform public.fn_set_costo(v_prod_id, v_costo_landed);

    update public.proveedor_producto set costo = v_costo_landed, updated_at = v_ahora
      where proveedor_id = p_proveedor_id and producto_id = v_prod_id;

    -- ── RECONCILIACIÓN DE STOCK (v12) ─────────────────────────────────
    v_item_pedido_id := nullif(v_linea->>'item_pedido_id', '')::integer;
    v_venc := nullif(v_linea->>'fecha_vencimiento', '')::date;

    if v_item_pedido_id is not null then
      -- Base = lo que el stock ya refleja de este renglón:
      --   antes de la 1ª factura → lo recibido; después → lo ya facturado.
      select cantidad_recibida, cantidad_facturada
        into v_recibida, v_facturada_prev
        from public.items_pedido where id = v_item_pedido_id for update;

      v_reflejada := coalesce(v_facturada_prev, v_recibida, 0);
      v_delta := v_cant - v_reflejada;

      if v_delta <> 0 then
        select stock_actual into v_stock_ant
          from public.productos where id = v_prod_id for update;
        v_stock_ant := coalesce(v_stock_ant, 0);
        v_stock_nuevo := v_stock_ant + v_delta;
        update public.productos set stock_actual = v_stock_nuevo, updated_at = v_ahora
          where id = v_prod_id;

        insert into public.movimientos_stock (
          producto_id, tipo, cantidad, stock_anterior, stock_nuevo,
          referencia_id, usuario_id, nota
        ) values (
          v_prod_id,
          (case when v_delta > 0 then 'entrada' else 'salida' end)::public.tipo_movimiento,
          abs(v_delta), v_stock_ant, v_stock_nuevo,
          p_cuenta_id, p_usuario_id,
          'Factura compra (cuenta #' || p_cuenta_id || '): stock '
            || v_reflejada::text || ' → ' || v_cant::text
        );

        perform public.fn_ajustar_lote_factura(v_prod_id, p_pedido_id, v_delta, v_venc);
      elsif v_venc is not null then
        -- Sin cambio de cantidad: solo corrige el vencimiento del lote.
        update public.lotes set fecha_vencimiento = v_venc
          where producto_id = v_prod_id and pedido_origen_id = p_pedido_id
            and estado = 'activo'::public.estado_lote;
      end if;

      update public.items_pedido
        set precio_costo = v_costo_landed,
            subtotal = round(v_costo_landed * v_cant, 2),
            cantidad_facturada = v_cant
        where id = v_item_pedido_id;
    end if;
  end loop;

  update public.cuentas_a_pagar
    set monto = v_total, provisoria = false, tiene_factura = true
    where id = p_cuenta_id;

  -- pedidos.total = suma de TODAS las facturas cargadas del pedido +
  -- suma de las provisorias que todavía NO tienen factura (su estimado).
  update public.pedidos
    set total = coalesce((
          select sum(fc.total) from public.facturas_compra fc
          where fc.pedido_id = p_pedido_id
        ), 0)
        + coalesce((
          select sum(cap.monto) from public.cuentas_a_pagar cap
          where cap.pedido_id = p_pedido_id and cap.tiene_factura = false
        ), 0),
        updated_at = v_ahora
    where id = p_pedido_id;

  delete from public.asientos where origen = 'factura_compra' and referencia_id = p_cuenta_id;
  select id into v_cta_merc from public.plan_cuentas where codigo = '1.1.04';
  select id into v_cta_iva_cred from public.plan_cuentas where codigo = '1.1.05';
  select id into v_cta_prov from public.plan_cuentas where codigo = '2.1.01';
  select id into v_cta_perc_iva from public.plan_cuentas where codigo = '1.1.07';
  select id into v_cta_perc_iibb from public.plan_cuentas where codigo = '1.1.08';
  select id into v_cta_perc_otros from public.plan_cuentas where codigo = '1.1.09';

  if v_total > 0 and v_cta_merc is not null and v_cta_iva_cred is not null and v_cta_prov is not null then
    insert into public.asientos (fecha, descripcion, tipo, origen, referencia_id, usuario_id)
    values (p_fecha, 'Factura compra · Pedido #' || p_pedido_id, 'automatico', 'factura_compra', p_cuenta_id, p_usuario_id)
    returning id into v_asiento_id;

    insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
    values (v_asiento_id, v_cta_merc, round(v_neto + v_gastos, 2), 0, v_orden);
    v_orden := v_orden + 1;
    if v_iva_total > 0 then
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_iva_cred, v_iva_total, 0, v_orden);
      v_orden := v_orden + 1;
    end if;
    if v_perc_iva > 0 and v_cta_perc_iva is not null then
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_perc_iva, v_perc_iva, 0, v_orden);
      v_orden := v_orden + 1;
    end if;
    if v_perc_iibb > 0 and v_cta_perc_iibb is not null then
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_perc_iibb, v_perc_iibb, 0, v_orden);
      v_orden := v_orden + 1;
    end if;
    if v_perc_otros > 0 and v_cta_perc_otros is not null then
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_perc_otros, v_perc_otros, 0, v_orden);
      v_orden := v_orden + 1;
    end if;
    insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
    values (v_asiento_id, v_cta_prov, 0, v_total, v_orden);
  end if;
end;
$$;

notify pgrst, 'reload schema';
