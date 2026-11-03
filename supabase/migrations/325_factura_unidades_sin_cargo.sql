-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 325 · Factura con orden: unidades SIN CARGO              ║
-- ║                                                                     ║
-- ║  Pedido del dueño (2026-11-03): "compro 6 Benedictino y me dan 1    ║
-- ║  gratis; necesito cargar las unidades free para que entren al       ║
-- ║  stock, no quiero un descuento". Hasta acá la única forma era 7     ║
-- ║  unidades con 14,29 % de descuento (no coincide con el papel y baja ║
-- ║  el costo) y, si la recepción contaba las 7, facturar 6 SACABA una  ║
-- ║  del stock (la reconciliación comparaba cantidad vs. recibido).     ║
-- ║                                                                     ║
-- ║  · items_factura_compra.cantidad_sin_cargo e                        ║
-- ║    items_pedido.cantidad_sin_cargo (numeric(12,3) ≥ 0, default 0).  ║
-- ║    cantidad sigue siendo SOLO lo pagado: neto, IVA, asiento, Libro  ║
-- ║    IVA y la validación de extras no cambian.                        ║
-- ║  · fn_guardar_factura_compra v26 (cuerpo íntegro de la v25, mig     ║
-- ║    322; MISMA firma de 12 args → create or replace, sin drop):      ║
-- ║    clave OPCIONAL cantidad_sin_cargo en p_lineas (un cliente viejo  ║
-- ║    no la manda → 0). El stock refleja pagadas + sin cargo           ║
-- ║    (renglones de la orden y extras). El costo del producto sigue    ║
-- ║    siendo el unitario PAGADO (decisión del dueño: el regalo no baja ║
-- ║    el costo ni el margen) y un renglón con 0 pagadas no fija costo. ║
-- ║  · fn_anular_factura_compra v3 (cuerpo de la v2, mig 166): revierte ║
-- ║    pagadas + sin cargo y deja cantidad_sin_cargo en 0.              ║
-- ║  · fn_validar_factura_compra v2 (cuerpo de la 303): compara pagadas ║
-- ║    + sin cargo contra lo recibido.                                  ║
-- ║  Compra directa (fn_registrar_compra_directa) NO se toca.           ║
-- ║  Test: supabase/tests/test_factura_unidades_sin_cargo.sql           ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ──────────────────────────────────────────────────────────────────
-- 1. Columnas
-- ──────────────────────────────────────────────────────────────────
alter table public.items_factura_compra
  add column if not exists cantidad_sin_cargo numeric(12,3) not null default 0;
alter table public.items_factura_compra
  drop constraint if exists items_factura_compra_sin_cargo_chk;
alter table public.items_factura_compra
  add constraint items_factura_compra_sin_cargo_chk check (cantidad_sin_cargo >= 0);
comment on column public.items_factura_compra.cantidad_sin_cargo is
  'Unidades SIN CARGO del renglón (mig 325): entran a stock junto con cantidad pero no suman al neto, al IVA ni al costo. cantidad = SOLO lo pagado (Libro IVA, asiento y validación no cambian).';

alter table public.items_pedido
  add column if not exists cantidad_sin_cargo numeric(12,3) not null default 0;
alter table public.items_pedido
  drop constraint if exists items_pedido_sin_cargo_chk;
alter table public.items_pedido
  add constraint items_pedido_sin_cargo_chk check (cantidad_sin_cargo >= 0);
comment on column public.items_pedido.cantidad_sin_cargo is
  'Unidades sin cargo confirmadas por la factura vigente de este renglón (mig 325), paralelo a cantidad_facturada. El stock refleja cantidad_facturada + cantidad_sin_cargo; fn_anular_factura_compra la vuelve a 0.';

comment on column public.facturas_compra.diferencia_recepcion is
  'Σ (facturada + sin cargo − recibida) × precio_costo de los renglones de la orden al validar (mig 325: una sin cargo faltante se valúa al costo del renglón, aproximación) + el neto de los extras. NULL = sin orden o sin validar.';
comment on column public.facturas_compra.renglones_diferentes is
  'Renglones cuya cantidad pagada + sin cargo difiere de la recibida (incluye extras). Mig 325. NULL = sin orden o sin validar.';

-- ──────────────────────────────────────────────────────────────────
-- 2. fn_guardar_factura_compra v26 (cuerpo de la v25, mig 322; misma firma)
-- ──────────────────────────────────────────────────────────────────
create or replace function public.fn_guardar_factura_compra(
  p_cuenta_id integer,
  p_pedido_id integer,
  p_proveedor_id integer,
  p_fecha date,
  p_afecta_precio_venta boolean,
  p_usuario_id uuid,
  p_lineas jsonb,
  p_percepciones jsonb default '{"iva":0,"iibb":0,"otros":0}'::jsonb,
  p_gastos_no_debitables numeric default 0,
  p_pago jsonb default null,
  p_redondeo numeric default 0,
  p_cuotas jsonb default null  -- v18: null = no tocar el plan · [] = quitarlo · [..] = redefinirlo
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  -- Fecha "hoy" del NEGOCIO (La Rioja), no la UTC del server (mig 147).
  v_hoy date := (now() at time zone 'America/Argentina/La_Rioja')::date;
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
  v_costo_lista_landed numeric;  -- v22: costo pre-descuento × factor (pricing de bonificadas)
  v_base_precio numeric;         -- v22: cascada landed → lista landed → costo conservado
  v_precio_sin_iva numeric;
  v_precio_con_iva numeric;
  v_asiento_id integer;
  v_cta_merc integer;
  v_cta_iva_cred integer;
  v_cta_prov integer;
  v_cta_dif integer;
  v_costo_ant numeric;
  v_var_pct numeric;
  -- Percepciones
  v_perc_iva numeric := coalesce((p_percepciones->>'iva')::numeric, 0);
  v_perc_iibb numeric := coalesce((p_percepciones->>'iibb')::numeric, 0);
  v_perc_otros numeric := coalesce((p_percepciones->>'otros')::numeric, 0);
  v_cta_perc_iva integer;
  v_cta_perc_iibb integer;
  v_cta_perc_otros integer;
  -- Gastos no debitables + redondeo del comprobante (v16)
  v_gastos numeric := round(coalesce(p_gastos_no_debitables, 0), 2);
  v_redondeo numeric := round(coalesce(p_redondeo, 0), 2);
  v_factor numeric := 1;
  v_orden integer := 0;
  -- Reconciliación de stock (v12)
  v_item_pedido_id integer;
  v_venc date;
  v_recibida numeric;
  v_facturada_prev numeric;
  v_reflejada numeric;
  v_delta numeric;
  -- v26 (mig 325): unidades SIN CARGO del renglón. Entran a stock, no al neto.
  v_sin_cargo numeric;
  v_sin_cargo_prev numeric;
  v_unidades numeric;  -- v_cant + v_sin_cargo = lo que el stock debe reflejar
  v_stock_ant numeric;
  v_stock_nuevo numeric;
  -- Precio manual (v13): precio de venta tipeado por fila (par coherente, mig 126)
  v_precio_manual numeric;
  -- Pagos previos + pagos integrados (v14/v15) / programados (v16)
  v_aplicado numeric := 0;
  v_pagado_prev numeric;
  v_pagos jsonb;
  v_pago jsonb;
  v_pago_cuenta integer;
  v_pago_monto numeric;
  v_pago_fecha date;
  -- Renglones EXTRA, sin renglón de orden (v23, mig 166): no los recibió
  -- nadie, así que el stock lo mueve la factura. v_extra_prev = lo que ya
  -- aplicó la carga anterior de esta misma cuenta (baseline del delta);
  -- v_extras_nuevos = los que siguen siendo extra en esta pasada.
  v_extra_prev jsonb := '{}'::jsonb;
  v_extras_nuevos jsonb := '[]'::jsonb;
  v_stock_aplicada numeric;
  v_ex record;
begin
  -- Guard de permiso (v14): SECURITY DEFINER + delete/reescritura de stock,
  -- costos y asientos → no puede quedar ejecutable sin gate. Los tres puntos
  -- de entrada de la UI ya exigen 'finanzas'.
  if not (select public.fn_tiene_permiso('finanzas')) then
    raise exception 'No tenés permiso para cargar facturas de compra.';
  end if;

  -- Guard de período cerrado (fix v13: la v12 lo había perdido; venía de la 053).
  if public.fn_periodo_cerrado(p_fecha) then
    raise exception 'El período contable de % está cerrado: no se pueden cargar ni editar facturas de ese mes.',
      to_char(p_fecha, 'MM/YYYY');
  end if;

  -- Lock de la deuda ANTES de leer sus pagos (v14): un fn_pagar_cuenta
  -- concurrente (que lockea esta misma fila al arrancar) espera a que esta
  -- transacción commitee, y la re-derivación de estado de más abajo nunca
  -- trabaja con un aplicado viejo.
  select coalesce(monto_pagado, 0) into v_pagado_prev
    from public.cuentas_a_pagar where id = p_cuenta_id for update;
  if not found then
    raise exception 'La cuenta a pagar #% no existe.', p_cuenta_id;
  end if;
  select coalesce(sum(monto - coalesce(sobrante, 0)), 0) into v_aplicado
    from public.pagos_cuenta where cuenta_a_pagar_id = p_cuenta_id;
  if v_aplicado = 0 and v_pagado_prev > 0 then
    v_aplicado := v_pagado_prev;  -- compat con pagos legacy sin fila en pagos_cuenta
  end if;

  -- v23: foto del stock que YA metieron los renglones extra de la carga
  -- anterior —se lee ANTES del delete, que borra sus items en cascada— y de
  -- los productos que siguen siendo extra ahora. Con esto re-guardar la misma
  -- cantidad es delta 0, y el barrido del final devuelve el stock de los
  -- extras que sacaron de la factura.
  select coalesce(jsonb_object_agg(t.producto_id::text, t.aplicada), '{}'::jsonb)
    into v_extra_prev
    from (
      select ifc.producto_id, sum(ifc.cantidad_stock_aplicada) as aplicada
        from public.items_factura_compra ifc
        join public.facturas_compra fc on fc.id = ifc.factura_id
       where fc.cuenta_id = p_cuenta_id
         and ifc.producto_id is not null
         and ifc.cantidad_stock_aplicada <> 0
       group by ifc.producto_id
    ) t;
  select coalesce(jsonb_agg(distinct l->>'producto_id'), '[]'::jsonb)
    into v_extras_nuevos
    from jsonb_array_elements(p_lineas) l
   where nullif(l->>'item_pedido_id', '') is null;

  delete from public.facturas_compra where cuenta_id = p_cuenta_id;

  -- Primer loop: neto e IVA sobre lo GRAVADO (sin los gastos).
  for v_linea in select * from jsonb_array_elements(p_lineas) loop
    v_costo_sin_iva := (v_linea->>'costo_sin_iva')::numeric;
    v_desc := coalesce((v_linea->>'descuento_porcentaje')::numeric, 0);
    v_iva_compra := coalesce((v_linea->>'iva_compra_porcentaje')::numeric, 0);
    v_cant := (v_linea->>'cantidad')::numeric;
    -- v26 (mig 325): unidades SIN CARGO (clave opcional de p_lineas: un
    -- cliente viejo no la manda → 0). Redondeo a 3 decimales = numeric(12,3),
    -- así el delta aplicado es exactamente lo que queda guardado. trim_scale
    -- saca los ceros de la escala (round deja '1.000') para que la nota del
    -- movimiento diga '(1 sin cargo)' y no '(1.000 sin cargo)'.
    v_sin_cargo := trim_scale(round(coalesce(nullif(v_linea->>'cantidad_sin_cargo', '')::numeric, 0), 3));
    if v_sin_cargo < 0 then
      raise exception 'Las unidades sin cargo no pueden ser negativas (producto #%).', v_linea->>'producto_id';
    end if;
    v_unidades := v_cant + v_sin_cargo;
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

  -- v16: el redondeo del comprobante entra al total (así el total del sistema
  -- da EXACTO como el papel). No prorratea al costo ni genera IVA crédito.
  v_total := round(
    v_neto + v_iva_total + v_perc_iva + v_perc_iibb + v_perc_otros + v_gastos + v_redondeo, 2
  );

  -- Guard v14: el total no puede quedar por debajo de lo ya APLICADO en pagos
  -- (aplicado = Σ(monto − sobrante): un sobrepago legítimo no bloquea
  -- re-ediciones; se leyó arriba, ya con la deuda lockeada).
  if v_aplicado > v_total + 0.009 then
    raise exception 'El total de la factura (%) es menor a lo ya pagado (%). Anulá los pagos primero.',
      v_total, v_aplicado;
  end if;

  insert into public.facturas_compra (
    cuenta_id, pedido_id, proveedor_id, fecha, neto, iva_total, total,
    afecta_precio_venta, usuario_id,
    percepcion_iva, percepcion_iibb, percepcion_otros, gastos_no_debitables, redondeo
  ) values (
    p_cuenta_id, p_pedido_id, p_proveedor_id, p_fecha, v_neto, v_iva_total, v_total,
    p_afecta_precio_venta, p_usuario_id,
    v_perc_iva, v_perc_iibb, v_perc_otros, v_gastos, v_redondeo
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
    -- v26 (mig 325): unidades SIN CARGO (clave opcional de p_lineas: un
    -- cliente viejo no la manda → 0). Redondeo a 3 decimales = numeric(12,3),
    -- así el delta aplicado es exactamente lo que queda guardado. trim_scale
    -- saca los ceros de la escala (round deja '1.000') para que la nota del
    -- movimiento diga '(1 sin cargo)' y no '(1.000 sin cargo)'.
    v_sin_cargo := trim_scale(round(coalesce(nullif(v_linea->>'cantidad_sin_cargo', '')::numeric, 0), 3));
    if v_sin_cargo < 0 then
      raise exception 'Las unidades sin cargo no pueden ser negativas (producto #%).', v_linea->>'producto_id';
    end if;
    v_unidades := v_cant + v_sin_cargo;
    v_costo_neto := round(v_costo_sin_iva * (1 - v_desc / 100), 2);
    v_costo_con_iva := round(v_costo_neto * (1 + v_iva_compra / 100), 2);
    v_costo_landed := round(v_costo_neto * v_factor, 2);

    -- v23: el renglón de la orden y el vencimiento se leen ACÁ (antes salían
    -- más abajo, en la reconciliación) porque el insert de la línea necesita
    -- saber si es un EXTRA que mueve stock por sí solo.
    v_item_pedido_id := nullif(v_linea->>'item_pedido_id', '')::integer;
    v_venc := nullif(v_linea->>'fecha_vencimiento', '')::date;
    -- v26: un extra mete al stock pagadas + sin cargo; el marcador guarda el
    -- total (anular y el barrido de extras lo revierten entero).
    v_stock_aplicada := case when v_item_pedido_id is null then v_unidades else 0 end;

    -- v20: el costo previo se lee ANTES del lado venta — con una bonificada
    -- (landed $0) es la base para deducir el margen del par coherente.
    -- v21: coalesce — fn_costo devuelve NULL si el producto no tiene fila en
    -- costos_producto, y fn_margen_desde_precio revienta con p_costo NULL.
    v_costo_ant := coalesce(public.fn_costo(v_prod_id), 0);

    -- v22: base del lado VENTA en cascada. El descuento del comprobante se
    -- ignora SOLO para pricear (el regalo se vende como el pagado); el lado
    -- compra (neto, IVA, landed, costo guardado) no cambia. Espejo del
    -- cliente: costoPricing = costoFinal > 0 ? costoFinal : lista × factor.
    v_costo_lista_landed := round(v_costo_sin_iva * v_factor, 2);
    v_base_precio := case
      when v_costo_landed > 0 then v_costo_landed
      when v_costo_lista_landed > 0 then v_costo_lista_landed
      else v_costo_ant
    end;

    -- ── Lado venta (v13): el precio tipeado manda; sin precio, manda el margen ──
    v_precio_manual := nullif(v_linea->>'precio_venta', '')::numeric;
    if v_precio_manual is not null and v_precio_manual > 0 then
      -- PRECIO MANDA: se respeta tal cual (repricearlo con fn_precio_venta lo
      -- subiría al múltiplo siguiente) y se guarda el PAR COHERENTE deduciendo
      -- el margen real (precedente: mig 126, importación par coherente).
      -- v22: bonificada (landed $0) → el margen se deduce contra la MISMA
      -- cascada (lista landed → conservado), igual que muestra la UI.
      v_precio_con_iva := round(v_precio_manual, 2);
      v_margen := public.fn_margen_desde_precio(v_base_precio, v_precio_con_iva, v_iva_venta);
    else
      -- MARGEN MANDA (v22): con la base en cascada una bonificada con costo
      -- de lista da precio real (redondea techo a múltiplos, camino v12).
      v_precio_con_iva := public.fn_precio_venta(v_base_precio, v_margen, v_iva_venta);
    end if;
    v_precio_sin_iva := round(v_precio_con_iva / (1 + v_iva_venta / 100), 2);

    if v_cant > 0 and v_costo_ant > 0 and v_costo_landed > 0 and v_costo_landed <> v_costo_ant then
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
      margen_porcentaje, iva_venta_porcentaje, precio_sin_iva, precio_con_iva,
      cantidad_stock_aplicada, cantidad_sin_cargo
    ) values (
      v_factura_id, v_prod_id, v_cant, v_costo_sin_iva,
      v_desc, v_iva_compra, v_costo_con_iva,
      v_margen, v_iva_venta, v_precio_sin_iva, v_precio_con_iva,
      v_stock_aplicada, v_sin_cargo
    );

    if p_afecta_precio_venta then
      update public.productos
        -- v21: caso residual bonificada SIN ninguna base de costo →
        -- fn_precio_venta(0,…) da $0; no se pisa el precio/margen vigentes
        -- con eso (vendible a $0). Con costo de lista (v22) esto no ocurre.
        set precio_venta = case when v_precio_con_iva > 0 then v_precio_con_iva else precio_venta end,
            margen = case when v_precio_con_iva > 0 then v_margen else margen end,
            -- v19 (de mig 153): el precio MAYORISTA se recalcula desde SU margen.
            -- v22: con la MISMA base en cascada que el minorista (antes la
            -- bonificada no lo repreciaba; para renglones normales es idéntico).
            precio_mayorista = case
              when margen_mayorista is not null and v_base_precio > 0
                then public.fn_precio_venta(v_base_precio, margen_mayorista, v_iva_venta)
              else precio_mayorista
            end,
            pendiente_precio = case when v_precio_con_iva > 0 then false else pendiente_precio end,
            updated_at = v_ahora
        where id = v_prod_id;
    elsif v_base_precio > 0 then
      -- ── v25 (mig 322): par coherente aunque el precio esté protegido ──
      --   El costo se escribe SIEMPRE (abajo); con el switch apagado —ya solo
      --   un cliente viejo sin recargar— el margen quedaba medido contra el
      --   costo anterior y la ficha mostraba dos precios. Se re-deduce el
      --   margen real del par (precio vigente, base de esta factura) SIN
      --   tocar precio_venta (no encola etiqueta). IVA: el de la ficha —el
      --   cliente viejo puede traer 21 fijo y no manda aplicar_iva—.
      --   Mayorista: se conserva precio_mayorista y se re-deduce su margen.
      update public.productos
        set margen = public.fn_margen_desde_precio(
              v_base_precio, precio_venta, coalesce(iva_venta, v_iva_venta)),
            margen_mayorista = case
              when margen_mayorista is not null and coalesce(precio_mayorista, 0) > 0
                then public.fn_margen_desde_precio(
                       v_base_precio, precio_mayorista, coalesce(iva_venta, v_iva_venta))
              else margen_mayorista
            end,
            updated_at = v_ahora
        where id = v_prod_id and precio_venta > 0;
    end if;
    -- v20: bonificada (landed $0) → NO se pisa el costo guardado: el CMV de
    -- las ventas siguientes sigue usando el último costo real.
    -- v26: con 0 pagadas (renglón 100 % sin cargo) tampoco: el regalo no
    -- fija costo. El costo del producto es SIEMPRE el unitario PAGADO; las
    -- sin cargo no lo diluyen (decisión del dueño, 2026-11-03).
    if v_cant > 0 and v_costo_landed > 0 then
      perform public.fn_set_costo(v_prod_id, v_costo_landed);

      update public.proveedor_producto set costo = v_costo_landed, updated_at = v_ahora
        where proveedor_id = p_proveedor_id and producto_id = v_prod_id;
    end if;

    -- ── v24 (mig 168): las alícuotas del comprobante vuelven a la ficha ──
    --   Hasta la v23, corregir el IVA en un renglón de la factura se perdía:
    --   el dato quedaba solo en items_factura_compra y la próxima factura
    --   volvía a proponer el de la ficha. Ahora la ficha aprende del papel.
    --   Va FUERA del guard de p_afecta_precio_venta A PROPÓSITO: la alícuota
    --   es un DATO del producto —como el costo, que también se guarda
    --   siempre—, no una decisión de precio. Apagar el switch protege el
    --   PRECIO, no esto.
    --   `aplicar_iva` es una clave OPCIONAL de p_lineas (mismo patrón que
    --   `precio_venta` en la v13 y `fecha_vencimiento` en la v12: la firma no
    --   cambia). Solo la manda el cliente que siembra los IVAs desde la
    --   ficha; uno viejo —una pestaña sin recargar— no la manda y no pisa
    --   nada. Sin esa llave estamparía su 21 hardcodeado sobre un producto
    --   que está al 10,5.
    if coalesce((v_linea->>'aplicar_iva')::boolean, false) then
      update public.productos
        set iva_venta = v_iva_venta,
            iva_compra = v_iva_compra,
            updated_at = v_ahora
        where id = v_prod_id
          -- Sin cambio real no se toca la fila (ni se mueve updated_at).
          and (iva_venta is distinct from v_iva_venta
               or iva_compra is distinct from v_iva_compra);
    end if;

    -- ── RECONCILIACIÓN DE STOCK (v12) ─────────────────────────────────
    if v_item_pedido_id is not null then
      -- Base = lo que el stock ya refleja de este renglón:
      --   antes de la 1ª factura → lo recibido; después → lo ya facturado.
      select cantidad_recibida, cantidad_facturada, cantidad_sin_cargo
        into v_recibida, v_facturada_prev, v_sin_cargo_prev
        from public.items_pedido where id = v_item_pedido_id for update;

      -- v26: lo reflejado = pagadas + sin cargo de la carga anterior. Con
      -- cantidad_facturada NULL la suma da NULL y cae a lo recibido (1ª factura).
      v_reflejada := trim_scale(coalesce(v_facturada_prev + coalesce(v_sin_cargo_prev, 0), v_recibida, 0));
      v_delta := v_unidades - v_reflejada;

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
            || v_reflejada::text || ' → ' || v_unidades::text
            || case when v_sin_cargo > 0 then ' (' || v_sin_cargo::text || ' sin cargo)' else '' end
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
            cantidad_facturada = v_cant,
            cantidad_sin_cargo = v_sin_cargo
        where id = v_item_pedido_id;
    else
      -- ── Renglón EXTRA (llegó sin estar en la orden), v23 ─────────────
      -- No tiene renglón de pedido y nadie lo recibió: el stock lo mete la
      -- factura. Baseline = lo que esta misma cuenta ya había aplicado (0 en
      -- la primera carga), así re-guardar la misma cantidad da delta 0.
      v_reflejada := trim_scale(coalesce((v_extra_prev->>v_prod_id::text)::numeric, 0));
      v_delta := v_unidades - v_reflejada;

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
          'Factura compra (cuenta #' || p_cuenta_id || ') · extra sin orden: stock '
            || v_reflejada::text || ' → ' || v_unidades::text
            || case when v_sin_cargo > 0 then ' (' || v_sin_cargo::text || ' sin cargo)' else '' end
        );

        -- Sin lote previo (nadie lo recibió), fn_ajustar_lote_factura crea uno
        -- solo si la factura trajo vencimiento; si no, mueve el stock a secas.
        perform public.fn_ajustar_lote_factura(v_prod_id, p_pedido_id, v_delta, v_venc);
      elsif v_venc is not null then
        update public.lotes set fecha_vencimiento = v_venc
          where producto_id = v_prod_id and pedido_origen_id = p_pedido_id
            and estado = 'activo'::public.estado_lote;
      end if;
    end if;
  end loop;

  -- v23: barrido de extras que ya NO están en la factura. Si un renglón extra
  -- de la carga anterior se borró (lo habían puesto por error), su stock sale:
  -- no hay recepción ni orden que lo respalde. Los que siguen siendo extra ya
  -- se reconciliaron por delta en el loop de arriba.
  for v_ex in
    select e.k::integer as producto_id, e.v::numeric as aplicada
      from jsonb_each_text(v_extra_prev) as e(k, v)
  loop
    if not jsonb_exists(v_extras_nuevos, v_ex.producto_id::text) then
      select stock_actual into v_stock_ant
        from public.productos where id = v_ex.producto_id for update;
      v_stock_ant := coalesce(v_stock_ant, 0);
      v_stock_nuevo := v_stock_ant - v_ex.aplicada;
      update public.productos set stock_actual = v_stock_nuevo, updated_at = v_ahora
        where id = v_ex.producto_id;

      insert into public.movimientos_stock (
        producto_id, tipo, cantidad, stock_anterior, stock_nuevo,
        referencia_id, usuario_id, nota
      ) values (
        v_ex.producto_id, 'salida'::public.tipo_movimiento,
        v_ex.aplicada, v_stock_ant, v_stock_nuevo,
        p_cuenta_id, p_usuario_id,
        'Factura compra (cuenta #' || p_cuenta_id || '): se quitó el renglón extra'
      );

      perform public.fn_ajustar_lote_factura(v_ex.producto_id, p_pedido_id, -v_ex.aplicada, null);
    end if;
  end loop;

  -- v14: si hay pagos previos, el estado se RE-DERIVA contra el total nuevo
  -- (la v13 podía dejar 'pagada' con saldo al re-facturar al alza, o
  -- 'pendiente' con saldo 0 si los pagos ya cubrían el total nuevo).
  -- Con aplicado 0 no se toca el estado (cuentas legacy no se reabren).
  update public.cuentas_a_pagar
    set monto = v_total, provisoria = false, tiene_factura = true,
        estado = case
          when v_aplicado > 0 and v_aplicado >= v_total - 0.009
            then 'pagada'::public.estado_cuenta_pagar
          when v_aplicado > 0
            then 'pendiente'::public.estado_cuenta_pagar
          else estado
        end,
        fecha_pago = case
          when v_aplicado > 0 and v_aplicado >= v_total - 0.009
            then coalesce(fecha_pago, v_hoy)
          when v_aplicado > 0
            then null
          else fecha_pago
        end
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
  select id into v_cta_dif from public.plan_cuentas where codigo = '5.2.10';
  select id into v_cta_perc_iva from public.plan_cuentas where codigo = '1.1.07';
  select id into v_cta_perc_iibb from public.plan_cuentas where codigo = '1.1.08';
  select id into v_cta_perc_otros from public.plan_cuentas where codigo = '1.1.09';

  if v_redondeo <> 0 and v_cta_dif is null then
    raise exception 'Falta la cuenta 5.2.10 Diferencias por Pagos y Redondeos en el plan.';
  end if;

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
    -- v16: redondeo positivo (el papel dice MÁS que el cálculo) → Debe 5.2.10.
    if v_redondeo > 0 then
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_dif, v_redondeo, 0, v_orden);
      v_orden := v_orden + 1;
    end if;
    insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
    values (v_asiento_id, v_cta_prov, 0, v_total, v_orden);
    v_orden := v_orden + 1;
    -- v16: redondeo negativo (el papel dice MENOS) → Haber 5.2.10 (balancea:
    -- el Haber a Proveedores ya bajó con el total).
    if v_redondeo < 0 then
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_dif, 0, abs(v_redondeo), v_orden);
    end if;
  end if;

  -- ── Pagos integrados (v15) / PROGRAMADOS (v16) ───────────────────────
  -- v17: el corte real/programado usa la fecha LOCAL del negocio, no la UTC
  -- del server (que a la noche ya está en "mañana" y ejecutaba en el acto
  -- pagos que debían quedar programados).
  if p_pago is not null then
    if jsonb_typeof(p_pago) = 'object' then
      v_pagos := jsonb_build_array(p_pago);  -- compat v14: un solo pago
    elsif jsonb_typeof(p_pago) = 'array' then
      v_pagos := p_pago;
    else
      raise exception 'p_pago inválido: se espera un objeto o una lista de pagos.';
    end if;

    if jsonb_array_length(v_pagos) > 0 then
      -- Error claro en vez del "ya está pagada" de fn_pagar_cuenta: con los
      -- pagos previos cubriendo el total, ningún pago nuevo puede tener éxito.
      if v_aplicado >= v_total - 0.009 then
        raise exception 'La deuda ya quedó cubierta por los pagos previos: guardá la factura sin el pago.';
      end if;

      for v_pago in select * from jsonb_array_elements(v_pagos) loop
        v_pago_cuenta := nullif(v_pago->>'cuenta_origen_id', '')::integer;
        v_pago_monto := nullif(v_pago->>'monto', '')::numeric;
        v_pago_fecha := coalesce(nullif(v_pago->>'fecha', '')::date, v_hoy);
        if v_pago_cuenta is null or v_pago_monto is null or v_pago_monto <= 0 then
          raise exception 'Datos del pago incompletos: la cuenta de origen y el monto son obligatorios.';
        end if;
        if v_pago_fecha > v_hoy then
          insert into public.pagos_programados (
            cuenta_a_pagar_id, cuenta_origen_id, monto, forma_pago,
            comprobante, nota, fecha_programada, usuario_id
          ) values (
            p_cuenta_id, v_pago_cuenta, round(v_pago_monto, 2),
            nullif(v_pago->>'forma_pago', ''),
            nullif(btrim(coalesce(v_pago->>'comprobante', '')), ''),
            nullif(btrim(coalesce(v_pago->>'nota', '')), ''),
            v_pago_fecha, p_usuario_id
          );
        else
          perform public.fn_pagar_cuenta(
            p_cuenta_id,
            p_usuario_id,
            v_pago_cuenta,
            round(v_pago_monto, 2),
            v_pago_fecha,
            nullif(btrim(coalesce(v_pago->>'nota', '')), ''),
            nullif(v_pago->>'forma_pago', ''),
            nullif(btrim(coalesce(v_pago->>'comprobante', '')), '')
          );
        end if;
      end loop;
    end if;
  end if;

  -- ── Plan de cuotas del saldo (v18, mig 148) ──────────────────────────
  -- Va al FINAL a propósito: los pagos de p_pago ya insertaron en
  -- pagos_cuenta dentro de esta misma transacción, así el saldo que valida
  -- fn_definir_cuotas_cuenta es el saldo POST-pagos. El re-lock de la misma
  -- fila en la misma transacción es un no-op.
  if p_cuotas is not null then
    perform public.fn_definir_cuotas_cuenta(p_cuenta_id, p_usuario_id, p_cuotas);
  end if;
end;
$$;

grant execute on function public.fn_guardar_factura_compra(
  integer, integer, integer, date, boolean, uuid, jsonb, jsonb, numeric, jsonb, numeric, jsonb)
  to authenticated;

-- ──────────────────────────────────────────────────────────────────
-- 3. fn_anular_factura_compra v3 (cuerpo de la v2, mig 166; misma firma)
-- ──────────────────────────────────────────────────────────────────
create or replace function public.fn_anular_factura_compra(
  p_cuenta_id integer,
  p_usuario_id uuid
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_ahora timestamptz := now();
  v_pedido_id integer;
  v_ip record;
  v_delta numeric;
  v_stock_ant numeric;
  v_stock_nuevo numeric;
  v_estimado numeric;
  v_ex record;
begin
  -- Permiso (admin bypassa fn_tiene_permiso).
  if not public.fn_tiene_permiso('compras') then
    raise exception 'No tenés permiso para anular facturas de compra.';
  end if;

  -- Traba la cuenta y valida.
  select pedido_id into v_pedido_id
    from public.cuentas_a_pagar where id = p_cuenta_id for update;
  if not found then
    raise exception 'La cuenta a pagar #% no existe.', p_cuenta_id;
  end if;
  if not exists (select 1 from public.facturas_compra where cuenta_id = p_cuenta_id) then
    raise exception 'La cuenta #% no tiene factura cargada.', p_cuenta_id;
  end if;

  -- GUARDA: la deuda no puede tener pagos.
  if coalesce((select monto_pagado from public.cuentas_a_pagar where id = p_cuenta_id), 0) > 0
     or exists (select 1 from public.pagos_cuenta where cuenta_a_pagar_id = p_cuenta_id) then
    raise exception 'No se puede anular: la deuda ya tiene pagos registrados. Anulá el pago primero.';
  end if;

  -- 1+2. Revertir el stock reconciliado por la factura y limpiar el marcador.
  for v_ip in
    select id, producto_id, cantidad_recibida, cantidad_facturada, cantidad_sin_cargo
      from public.items_pedido
      where cuenta_a_pagar_id = p_cuenta_id and cantidad_facturada is not null
      order by id
  loop
    -- v3 (mig 325): el stock reflejaba pagadas + sin cargo; vuelve a lo recibido.
    v_delta := coalesce(v_ip.cantidad_recibida, 0)
             - (v_ip.cantidad_facturada + coalesce(v_ip.cantidad_sin_cargo, 0));
    if v_delta <> 0 then
      select stock_actual into v_stock_ant
        from public.productos where id = v_ip.producto_id for update;
      v_stock_ant := coalesce(v_stock_ant, 0);
      v_stock_nuevo := v_stock_ant + v_delta;
      update public.productos set stock_actual = v_stock_nuevo, updated_at = v_ahora
        where id = v_ip.producto_id;

      insert into public.movimientos_stock (
        producto_id, tipo, cantidad, stock_anterior, stock_nuevo,
        referencia_id, usuario_id, nota
      ) values (
        v_ip.producto_id,
        (case when v_delta > 0 then 'entrada' else 'salida' end)::public.tipo_movimiento,
        abs(v_delta), v_stock_ant, v_stock_nuevo,
        p_cuenta_id, p_usuario_id,
        'Anulación de factura (cuenta #' || p_cuenta_id || ')'
      );

      perform public.fn_ajustar_lote_factura(v_ip.producto_id, v_pedido_id, v_delta, null);
    end if;

    update public.items_pedido
      set cantidad_facturada = null, cantidad_sin_cargo = 0
      where id = v_ip.id;
  end loop;

  -- 2b. Revertir el stock de los renglones EXTRA (mig 166). No tienen fila en
  -- items_pedido: el stock lo había metido la propia factura y el marcador
  -- dice cuánto. Las facturas anteriores a la 166 tienen 0 y no se tocan
  -- (nunca movieron stock; restarlo dejaría el inventario en negativo).
  for v_ex in
    select ifc.producto_id, sum(ifc.cantidad_stock_aplicada) as aplicada
      from public.items_factura_compra ifc
      join public.facturas_compra fc on fc.id = ifc.factura_id
     where fc.cuenta_id = p_cuenta_id
       and ifc.producto_id is not null
       and ifc.cantidad_stock_aplicada <> 0
     group by ifc.producto_id
  loop
    select stock_actual into v_stock_ant
      from public.productos where id = v_ex.producto_id for update;
    v_stock_ant := coalesce(v_stock_ant, 0);
    v_stock_nuevo := v_stock_ant - v_ex.aplicada;
    update public.productos set stock_actual = v_stock_nuevo, updated_at = v_ahora
      where id = v_ex.producto_id;

    insert into public.movimientos_stock (
      producto_id, tipo, cantidad, stock_anterior, stock_nuevo,
      referencia_id, usuario_id, nota
    ) values (
      v_ex.producto_id, 'salida'::public.tipo_movimiento,
      v_ex.aplicada, v_stock_ant, v_stock_nuevo,
      p_cuenta_id, p_usuario_id,
      'Anulación de factura (cuenta #' || p_cuenta_id || '): extra sin orden'
    );

    perform public.fn_ajustar_lote_factura(v_ex.producto_id, v_pedido_id, -v_ex.aplicada, null);
  end loop;

  -- 3. Borrar la factura y sus items (cascade).
  delete from public.facturas_compra where cuenta_id = p_cuenta_id;

  -- 4. Reabrir la deuda como provisoria con el estimado de la recepción.
  select coalesce(sum(coalesce(cantidad_recibida, 0) * coalesce(precio_costo, 0)), 0)
    into v_estimado
    from public.items_pedido where cuenta_a_pagar_id = p_cuenta_id;
  update public.cuentas_a_pagar
    set provisoria = true, tiene_factura = false, monto = v_estimado,
        numero_factura = null
    where id = p_cuenta_id;

  -- 5. Recalcular pedidos.total (facturas cargadas + provisorias sin factura).
  update public.pedidos
    set total = coalesce((
          select sum(fc.total) from public.facturas_compra fc
          where fc.pedido_id = v_pedido_id
        ), 0)
        + coalesce((
          select sum(cap.monto) from public.cuentas_a_pagar cap
          where cap.pedido_id = v_pedido_id and cap.tiene_factura = false
        ), 0),
        updated_at = v_ahora
    where id = v_pedido_id;

  -- Revertir el asiento contable de la factura.
  delete from public.asientos where origen = 'factura_compra' and referencia_id = p_cuenta_id;

  -- Auditoría (misma infra que anulaciones/arqueos/reversiones).
  perform public.fn_auditar(
    p_usuario_id, 'anular_factura_compra', 'cuenta_a_pagar', p_cuenta_id,
    jsonb_build_object('pedido_id', v_pedido_id, 'estimado_restaurado', v_estimado)
  );
end;
$$;

revoke execute on function public.fn_anular_factura_compra(integer, uuid) from public, anon;
grant execute on function public.fn_anular_factura_compra(integer, uuid) to authenticated;

-- ──────────────────────────────────────────────────────────────────
-- 4. fn_validar_factura_compra v2 (cuerpo de la 303; misma firma)
-- ──────────────────────────────────────────────────────────────────
create or replace function public.fn_validar_factura_compra(
  p_factura_id integer,
  p_validar boolean default true
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_f record;
  v_dif numeric := 0;
  v_reng integer := 0;
  v_tmp numeric;
  v_tmp_i integer;
begin
  if not (
    (select public.fn_tiene_permiso('finanzas'))
    or (select public.fn_tiene_permiso('compras'))
  ) then
    raise exception 'No tenés permiso para validar facturas de proveedores.';
  end if;

  select id, cuenta_id, pedido_id, es_directa, neto
    into v_f
    from public.facturas_compra
   where id = p_factura_id
   for update;
  if not found then
    raise exception 'La factura #% no existe.', p_factura_id;
  end if;

  if not p_validar then
    update public.facturas_compra
       set validada = false,
           validada_por = null,
           validada_at = null,
           diferencia_recepcion = null,
           renglones_diferentes = null,
           updated_at = now()
     where id = p_factura_id;

    perform public.fn_auditar(auth.uid(), 'reabrir_validacion_factura', 'factura_compra',
      p_factura_id, jsonb_build_object('cuenta_id', v_f.cuenta_id));
    return;
  end if;

  -- Cruce recibido vs. facturado, solo con orden de compra.
  if v_f.pedido_id is not null and v_f.cuenta_id is not null then
    -- Renglones de la orden imputados a esta deuda (mig 106): la factura ya
    -- escribió cantidad_facturada y el costo landed en items_pedido (mig 168).
    -- v2 (mig 325): lo recibido se compara contra pagadas + SIN CARGO (es lo
    -- que el stock refleja). Una sin cargo faltante se valúa al precio_costo
    -- del renglón: aproximación documentada (el papel no la cobra, pero el
    -- depósito la esperaba).
    select coalesce(sum(round((coalesce(ip.cantidad_facturada, 0) + coalesce(ip.cantidad_sin_cargo, 0)
                                - coalesce(ip.cantidad_recibida, 0)) * ip.precio_costo, 2)), 0),
           count(*) filter (where coalesce(ip.cantidad_facturada, 0) + coalesce(ip.cantidad_sin_cargo, 0)
                                  <> coalesce(ip.cantidad_recibida, 0))
      into v_tmp, v_tmp_i
      from public.items_pedido ip
     where ip.cuenta_a_pagar_id = v_f.cuenta_id
       and ip.cantidad_facturada is not null;
    v_dif := v_dif + coalesce(v_tmp, 0);
    v_reng := v_reng + coalesce(v_tmp_i, 0);

    -- Renglones EXTRA (producto que no estaba en la orden, mig 166): nadie
    -- los recibió, así que todo su neto es diferencia.
    select coalesce(sum(round(ifc.cantidad * ifc.costo_sin_iva * (1 - coalesce(ifc.descuento_porcentaje, 0) / 100), 2)), 0),
           count(*)
      into v_tmp, v_tmp_i
      from public.items_factura_compra ifc
     where ifc.factura_id = p_factura_id
       and ifc.producto_id is not null
       and not exists (
         select 1 from public.items_pedido ip
          where ip.pedido_id = v_f.pedido_id
            and ip.producto_id = ifc.producto_id
       );
    v_dif := v_dif + coalesce(v_tmp, 0);
    v_reng := v_reng + coalesce(v_tmp_i, 0);
  end if;

  update public.facturas_compra
     set validada = true,
         validada_por = auth.uid(),
         validada_at = now(),
         diferencia_recepcion = case when v_f.pedido_id is null then null else v_dif end,
         renglones_diferentes = case when v_f.pedido_id is null then null else v_reng end,
         -- Una directa validada queda también controlada (misma cosa, dos nombres).
         controlada = case when v_f.es_directa then true else controlada end,
         updated_at = now()
   where id = p_factura_id;

  perform public.fn_auditar(auth.uid(), 'validar_factura_compra', 'factura_compra',
    p_factura_id,
    jsonb_build_object(
      'cuenta_id', v_f.cuenta_id,
      'pedido_id', v_f.pedido_id,
      'diferencia_recepcion', case when v_f.pedido_id is null then null else v_dif end,
      'renglones_diferentes', case when v_f.pedido_id is null then null else v_reng end
    ));
end;
$$;

revoke execute on function public.fn_validar_factura_compra(integer, boolean) from public, anon;
grant execute on function public.fn_validar_factura_compra(integer, boolean) to authenticated;

notify pgrst, 'reload schema';

-- ── VERIFICACIÓN 1 (T1): sin funciones fn_% duplicadas → 0 filas ─────
-- select proname, count(*) from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public' and proname like 'fn_%'
--  group by proname having count(*) > 1;

-- ── VERIFICACIÓN 2: una fila por función, con la firma de siempre ────
-- select proname, pg_get_function_identity_arguments(oid)
--   from pg_proc
--  where pronamespace = 'public'::regnamespace
--    and proname in ('fn_guardar_factura_compra', 'fn_anular_factura_compra', 'fn_validar_factura_compra');

-- ── VERIFICACIÓN 3: las columnas existen y arrancan en 0 ─────────────
-- select table_name, column_name, column_default
--   from information_schema.columns
--  where table_schema = 'public' and column_name = 'cantidad_sin_cargo';
