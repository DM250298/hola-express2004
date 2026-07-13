-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 109 · fn_precio_venta (motor de pricing en SQL) +         ║
-- ║  fn_guardar_factura_compra v11                                       ║
-- ║                                                                     ║
-- ║  PROBLEMA: cargar una factura con "Afectar precio de venta" pisaba  ║
-- ║  el precio del producto con la fórmula multiplicativa vieja          ║
-- ║  (costo × (1+margen) × (1+IVA)), que no cubre IIBB + imp. créd/déb  ║
-- ║  + comisión MP → deshacía el margen asegurado por el motor nuevo    ║
-- ║  (lib/pricing, ver ESPECIFICACION-PRICING.md).                       ║
-- ║                                                                     ║
-- ║  1. fn_precio_venta(costo, margen%, iva_venta%): el motor traducido ║
-- ║     a SQL. Lee la MISMA config editable que el motor TS:            ║
-- ║       · config_fiscal → IIBB, imp. créd/déb, IVA general,           ║
-- ║         redondeo_multiplo, condicion_iva (requiere migración 108)   ║
-- ║       · medios_pago  → comisión MP del peor caso (max de los medios ║
-- ║         mapeados a MP)                                              ║
-- ║     Divide por (1 − cargas), redondea SIEMPRE hacia arriba al       ║
-- ║     múltiplo, y con divisor ≤ 0 lanza excepción (nunca un precio    ║
-- ║     inválido). El espejo TS es lib/pricing/motor.ts: si se cambia   ║
-- ║     una fórmula hay que cambiar la otra (hay test de paridad en     ║
-- ║     scripts/paridad-precio-sql.ts).                                 ║
-- ║                                                                     ║
-- ║  2. fn_guardar_factura_compra v11 = v10 (mig 107) con dos cambios:  ║
-- ║     · el precio de venta se calcula vía fn_precio_venta (las dos    ║
-- ║       líneas de v_precio_*), y                                      ║
-- ║     · al afectar el precio también se guarda productos.margen =     ║
-- ║       v_margen, para que el margen del producto quede en sincronía  ║
-- ║       con el usado en la factura (el Drawer y futuros repricings    ║
-- ║       parten de ese margen).                                        ║
-- ║     Firma idéntica → REPLACE limpio.                                 ║
-- ║                                                                     ║
-- ║  REQUIERE: migración 108 corrida (columnas de config_fiscal).       ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────────────────────
-- 1. fn_precio_venta — motor de precios con margen asegurado (SQL)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_precio_venta(
  p_costo numeric,
  p_margen_pct numeric,
  p_iva_venta_pct numeric default null
) returns numeric
language plpgsql stable set search_path = public
as $$
declare
  v_cfg record;
  v_iva numeric;        -- IVA general (fracción) — grava la comisión de MP
  v_iva_venta numeric;  -- IVA de venta del producto (fracción) — neto↔total
  v_com_ef numeric;     -- comisión MP peor caso, CON IVA, fracción
  v_cargas numeric;
  v_divisor numeric;
  v_ganancia numeric;
  v_final numeric;
  v_multiplo numeric;
begin
  if p_costo is null or p_costo < 0 then
    raise exception 'fn_precio_venta: el costo debe ser >= 0 (recibido %).', p_costo;
  end if;

  select iibb_alicuota, iva_alicuota_general, impuesto_deb_cred_alicuota,
         redondeo_multiplo, condicion_iva
    into v_cfg
    from public.config_fiscal where id = 1;
  if not found then
    raise exception 'fn_precio_venta: falta config_fiscal (id=1).';
  end if;

  v_iva := v_cfg.iva_alicuota_general / 100;
  v_iva_venta := coalesce(p_iva_venta_pct, v_cfg.iva_alicuota_general) / 100;
  v_multiplo := v_cfg.redondeo_multiplo;

  -- Peor caso de comisión MP: medios_pago.comision_porcentaje se guarda CON
  -- IVA (convención del repo: tasa publicada × 1.21), que es exactamente la
  -- comisión efectiva del motor (tasa_sin_iva × (1+IVA)). Solo cuentan los
  -- medios mapeados a Mercado Pago; efectivo/transferencia quedan fuera.
  select coalesce(max(comision_porcentaje), 0) / 100
    into v_com_ef
    from public.medios_pago
    where (mp_payment_type is not null or mp_channel is not null)
      and comision_porcentaje > 0;

  v_cargas := v_cfg.iibb_alicuota / 100
            + v_cfg.impuesto_deb_cred_alicuota / 100
            + v_com_ef;
  v_ganancia := p_costo * p_margen_pct / 100;

  if v_cfg.condicion_iva = 'monotributista' then
    -- Monotributo: sin discriminar IVA; todo sobre el precio final.
    -- (El costo pasado debería ser CON IVA — el mono no recupera crédito.)
    v_divisor := 1 - v_cargas;
    if v_divisor <= 0 then
      raise exception 'fn_precio_venta: divisor inválido (%). Las cargas superan el 100%% del precio; revisá las tasas.', round(v_divisor, 6);
    end if;
    v_final := (p_costo + v_ganancia) / v_divisor;
  else
    -- Responsable Inscripto: las cargas (sobre el total) se llevan a base
    -- neta multiplicando por (1 + IVA venta del producto). El IVA de la
    -- venta no es carga (el RI lo remite, es neutro).
    v_divisor := 1 - v_cargas * (1 + v_iva_venta);
    if v_divisor <= 0 then
      raise exception 'fn_precio_venta: divisor inválido (%). Las cargas superan el 100%% del precio; revisá las tasas.', round(v_divisor, 6);
    end if;
    v_final := ((p_costo + v_ganancia) / v_divisor) * (1 + v_iva_venta);
  end if;

  -- Redondeo comercial: SIEMPRE techo al múltiplo (nunca round ni floor:
  -- redondear para abajo erosiona el margen garantizado).
  return ceil(v_final / v_multiplo) * v_multiplo;
end;
$$;

comment on function public.fn_precio_venta(numeric, numeric, numeric) is
  'Motor de precios con margen asegurado: precio = (costo + ganancia) / (1 − cargas), cargas = IIBB + imp. créd/déb + comisión MP peor caso (todas sobre el total cobrado). Config en config_fiscal + medios_pago. Redondea techo al múltiplo. Espejo TS: lib/pricing/motor.ts.';

-- ─────────────────────────────────────────────────────────────────────
-- 2. fn_guardar_factura_compra v11 = v10 (mig 107) + fn_precio_venta
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

  -- Segundo loop: costo LANDED = costo neto × factor (gastos prorrateados).
  for v_linea in select * from jsonb_array_elements(p_lineas) loop
    v_prod_id := (v_linea->>'producto_id')::integer;
    v_costo_sin_iva := (v_linea->>'costo_sin_iva')::numeric;
    v_desc := coalesce((v_linea->>'descuento_porcentaje')::numeric, 0);
    v_iva_compra := coalesce((v_linea->>'iva_compra_porcentaje')::numeric, 0);
    v_margen := coalesce((v_linea->>'margen_porcentaje')::numeric, 0);
    v_iva_venta := coalesce((v_linea->>'iva_venta_porcentaje')::numeric, 0);
    v_cant := (v_linea->>'cantidad')::numeric;
    v_costo_neto := round(v_costo_sin_iva * (1 - v_desc / 100), 2);
    -- IVA del comprobante: sobre el neto GRAVADO (sin gastos).
    v_costo_con_iva := round(v_costo_neto * (1 + v_iva_compra / 100), 2);
    -- Costo real del producto: incluye los gastos prorrateados.
    v_costo_landed := round(v_costo_neto * v_factor, 2);
    -- ── CAMBIO v11 ──────────────────────────────────────────────────
    -- Precio de venta con el MOTOR (margen asegurado neto de cargas),
    -- sobre el costo ya prorrateado. Antes: multiplicativo viejo
    -- (costo × (1+margen) × (1+IVA)) que erosionaba el margen.
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
      -- Al fijar el precio de venta, el producto deja de estar "pendiente de
      -- precio" (queda habilitado para el POS) si quedó con precio > 0.
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
    update public.items_pedido
      set precio_costo = v_costo_landed, subtotal = round(v_costo_landed * v_cant, 2)
      where id = (v_linea->>'item_pedido_id')::integer;
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

    -- Mercadería capitaliza el neto + los gastos no debitables.
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
