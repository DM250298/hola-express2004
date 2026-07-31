-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 132 · fn_guardar_factura_compra v12: reconcilia stock     ║
-- ║                                                                     ║
-- ║  v12 = v11 (mig 109) + reconciliación de inventario. La recepción    ║
-- ║  NO se toca: sigue moviendo el stock y creando los lotes al recibir  ║
-- ║  (se vende al toque). Lo NUEVO acá: al guardar/editar la factura,    ║
-- ║  por cada renglón atado a un item del pedido, ajusta el stock por    ║
-- ║  la DIFERENCIA entre la cantidad facturada y lo que el stock ya      ║
-- ║  refleja de ese renglón:                                            ║
-- ║      delta = cantidad_factura − coalesce(cantidad_facturada,        ║
-- ║                                          cantidad_recibida)          ║
-- ║  · delta = 0  → no toca nada (caso normal: la factura coincide).    ║
-- ║  · delta > 0  → suma stock (entrada) y agranda/crea el lote.        ║
-- ║  · delta < 0  → resta stock (salida) y achica el lote.             ║
-- ║  Después guarda cantidad_facturada = cantidad de la factura, así    ║
-- ║  RE-GUARDAR/EDITAR es IDEMPOTENTE (el segundo save ve delta 0).     ║
-- ║                                                                     ║
-- ║  Regla: el número que gobierna stock + plata es la CANTIDAD de la   ║
-- ║  factura (vos decidís cuánto poner). Si el proveedor sobre-factura   ║
-- ║  y vos sabés que llegó menos, dejás la cantidad recibida y no se     ║
-- ║  mueve nada. Los renglones EXTRA (item_pedido_id null, productos que ║
-- ║  no venían en la orden) se facturan pero NO mueven stock en v12      ║
-- ║  (para eso está la recepción / la compra directa).                   ║
-- ║                                                                     ║
-- ║  Vencimiento: p_lineas puede traer 'fecha_vencimiento' (opcional).   ║
-- ║  Si viene, corrige el vencimiento del lote de ese renglón. Va DENTRO ║
-- ║  del jsonb → la firma de la función NO cambia (REPLACE limpio).      ║
-- ║                                                                     ║
-- ║  REQUIERE: migración 131 corrida (columna cantidad_facturada).       ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────────────────────
-- 1. Helper: ajusta el/los lote(s) de un producto de una orden por delta.
--    Solo aplica a perecederos (los que tienen lote de esa orden). Los
--    productos sin lote solo mueven stock_actual. Mantiene la invariante
--    Σ lotes activos ≈ stock del producto para la orden.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_ajustar_lote_factura(
  p_producto_id integer,
  p_pedido_id integer,
  p_delta numeric,
  p_venc date
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_lote_id integer;
  v_lote record;
  v_resto numeric;
  v_quitar numeric;
begin
  if p_delta > 0 then
    -- Suma el delta al lote más nuevo de esta orden; si no hay lote y vino
    -- vencimiento, crea uno nuevo. Sin lote y sin vencimiento → solo stock.
    select id into v_lote_id
      from public.lotes
      where producto_id = p_producto_id and pedido_origen_id = p_pedido_id
        and estado = 'activo'::public.estado_lote
      order by id desc
      limit 1;
    if v_lote_id is not null then
      update public.lotes
        set cantidad_inicial = cantidad_inicial + p_delta,
            cantidad_actual  = cantidad_actual  + p_delta,
            fecha_vencimiento = coalesce(p_venc, fecha_vencimiento)
        where id = v_lote_id;
    elsif p_venc is not null then
      insert into public.lotes (
        producto_id, fecha_vencimiento, cantidad_inicial, cantidad_actual,
        estado, pedido_origen_id
      ) values (
        p_producto_id, p_venc, p_delta, p_delta, 'activo'::public.estado_lote, p_pedido_id
      );
    end if;

  elsif p_delta < 0 then
    -- Quita |delta| de los lotes de esta orden, del más nuevo al más viejo,
    -- sin bajar de 0 (no toca porciones ya consumidas por ventas).
    v_resto := -p_delta;
    for v_lote in
      select id, cantidad_actual, cantidad_inicial
        from public.lotes
        where producto_id = p_producto_id and pedido_origen_id = p_pedido_id
          and estado = 'activo'::public.estado_lote and cantidad_actual > 0
        order by id desc
    loop
      exit when v_resto <= 0;
      v_quitar := least(v_lote.cantidad_actual, v_resto);
      update public.lotes
        set cantidad_actual = cantidad_actual - v_quitar,
            cantidad_inicial = greatest(cantidad_inicial - v_quitar, 0),
            estado = (case when cantidad_actual - v_quitar <= 0
                           then 'agotado' else 'activo' end)::public.estado_lote,
            fecha_vencimiento = coalesce(p_venc, fecha_vencimiento)
        where id = v_lote.id;
      v_resto := v_resto - v_quitar;
    end loop;
  end if;
end;
$$;

revoke execute on function public.fn_ajustar_lote_factura(integer, integer, numeric, date) from public, anon;
grant execute on function public.fn_ajustar_lote_factura(integer, integer, numeric, date) to authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 2. fn_guardar_factura_compra v12 (base v11 mig 109 + reconciliación)
--    Firma IDÉNTICA a la 109 → CREATE OR REPLACE reemplaza limpio.
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
begin
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
    v_precio_con_iva := public.fn_precio_venta(v_costo_landed, v_margen, v_iva_venta);
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
