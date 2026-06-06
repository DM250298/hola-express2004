-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 062: venta por peso a nivel base de datos (numérico)     ║
-- ║                                                                     ║
-- ║  La migración 040 agregó productos.venta_por_peso pero NUNCA        ║
-- ║  completó el soporte: las columnas de stock/cantidad seguían en    ║
-- ║  integer y fn_crear_venta casteaba la cantidad a integer, así que  ║
-- ║  vender 0.8 kg tiraba "invalid input syntax for type integer:0.8"  ║
-- ║  y revertía toda la venta (no llegaba nada a cuentas/movimientos). ║
-- ║                                                                     ║
-- ║  Este fix:                                                          ║
-- ║   1) Pasa a numeric(12,3) las columnas de cantidad/stock del       ║
-- ║      circuito de venta (stock, items_venta, movimientos, lotes,    ║
-- ║      items_ajuste).                                                 ║
-- ║   2) Reissue de fn_crear_venta, fn_crear_ajuste_stock y            ║
-- ║      fn_anular_venta con variables numeric (sobre sus versiones    ║
-- ║      vigentes: 058, 051 y 053 respectivamente).                    ║
-- ║                                                                     ║
-- ║  Fase 2 (pendiente): fn_recibir_pedido, fn_crear_devolucion y      ║
-- ║  fn_aprobar_conteo para peso fraccionado. Mientras tanto, cargá    ║
-- ║  stock por peso con Ajuste. Recibir/devolver/contar un producto    ║
-- ║  por peso con fracción dará error (rollback seguro), no corrompe.  ║
-- ║                                                                     ║
-- ║  Cambiar integer→numeric es ensanchar: no rompe productos por      ║
-- ║  unidad (5 se guarda como 5.000). types/database.ts no cambia      ║
-- ║  (numeric e integer mapean ambos a number).                        ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────────────────────
-- 0. Dependencia de la 058 (IIBB): la fn_crear_venta de abajo la usa.
--    Idempotente: si ya corriste la 058, no hace nada.
-- ─────────────────────────────────────────────────────────────────────
alter table public.cuentas
  add column if not exists retencion_iibb_porcentaje numeric(5,2) not null default 0;

-- ─────────────────────────────────────────────────────────────────────
-- 1. Columnas de cantidad/stock → numeric(12,3)
--    La vista_cobertura_stock (060) depende de productos.stock_actual e
--    items_venta.cantidad, así que hay que dropearla antes de alterar y
--    recrearla después (Postgres no deja alterar columnas usadas por views).
-- ─────────────────────────────────────────────────────────────────────
drop view if exists public.vista_cobertura_stock;

alter table public.productos        alter column stock_actual    type numeric(12,3);
alter table public.items_venta      alter column cantidad        type numeric(12,3);
alter table public.movimientos_stock alter column cantidad       type numeric(12,3);
alter table public.lotes            alter column cantidad_actual  type numeric(12,3);
alter table public.lotes            alter column cantidad_inicial type numeric(12,3);
alter table public.items_ajuste_stock alter column cantidad       type numeric(12,3);
alter table public.items_ajuste_stock alter column stock_anterior type numeric(12,3);
alter table public.items_ajuste_stock alter column stock_final    type numeric(12,3);

-- Recrear la vista idéntica a la 060 (ahora sobre las columnas numeric)
create view public.vista_cobertura_stock as
with serie as (
  select generate_series(
    (current_date - interval '13 days')::date, current_date, interval '1 day'
  )::date as dia
),
ventas_por_dia as (
  select
    iv.producto_id,
    (v.fecha at time zone 'America/Argentina/La_Rioja')::date as dia,
    sum(iv.cantidad)::numeric as cantidad
  from public.items_venta iv
  join public.ventas v on v.id = iv.venta_id
  where v.estado = 'completada'
    and v.fecha >= (current_date - interval '13 days')::timestamptz
  group by iv.producto_id, (v.fecha at time zone 'America/Argentina/La_Rioja')::date
),
productos_dias as (
  select distinct vd.producto_id, s.dia
  from ventas_por_dia vd cross join serie s
),
combinado as (
  select pd.producto_id, pd.dia, coalesce(vd.cantidad, 0)::numeric as cantidad
  from productos_dias pd
  left join ventas_por_dia vd on vd.producto_id = pd.producto_id and vd.dia = pd.dia
),
agregado as (
  select
    producto_id,
    sum(cantidad)::numeric as ventas_14d,
    round((sum(cantidad) / 14.0)::numeric, 3) as promedio_diario,
    jsonb_agg(cantidad::numeric order by dia) as serie_14d
  from combinado group by producto_id
)
select
  p.id as producto_id,
  p.stock_actual,
  coalesce(a.ventas_14d, 0)::numeric as ventas_14d,
  coalesce(a.promedio_diario, 0)::numeric as promedio_diario,
  case when coalesce(a.promedio_diario, 0) = 0 then null
       else round((p.stock_actual / a.promedio_diario)::numeric, 1) end as dias_cobertura,
  coalesce(a.serie_14d, '[0,0,0,0,0,0,0,0,0,0,0,0,0,0]'::jsonb) as serie_14d
from public.productos p
left join agregado a on a.producto_id = p.id
where p.activo = true;

comment on view public.vista_cobertura_stock is
  'Cobertura de stock por producto activo. Calcula días de cobertura y serie de ventas últimos 14 días.';

-- ─────────────────────────────────────────────────────────────────────
-- 2. fn_crear_venta v7 = v6 (058, IIBB) con cantidad/stock numeric
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
  v_iibb_pct numeric; v_iibb_monto numeric; v_dias_acred integer;
  v_pago_venta_id integer; v_saldo numeric; v_saldo_nuevo numeric;
  v_nc record; v_nc_codigo text;
  v_prod_id integer; v_cantidad numeric; v_precio numeric;
  v_stock_ant numeric; v_stock_nuevo numeric; v_lote record;
  v_restante numeric; v_usar numeric; v_costo_unit numeric;
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
    v_comision_monto := round(v_monto * v_comision) / 100;

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
      v_saldo_nuevo := v_saldo + v_monto;
      insert into public.movimientos_cuenta (cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo,
        descripcion, categoria, referencia_tipo, referencia_id, usuario_id, fecha)
      values (v_cuenta_id, 'ingreso', v_monto, v_saldo, v_saldo_nuevo,
        'Venta #' || v_venta.id || ' · ' || v_medio, 'venta', 'venta', v_venta.id, p_usuario_id, v_hoy);
      if v_comision_monto > 0 then
        insert into public.movimientos_cuenta (cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo,
          descripcion, categoria, referencia_tipo, referencia_id, usuario_id, fecha)
        values (v_cuenta_id, 'egreso', v_comision_monto, v_saldo_nuevo, v_saldo_nuevo - v_comision_monto,
          'Comision ' || v_medio || ' (' || v_comision || '%) Venta #' || v_venta.id,
          'comisiones', 'venta', v_venta.id, p_usuario_id, v_hoy);
        v_saldo_nuevo := v_saldo_nuevo - v_comision_monto;
      end if;
      v_iibb_monto := round(v_monto * v_iibb_pct) / 100;
      if v_iibb_monto > 0 then
        insert into public.movimientos_cuenta (cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo,
          descripcion, categoria, referencia_tipo, referencia_id, usuario_id, fecha)
        values (v_cuenta_id, 'egreso', v_iibb_monto, v_saldo_nuevo, v_saldo_nuevo - v_iibb_monto,
          'Retención IIBB (' || v_iibb_pct || '%) · Venta #' || v_venta.id,
          'iibb', 'venta', v_venta.id, p_usuario_id, v_hoy);
        v_saldo_nuevo := v_saldo_nuevo - v_iibb_monto;
      end if;
      update public.cuentas set saldo_actual = v_saldo_nuevo, updated_at = v_ahora where id = v_cuenta_id;
    end if;
  end loop;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_prod_id := (v_item->>'producto_id')::integer;
    v_cantidad := (v_item->>'cantidad')::numeric;
    v_precio := (v_item->>'precio_unitario')::numeric;
    select stock_actual into v_stock_ant from public.productos where id = v_prod_id for update;
    v_stock_ant := coalesce(v_stock_ant, 0);
    v_costo_unit := public.fn_costo(v_prod_id);
    v_stock_nuevo := v_stock_ant - v_cantidad;
    v_total_costo := v_total_costo + v_costo_unit * v_cantidad;
    insert into public.items_venta (venta_id, producto_id, cantidad, precio_unitario, subtotal)
    values (v_venta.id, v_prod_id, v_cantidad, v_precio, v_precio * v_cantidad);
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
-- 3. fn_crear_ajuste_stock (base 051, fn_costo) con cantidad/stock numeric
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_crear_ajuste_stock(
  p_usuario_id uuid, p_razon text, p_razon_detalle text, p_items jsonb
) returns public.ajustes_stock
language plpgsql security definer set search_path = public
as $$
declare
  v_ahora timestamptz := now();
  v_ajuste public.ajustes_stock;
  v_item jsonb;
  v_prod_id integer;
  v_tipo text;
  v_cantidad numeric;
  v_stock_ant numeric;
  v_costo numeric;
  v_stock_final numeric;
  v_diferencia numeric;
  v_subtotal numeric;
  v_mov_cant numeric;
  v_total numeric := 0;
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Agregá al menos un producto al ajuste.';
  end if;

  insert into public.ajustes_stock (usuario_id, razon, razon_detalle, total_costo, cantidad_items)
  values (p_usuario_id, p_razon, p_razon_detalle, 0, jsonb_array_length(p_items))
  returning * into v_ajuste;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_prod_id := (v_item->>'producto_id')::integer;
    v_tipo := v_item->>'tipo';
    v_cantidad := (v_item->>'cantidad')::numeric;
    if v_cantidad is null or v_cantidad < 0 then
      raise exception 'Cantidad inválida en un producto del ajuste.';
    end if;

    select stock_actual into v_stock_ant from public.productos where id = v_prod_id for update;
    if v_stock_ant is null then raise exception 'Producto inexistente en el ajuste.'; end if;
    v_costo := public.fn_costo(v_prod_id);

    if v_tipo = 'entrada' then v_stock_final := v_stock_ant + v_cantidad;
    elsif v_tipo = 'salida' then v_stock_final := v_stock_ant - v_cantidad;
    else v_stock_final := v_cantidad; end if;
    if v_stock_final < 0 then
      raise exception 'El ajuste dejaría el stock negativo en un producto.';
    end if;

    v_diferencia := abs(v_stock_final - v_stock_ant);
    v_subtotal := v_diferencia * v_costo;
    v_total := v_total + v_subtotal;
    v_mov_cant := case when v_tipo = 'ajuste' then v_diferencia else v_cantidad end;

    update public.productos set stock_actual = v_stock_final, updated_at = v_ahora where id = v_prod_id;
    insert into public.movimientos_stock (
      producto_id, tipo, cantidad, stock_anterior, stock_nuevo, referencia_id, usuario_id, nota
    ) values (
      v_prod_id, v_tipo::public.tipo_movimiento, v_mov_cant, v_stock_ant, v_stock_final,
      v_ajuste.id, p_usuario_id, 'Ajuste #' || v_ajuste.id || ' · ' || p_razon
    );
    insert into public.items_ajuste_stock (
      ajuste_id, producto_id, tipo, cantidad, stock_anterior, stock_final, costo_unitario, subtotal
    ) values (
      v_ajuste.id, v_prod_id, v_tipo, v_cantidad, v_stock_ant, v_stock_final, v_costo, v_subtotal
    );
  end loop;

  update public.ajustes_stock set total_costo = v_total where id = v_ajuste.id;
  v_ajuste.total_costo := v_total;
  return v_ajuste;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 4. fn_anular_venta v4 = v3 (053) con stock numeric
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
begin
  select estado, fecha::date, total into v_estado, v_fecha, v_total
    from public.ventas where id = p_venta_id for update;
  if v_estado is null then raise exception 'La venta no existe.'; end if;
  if v_estado <> 'completada' then raise exception 'La venta ya estaba anulada.'; end if;
  if public.fn_periodo_cerrado(v_fecha) then
    raise exception 'El período de esa venta está cerrado; no se puede anular.';
  end if;

  for v_item in select producto_id, cantidad from public.items_venta where venta_id = p_venta_id loop
    select stock_actual into v_stock_ant from public.productos where id = v_item.producto_id for update;
    if v_stock_ant is null then continue; end if;
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

notify pgrst, 'reload schema';
