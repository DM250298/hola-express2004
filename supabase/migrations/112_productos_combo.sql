-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 112 · Productos combo / pack                             ║
-- ║                                                                     ║
-- ║  Un producto tipo 'combo' agrupa otros productos (componentes) con  ║
-- ║  una cantidad cada uno. El combo NO maneja stock propio: al vender  ║
-- ║  se descuenta el stock de los COMPONENTES (con lotes FEFO y CMV al  ║
-- ║  costo real de cada componente). Anulación y devolución reponen los ║
-- ║  componentes, simétrico a la venta.                                 ║
-- ║                                                                     ║
-- ║  · producto_componentes  → BOM plano del combo (sin anidamiento:    ║
-- ║    un combo no puede contener otro combo — trigger lo valida)       ║
-- ║  · fn_crear_venta v8     → base 072 (turno) + expansión de combos   ║
-- ║  · fn_anular_venta       → base 101 (fix enum) + repone componentes ║
-- ║  · fn_crear_devolucion   → base 076 (fraccionado) + componentes     ║
-- ║                                                                     ║
-- ║  La detección de combo en los RPCs es por EXISTENCIA de componentes ║
-- ║  (no por productos.tipo): un 'combo' importado sin componentes      ║
-- ║  cargados sigue vendiendo como producto normal hasta que se arme.   ║
-- ║  productos.tipo es text sin CHECK (079): 'combo' ya es valor válido.║
-- ║                                                                     ║
-- ║  RLS: abierta a authenticated, igual que productos (la composición  ║
-- ║  no expone costos; el costo sigue gateado en costos_producto).      ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────────────────────
-- 1. Tabla de componentes
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.producto_componentes (
  id            serial primary key,
  producto_id   integer not null references public.productos(id) on delete cascade,
  componente_id integer not null references public.productos(id) on delete restrict,
  cantidad      numeric(14,4) not null check (cantidad > 0),
  created_at    timestamptz not null default now(),
  unique (producto_id, componente_id),
  check (producto_id <> componente_id)
);

create index if not exists idx_prod_comp_producto   on public.producto_componentes(producto_id);
create index if not exists idx_prod_comp_componente on public.producto_componentes(componente_id);

-- RLS: mismo criterio que productos (abierta a authenticated).
alter table public.producto_componentes enable row level security;
drop policy if exists "authenticated todo" on public.producto_componentes;
create policy "authenticated todo" on public.producto_componentes
  for all to authenticated using (true) with check (true);

-- ─────────────────────────────────────────────────────────────────────
-- 2. Validación en servidor: sin anidamiento de combos
--    (a) el componente no puede ser a su vez un combo
--    (b) un producto que ya es componente de otro combo no puede
--        convertirse en combo (evita el anidamiento por la otra punta)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_valida_componente_combo()
returns trigger language plpgsql as $$
begin
  if exists (
    select 1 from public.producto_componentes where producto_id = new.componente_id
  ) then
    raise exception 'Un combo no puede contener otro combo (producto %).', new.componente_id;
  end if;
  if exists (
    select 1 from public.producto_componentes where componente_id = new.producto_id
  ) then
    raise exception 'El producto % ya es componente de otro combo; no puede convertirse en combo.', new.producto_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_valida_componente_combo on public.producto_componentes;
create trigger trg_valida_componente_combo
  before insert or update on public.producto_componentes
  for each row execute function public.fn_valida_componente_combo();

-- ─────────────────────────────────────────────────────────────────────
-- 3. fn_crear_venta v8 · base 072 ÍNTEGRA + expansión de combos.
--    Firma idéntica (6 args) → CREATE OR REPLACE reemplaza limpio.
--    Cambio ÚNICO: en el loop de items, si el producto tiene componentes
--    se descuenta el stock de cada componente (cantidad × cant. vendida)
--    con su propio movimiento, lotes FEFO y CMV al fn_costo del
--    componente. El item de venta se registra igual (el ticket muestra
--    el combo). El combo en sí no toca stock ni lotes propios.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_crear_venta(
  p_turno_id integer, p_usuario_id uuid, p_pagos jsonb, p_items jsonb,
  p_cliente_uuid uuid default null, p_cliente_id integer default null
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
begin
  if p_cliente_uuid is not null then
    select * into v_venta from public.ventas where cliente_uuid = p_cliente_uuid;
    if found then return v_venta; end if;
  end if;
  if p_pagos is null or jsonb_array_length(p_pagos) = 0 then
    raise exception 'La venta debe tener al menos un pago.';
  end if;

  -- El turno de caja debe estar abierto para registrar la venta.
  if not exists (
    select 1 from public.caja_turnos where id = p_turno_id and estado = 'abierto'
  ) then
    raise exception 'No hay un turno de caja abierto para registrar la venta.';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_total := v_total + (v_item->>'precio_unitario')::numeric * (v_item->>'cantidad')::numeric;
  end loop;

  select p->>'medio_pago' into v_medio_principal
  from jsonb_array_elements(p_pagos) p order by (p->>'monto')::numeric desc limit 1;

  insert into public.ventas (turno_id, usuario_id, total, medio_pago, estado, cliente_uuid, cliente_id)
  values (p_turno_id, p_usuario_id, v_total, v_medio_principal, 'completada', p_cliente_uuid, p_cliente_id)
  returning * into v_venta;

  for v_pago in select * from jsonb_array_elements(p_pagos) loop
    insert into public.pagos_venta (venta_id, medio_pago, monto)
    values (v_venta.id, v_pago->>'medio_pago', (v_pago->>'monto')::numeric)
    returning id into v_pago_venta_id;
    v_medio := v_pago->>'medio_pago'; v_monto := (v_pago->>'monto')::numeric;
    if v_medio <> 'efectivo' then v_pagos_no_efec := v_pagos_no_efec + v_monto; end if;

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

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_prod_id := (v_item->>'producto_id')::integer;
    v_cantidad := (v_item->>'cantidad')::numeric;
    v_precio := (v_item->>'precio_unitario')::numeric;

    if exists (select 1 from public.producto_componentes where producto_id = v_prod_id) then
      -- ── Combo/pack: el item se registra con el combo, pero el stock,
      --    los lotes y el CMV salen de los COMPONENTES. ──
      insert into public.items_venta (venta_id, producto_id, cantidad, precio_unitario, subtotal)
      values (v_venta.id, v_prod_id, v_cantidad, v_precio, v_precio * v_cantidad);

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
      insert into public.items_venta (venta_id, producto_id, cantidad, precio_unitario, subtotal)
      values (v_venta.id, v_prod_id, v_cantidad, v_precio, v_precio * v_cantidad);

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
  select id into v_cta_cmv from public.plan_cuentas where codigo = '5.1.01';
  select id into v_cta_merc from public.plan_cuentas where codigo = '1.1.04';

  if v_total > 0 and v_cta_ventas is not null and v_cta_iva is not null
     and v_cta_caja is not null and v_cta_banco is not null then
    v_neto := round(v_total / 1.21, 2); v_iva := round(v_total - v_neto, 2);
    v_no_efec := least(v_pagos_no_efec, v_total); v_efectivo := v_total - v_no_efec;
    insert into public.asientos (fecha, descripcion, tipo, origen, referencia_id, usuario_id)
    values (v_hoy, 'Venta #' || v_venta.id, 'automatico', 'venta', v_venta.id, p_usuario_id)
    returning id into v_asiento_id;
    if v_efectivo > 0 then
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_caja, v_efectivo, 0, v_orden); v_orden := v_orden + 1; end if;
    if v_no_efec > 0 then
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_banco, v_no_efec, 0, v_orden); v_orden := v_orden + 1; end if;
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
  return v_venta;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 4. fn_anular_venta · base 101 ÍNTEGRA + reposición de componentes.
--    Cambio ÚNICO: en el loop de items, si el producto tiene componentes
--    se repone el stock de cada componente (simétrico con la venta v8).
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
      v_mov.cuenta_id, v_tipo_opuesto::public.tipo_movimiento_cuenta, v_mov.monto, v_saldo, v_saldo_nuevo,
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
-- 5. fn_crear_devolucion · base 076 ÍNTEGRA + componentes.
--    Cambio ÚNICO: en el loop de items, si el producto devuelto tiene
--    componentes, se reponen (o merman) los componentes en lugar del
--    combo. El reembolso y los items_devolucion no cambian.
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
