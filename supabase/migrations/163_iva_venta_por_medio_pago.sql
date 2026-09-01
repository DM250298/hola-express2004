-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 163 · IVA de venta según el medio de pago                ║
-- ║                                                                     ║
-- ║  PROBLEMA: el sistema asume que el 100 % de las ventas genera IVA   ║
-- ║  débito fiscal (total / 1.21, hardcodeado en fn_crear_venta y en    ║
-- ║  lib/queries/fiscal.ts). El dueño NO factura lo cobrado en          ║
-- ║  efectivo: esa parte la declara aparte, a mano. Resultado: la tab   ║
-- ║  Impuestos y el libro diario inflan el débito fiscal con ventas     ║
-- ║  que nunca se documentaron, y el IIBB arrastra el mismo error.      ║
-- ║                                                                     ║
-- ║  DISEÑO:                                                            ║
-- ║   · medios_pago.genera_iva_venta (bool, default true). Se siembra   ║
-- ║     en false SOLO para 'efectivo'; el resto se configura desde la   ║
-- ║     UI (Finanzas › Cuentas › Configuración de cobros).              ║
-- ║   · ventas.{base_gravada, iva_debito}: el resultado se GUARDA en la ║
-- ║     fila en vez de re-derivarse. El asiento contable y la tab       ║
-- ║     Impuestos pasan a leer el mismo número (hoy divergen: la tab    ║
-- ║     usa config_fiscal, el asiento tenía 1.21 fijo).                 ║
-- ║   · base gravada = least(Σ pagos con medio que grava, total).       ║
-- ║     El least() es necesario: ModalCobro manda el monto ENTREGADO,   ║
-- ║     no el imputado (vuelto), y no clampea al total.                 ║
-- ║   · Backfill CONSERVADOR: las ventas existentes quedan con          ║
-- ║     base_gravada = total → los períodos ya presentados muestran     ║
-- ║     exactamente el mismo número que antes. La regla nueva rige      ║
-- ║     desde que se corre esta migración.                              ║
-- ║   · fn_crear_devolucion se prorratea por la proporción gravada de   ║
-- ║     la venta original: sin eso, devolver una venta en efectivo      ║
-- ║     debitaría 2.1.02 por IVA que nunca se acreditó.                 ║
-- ║                                                                     ║
-- ║  Firmas intactas en ambas RPCs → create or replace limpio, sin      ║
-- ║  DROP. Correr el chequeo T1 después (debe dar 0 duplicados).        ║
-- ║  REQUIERE: migs 153 (fn_crear_venta v11) y 140 (devolución v-cc).   ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────────────────────
-- 1. Flag por medio de pago.
-- ─────────────────────────────────────────────────────────────────────
alter table public.medios_pago
  add column if not exists genera_iva_venta boolean not null default true;

comment on column public.medios_pago.genera_iva_venta is
  'false = lo cobrado con este medio NO genera IVA débito fiscal (se declara aparte, a mano).';

-- SOLO por codigo: filtrar por cuenta_id is null agarraría también
-- 'cuenta_corriente' y 'nota_credito', que sí deben generar IVA.
update public.medios_pago set genera_iva_venta = false where codigo = 'efectivo';

-- ─────────────────────────────────────────────────────────────────────
-- 2. Columnas en ventas + backfill conservador.
-- ─────────────────────────────────────────────────────────────────────
alter table public.ventas
  add column if not exists base_gravada numeric(12,2),
  add column if not exists iva_debito   numeric(12,2);

comment on column public.ventas.base_gravada is
  'Porción del total (con IVA) que genera débito fiscal, según el medio de pago.';
comment on column public.ventas.iva_debito is
  'IVA débito fiscal de la venta. Calculado sobre base_gravada, no sobre total.';

-- Backfill: el pasado se comporta exactamente como antes de esta migración.
update public.ventas
   set base_gravada = total,
       iva_debito   = round(total - total / 1.21, 2)
 where base_gravada is null;

-- ─────────────────────────────────────────────────────────────────────
-- 3. RLS de medios_pago: lectura abierta, escritura gateada.
--    Hoy hay una sola policy "todo" (for all, using(true)) de la mig 007:
--    cualquier cajero podría flipear el flag por API directa. Como pasa a
--    ser una palanca fiscal, se cierra la escritura. La LECTURA queda
--    abierta o se rompe el POS (useMediosPagoActivos arma la grilla de
--    cobro). fn_crear_venta es security definer → bypassea RLS igual.
--    Wrapper (select ...) obligatorio: InitPlan, una eval por query (mig 111).
-- ─────────────────────────────────────────────────────────────────────
drop policy if exists "todo" on public.medios_pago;
drop policy if exists "medios_pago_select" on public.medios_pago;
drop policy if exists "medios_pago_write" on public.medios_pago;

create policy "medios_pago_select" on public.medios_pago
  for select to authenticated using (true);

create policy "medios_pago_write" on public.medios_pago
  for all to authenticated
  using      ((select public.fn_tiene_permiso('configuracion'))
           or (select public.fn_tiene_permiso('finanzas')))
  with check ((select public.fn_tiene_permiso('configuracion'))
           or (select public.fn_tiene_permiso('finanzas')));

-- ─────────────────────────────────────────────────────────────────────
-- 4. fn_crear_venta v12 · v11 (mig 153) ÍNTEGRA + IVA por medio de pago.
--    Misma firma de 7 args → create or replace limpio.
--    Cambios marcados con "v12".
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
  -- v12: IVA débito solo sobre lo cobrado con medios que lo generan
  v_pagos_gravados numeric := 0;
  v_base_gravada numeric := 0;
  v_factor_iva numeric;
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

  -- ── v12 · BASE GRAVADA ────────────────────────────────────────────────
  -- Solo la porción cobrada con medios marcados genera_iva_venta produce
  -- débito fiscal. left join + coalesce a true: un código que no esté en
  -- medios_pago ('nota_credito') debe seguir gravando, no desaparecer en
  -- silencio bajando la base sin aviso.
  select coalesce(sum((pg.pago->>'monto')::numeric), 0) into v_pagos_gravados
  from jsonb_array_elements(p_pagos) as pg(pago)
  left join public.medios_pago mp on mp.codigo = pg.pago->>'medio_pago'
  where coalesce(mp.genera_iva_venta, true);

  -- Alícuota real (antes: 1.21 hardcodeado, divergía de la tab Impuestos).
  select 1 + coalesce(iva_alicuota_general, 21) / 100 into v_factor_iva
    from public.config_fiscal where id = 1;
  v_factor_iva := coalesce(v_factor_iva, 1.21);

  -- least(): ModalCobro manda el monto ENTREGADO (vuelto incluido) y no
  -- clampea al total; sin tope la base gravada podría superar al total.
  -- Mismo patrón que el reparto del debe, más abajo.
  v_base_gravada := least(v_pagos_gravados, v_total);
  v_neto := round(v_base_gravada / v_factor_iva, 2);
  v_iva  := round(v_base_gravada - v_neto, 2);

  -- El header se inserta atajando la carrera POS ↔ webhook: si otra
  -- transacción ya creó esta venta (mismo cliente_uuid, índice único parcial
  -- ventas_cliente_uuid_key de la mig 027), devolvemos la existente como éxito
  -- idempotente en vez de reventar con unique_violation.
  begin
    insert into public.ventas (turno_id, usuario_id, total, medio_pago, estado, cliente_uuid, cliente_id, lista_precio,
                               base_gravada, iva_debito)
    values (p_turno_id, p_usuario_id, v_total, v_medio_principal, 'completada', p_cliente_uuid, p_cliente_id, v_lista_venta,
            v_base_gravada, v_iva)
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
    -- v12: v_neto / v_iva ya vienen calculados arriba, sobre la BASE GRAVADA.
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
    -- v12: Ventas absorbe el neto gravado + TODO lo no gravado (el efectivo
    -- que no genera débito fiscal). Sigue cuadrando: (v_total − v_iva) + v_iva.
    insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
    values (v_asiento_id, v_cta_ventas, 0, v_total - v_iva, v_orden); v_orden := v_orden + 1;
    if v_iva > 0 then   -- v12: sin IVA débito no se emite el renglón
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_iva, 0, v_iva, v_orden); v_orden := v_orden + 1; end if;
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
-- 5. fn_crear_devolucion · v-cc (mig 140) ÍNTEGRA + IVA prorrateado.
--    Misma firma de 7 args → create or replace limpio.
--    Cambio único marcado con "v-iva", en el contra-asiento.
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
begin
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

notify pgrst, 'reload schema';
