-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 148 · Plan de CUOTAS para cuentas a pagar                ║
-- ║                                                                     ║
-- ║  Una deuda a proveedor puede pactarse en cuotas con distintas       ║
-- ║  fechas de vencimiento. La fila de cuentas_a_pagar sigue siendo     ║
-- ║  1:1 con la factura (multi-factura de la mig 106 intacta); las      ║
-- ║  cuotas son un CRONOGRAMA hijo en cuotas_cuenta_pagar.              ║
-- ║                                                                     ║
-- ║  Diseño (sin columna de estado en las cuotas — todo derivado):      ║
-- ║   · head = monto − Σcuotas  → porción "ya cubierta" cuando el plan  ║
-- ║     se definió sobre un saldo parcial (Σcuotas = saldo al definir). ║
-- ║   · cubierto = max(0, aplicado − head), con                         ║
-- ║     aplicado = Σ(pagos_cuenta.monto − sobrante).                    ║
-- ║   · El cubierto se reparte FIFO por (fecha_vencimiento, numero):    ║
-- ║     cada cuota queda pagada / parcial / pendiente / vencida.        ║
-- ║   · REGLA DE ORO: cuentas_a_pagar.fecha_vencimiento del padre se    ║
-- ║     sincroniza SIEMPRE a la primera cuota no cubierta → dashboard,  ║
-- ║     orden de listados y "vencidas" siguen correctos sin tocarse.    ║
-- ║                                                                     ║
-- ║  Semántica de p_cuotas en las RPCs:                                 ║
-- ║   null = no tocar el plan · [] = quitarlo · [..] = redefinirlo      ║
-- ║   (la suma debe coincidir con el saldo pendiente ± $0,01).          ║
-- ║                                                                     ║
-- ║  Se emiten:                                                         ║
-- ║   · tabla cuotas_cuenta_pagar + RLS (permiso 'finanzas')            ║
-- ║   · fn_sync_vencimiento_cuotas (interna)                            ║
-- ║   · fn_definir_cuotas_cuenta (nueva RPC)                            ║
-- ║   · fn_pagar_cuenta v6            (= v5 + sync del vencimiento)     ║
-- ║   · fn_guardar_factura_compra v18 (= v17 + 12º arg p_cuotas;        ║
-- ║     LA FIRMA CAMBIA → drop de la de 11 args primero)                ║
-- ║   · fn_anular_factura_compra v2   (= v1 + borra el plan al anular)  ║
-- ║                                                                     ║
-- ║  REQUIERE: mig 147 corrida. Correr ANTES de deployar el frontend.   ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────────────────────
-- 1. Tabla + índice + RLS
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.cuotas_cuenta_pagar (
  id                serial primary key,
  cuenta_a_pagar_id integer not null references public.cuentas_a_pagar(id) on delete cascade,
  numero            integer not null,
  monto             numeric(12,2) not null check (monto > 0),
  fecha_vencimiento date not null,
  usuario_id        uuid references public.usuarios(id),
  created_at        timestamptz not null default now(),
  unique (cuenta_a_pagar_id, numero)
);

create index if not exists idx_cuotas_ccp_orden
  on public.cuotas_cuenta_pagar (cuenta_a_pagar_id, fecha_vencimiento, numero);

alter table public.cuotas_cuenta_pagar enable row level security;
do $$ begin
  create policy gate_rw on public.cuotas_cuenta_pagar
    for all to authenticated
    using ((select public.fn_tiene_permiso('finanzas')))
    with check ((select public.fn_tiene_permiso('finanzas')));
exception when duplicate_object then null; end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 2. fn_sync_vencimiento_cuotas — interna (solo la llaman las definer)
--    Deja cuentas_a_pagar.fecha_vencimiento = fecha de la 1ª cuota no
--    cubierta por el aplicado. Si la deuda está pagada o no hay plan,
--    no toca nada.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_sync_vencimiento_cuotas(
  p_cuenta_id integer
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_monto numeric;
  v_pagado numeric;
  v_estado text;
  v_aplicado numeric;
  v_suma numeric;
  v_head numeric;
  v_cubierto numeric;
  v_acum numeric := 0;
  v_primera date;
  v_cuota record;
begin
  select monto, coalesce(monto_pagado, 0), estado
    into v_monto, v_pagado, v_estado
    from public.cuentas_a_pagar where id = p_cuenta_id;
  if v_monto is null or v_estado = 'pagada' then
    return;
  end if;

  select coalesce(sum(monto), 0) into v_suma
    from public.cuotas_cuenta_pagar where cuenta_a_pagar_id = p_cuenta_id;
  if v_suma <= 0 then
    return;  -- sin plan de cuotas
  end if;

  -- Aplicado real a la deuda (mismo cálculo que fn_pagar_cuenta).
  select coalesce(sum(monto - coalesce(sobrante, 0)), 0) into v_aplicado
    from public.pagos_cuenta where cuenta_a_pagar_id = p_cuenta_id;
  if v_aplicado = 0 and v_pagado > 0 then
    v_aplicado := v_pagado;  -- compat con pagos legacy sin fila en pagos_cuenta
  end if;

  v_head := greatest(v_monto - v_suma, 0);          -- porción sin plan (ya cubierta al definir)
  v_cubierto := greatest(v_aplicado - v_head, 0);   -- lo que el FIFO reparte entre cuotas

  for v_cuota in
    select monto, fecha_vencimiento
      from public.cuotas_cuenta_pagar
      where cuenta_a_pagar_id = p_cuenta_id
      order by fecha_vencimiento, numero
  loop
    v_acum := v_acum + v_cuota.monto;
    if v_acum > v_cubierto + 0.009 then
      v_primera := v_cuota.fecha_vencimiento;
      exit;
    end if;
  end loop;

  if v_primera is not null then
    update public.cuentas_a_pagar
      set fecha_vencimiento = v_primera
      where id = p_cuenta_id
        and fecha_vencimiento is distinct from v_primera;
  end if;
end;
$$;

revoke execute on function public.fn_sync_vencimiento_cuotas(integer) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 3. fn_definir_cuotas_cuenta — definir / reemplazar / quitar el plan
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_definir_cuotas_cuenta(
  p_cuenta_id integer,
  p_usuario_id uuid,
  p_cuotas jsonb
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_monto numeric;
  v_pagado numeric;
  v_estado text;
  v_aplicado numeric;
  v_saldo numeric;
  v_n integer;
  v_e jsonb;
  v_m numeric;
  v_f date;
  v_suma numeric := 0;
begin
  if not (select public.fn_tiene_permiso('finanzas')) then
    raise exception 'No tenés permiso para definir planes de cuotas.';
  end if;
  if p_cuotas is null or jsonb_typeof(p_cuotas) <> 'array' then
    raise exception 'p_cuotas inválido: se espera una lista de cuotas.';
  end if;

  select monto, coalesce(monto_pagado, 0), estado
    into v_monto, v_pagado, v_estado
    from public.cuentas_a_pagar where id = p_cuenta_id for update;
  if v_monto is null then
    raise exception 'La cuenta a pagar #% no existe.', p_cuenta_id;
  end if;

  delete from public.cuotas_cuenta_pagar where cuenta_a_pagar_id = p_cuenta_id;

  v_n := jsonb_array_length(p_cuotas);
  if v_n = 0 then
    -- [] = quitar el plan (vale incluso con la deuda pagada). El vencimiento
    -- del padre queda como está: la última sync lo dejó en la próxima cuota
    -- impaga, que pasa a ser el vencimiento único editable.
    perform public.fn_auditar(p_usuario_id, 'definir_cuotas', 'cuenta_a_pagar', p_cuenta_id,
      jsonb_build_object('cuotas', 0));
    return;
  end if;

  if v_estado = 'pagada' then
    raise exception 'La deuda ya está pagada; no corresponde un plan de cuotas.';
  end if;
  if v_n > 60 then
    raise exception 'Demasiadas cuotas (máximo 60).';
  end if;

  -- Saldo pendiente real = monto − aplicado (mismo cálculo que fn_pagar_cuenta).
  select coalesce(sum(monto - coalesce(sobrante, 0)), 0) into v_aplicado
    from public.pagos_cuenta where cuenta_a_pagar_id = p_cuenta_id;
  if v_aplicado = 0 and v_pagado > 0 then
    v_aplicado := v_pagado;  -- compat con pagos legacy sin fila en pagos_cuenta
  end if;
  v_saldo := greatest(v_monto - v_aplicado, 0);
  if v_saldo <= 0.009 then
    raise exception 'La deuda no tiene saldo pendiente para dividir en cuotas.';
  end if;

  for v_e in select * from jsonb_array_elements(p_cuotas) loop
    v_m := round(coalesce(nullif(v_e->>'monto', '')::numeric, 0), 2);
    v_f := nullif(v_e->>'fecha_vencimiento', '')::date;
    if v_m <= 0 then
      raise exception 'Cada cuota debe tener un monto mayor a 0.';
    end if;
    if v_f is null then
      raise exception 'Cada cuota debe tener fecha de vencimiento.';
    end if;
    v_suma := v_suma + v_m;
  end loop;
  v_suma := round(v_suma, 2);
  if abs(v_suma - v_saldo) > 0.01 then
    raise exception 'La suma de las cuotas (%) no coincide con el saldo pendiente (%).', v_suma, v_saldo;
  end if;

  -- Numeración por fecha (ordinality desempata fechas iguales).
  insert into public.cuotas_cuenta_pagar (cuenta_a_pagar_id, numero, monto, fecha_vencimiento, usuario_id)
  select p_cuenta_id,
         row_number() over (order by (e->>'fecha_vencimiento')::date, ord),
         round((e->>'monto')::numeric, 2),
         (e->>'fecha_vencimiento')::date,
         p_usuario_id
    from jsonb_array_elements(p_cuotas) with ordinality t(e, ord);

  perform public.fn_sync_vencimiento_cuotas(p_cuenta_id);

  perform public.fn_auditar(p_usuario_id, 'definir_cuotas', 'cuenta_a_pagar', p_cuenta_id,
    jsonb_build_object('cuotas', v_n, 'suma', v_suma));
end;
$$;

revoke execute on function public.fn_definir_cuotas_cuenta(integer, uuid, jsonb) from public, anon;
grant execute on function public.fn_definir_cuotas_cuenta(integer, uuid, jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 4. fn_pagar_cuenta v6 — = v5 (mig 147) + sync del vencimiento por
--    cuotas al final. Misma firma de 8 args → REPLACE limpio. Cubre
--    también a fn_ejecutar_pago_programado (que delega acá).
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_pagar_cuenta(
  p_cuenta_id integer,
  p_usuario_id uuid,
  p_cuenta_origen_id integer,
  p_monto numeric,
  p_fecha date default null,
  p_nota text default null,
  p_forma_pago text default null,
  p_comprobante text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Fecha "hoy" del NEGOCIO (La Rioja), no la UTC del server (mig 147).
  v_hoy date := (now() at time zone 'America/Argentina/La_Rioja')::date;
  v_monto numeric;
  v_pagado numeric;
  v_aplicado numeric;
  v_pendiente numeric;
  v_aplica numeric;
  v_sobrante numeric;
  v_residuo numeric := 0;
  v_pedido_id integer;
  v_estado text;
  v_proveedor text;
  v_fecha date;
  v_tipo_cuenta text;
  v_es_boveda boolean;
  v_saldo numeric;
  v_saldo_nuevo numeric;
  v_mov_id integer;
  v_egreso_id integer;
  v_pago_id integer;
  v_asiento_id integer;
  v_cta_prov integer;
  v_cta_dif integer;
  v_cta_haber integer;
  v_nuevo_pagado numeric;
  v_completa boolean;
  v_orden integer := 0;
begin
  v_fecha := coalesce(p_fecha, v_hoy);

  -- Guards v3 (consistentes con fn_crear_egreso v2, mig 120).
  if not (select public.fn_tiene_permiso('finanzas')) then
    raise exception 'No tenés permiso para registrar pagos a proveedores.';
  end if;
  if public.fn_periodo_cerrado(v_fecha) then
    raise exception 'El período de ese pago está cerrado; no se puede registrar.';
  end if;
  if p_forma_pago is not null and p_forma_pago not in
     ('efectivo','transferencia','cheque','debito','otro') then
    raise exception 'Forma de pago inválida.';
  end if;

  -- Datos de la deuda
  select c.monto, coalesce(c.monto_pagado, 0), c.pedido_id, c.estado, p.nombre
    into v_monto, v_pagado, v_pedido_id, v_estado, v_proveedor
    from public.cuentas_a_pagar c
    left join public.proveedores p on p.id = c.proveedor_id
    where c.id = p_cuenta_id
    for update of c;  -- solo bloquea cuentas_a_pagar; FOR UPDATE no admite el lado nullable del LEFT JOIN
  if v_monto is null then
    raise exception 'La cuenta no existe.';
  end if;
  if v_estado = 'pagada' then
    raise exception 'Esta cuenta ya está pagada.';
  end if;

  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto del pago debe ser mayor a 0.';
  end if;

  -- Aplicado real a la deuda = Σ(monto − sobrante) del historial.
  select coalesce(sum(monto - coalesce(sobrante, 0)), 0) into v_aplicado
    from public.pagos_cuenta where cuenta_a_pagar_id = p_cuenta_id;
  if v_aplicado = 0 and v_pagado > 0 then
    v_aplicado := v_pagado;  -- compat con pagos legacy sin fila en pagos_cuenta
  end if;

  -- SOBREPAGO (v3): lo que excede el pendiente se registra como diferencia
  -- por redondeo (Debe 5.2.10) y la deuda queda saldada.
  v_pendiente := greatest(v_monto - v_aplicado, 0);
  v_aplica := least(p_monto, v_pendiente);
  v_sobrante := round(p_monto - v_aplica, 2);
  if v_sobrante <= 0.009 then
    -- Tolerancia de centavos (misma que la v2): todo aplica a la deuda.
    v_sobrante := 0;
    v_aplica := p_monto;
  end if;
  if v_aplica <= 0 then
    raise exception 'La deuda ya está cubierta; no hay saldo pendiente que pagar.';
  end if;

  -- CONDONACIÓN (v4): si tras aplicar TODO el pago queda un residuo de hasta
  -- $1 (centavos de redondeo cliente/servidor, o facturas que no dan exacto),
  -- se condona contra 5.2.10 y la deuda cierra sola. Un pago parcial de
  -- verdad (residuo > $1) no se toca.
  v_residuo := round(v_monto - (v_aplicado + v_aplica), 2);
  if v_residuo <= 0.009 or v_residuo > 1.00 then
    v_residuo := 0;
  end if;

  -- Cuenta de tesorería de origen
  select tipo, coalesce(es_caja_fuerte, false), saldo_actual
    into v_tipo_cuenta, v_es_boveda, v_saldo
    from public.cuentas where id = p_cuenta_origen_id for update;
  if v_saldo is null then
    raise exception 'La cuenta de origen del pago no existe.';
  end if;

  v_saldo_nuevo := v_saldo - p_monto;

  -- Guard de negativo SOLO para la bóveda (como fn_crear_egreso v2 / mig 122).
  if v_es_boveda and v_saldo_nuevo < 0 then
    raise exception 'El pago deja la caja fuerte en negativo (saldo actual %).', v_saldo;
  end if;

  -- 1) Movimiento de egreso en la cuenta de origen (baja saldo).
  --    ⚠ referencia_tipo 'cuenta_a_pagar' NO se toca: getSaldoCajaFuerte netea
  --    el circuito de la bóveda con ('egreso','cuenta_a_pagar') exactos.
  insert into public.movimientos_cuenta (
    cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo,
    descripcion, categoria, referencia_tipo, referencia_id, usuario_id, fecha
  ) values (
    p_cuenta_origen_id, 'egreso', p_monto, v_saldo, v_saldo_nuevo,
    'Pago a ' || coalesce(v_proveedor, 'proveedor') || ' · cuenta #' || p_cuenta_id,
    'pago_proveedores', 'cuenta_a_pagar', p_cuenta_id, p_usuario_id, v_fecha
  )
  returning id into v_mov_id;

  update public.cuentas
    set saldo_actual = v_saldo_nuevo, updated_at = now()
    where id = p_cuenta_origen_id;

  -- 2) Egreso (para P&L; excluido del resumen como pago de mercadería).
  insert into public.egresos (descripcion, monto, categoria, fecha, usuario_id, turno_id, cuenta_id)
  values (
    'Pago a ' || coalesce(v_proveedor, 'proveedor')
      || case when v_pedido_id is not null then ' (pedido #' || v_pedido_id || ')' else '' end,
    p_monto, 'pago_proveedores', v_fecha, p_usuario_id, null, p_cuenta_origen_id
  )
  returning id into v_egreso_id;

  -- 3) Asiento: Debe Proveedores por lo APLICADO (+ residuo condonado) +
  --    Debe Diferencias por el sobrante / Haber cuenta por el monto REAL
  --    (+ Haber Diferencias por el residuo condonado).
  select id into v_cta_prov from public.plan_cuentas where codigo = '2.1.01';
  select id into v_cta_dif from public.plan_cuentas where codigo = '5.2.10';
  v_cta_haber := case v_tipo_cuenta
    when 'caja' then (select id from public.plan_cuentas where codigo = '1.1.01')
    else (select id from public.plan_cuentas where codigo = '1.1.02')  -- banco / billetera
  end;
  if (v_sobrante > 0 or v_residuo > 0) and v_cta_dif is null then
    raise exception 'Falta la cuenta 5.2.10 Diferencias por Pagos y Redondeos en el plan.';
  end if;
  if v_cta_prov is not null and v_cta_haber is not null then
    insert into public.asientos (fecha, descripcion, tipo, origen, referencia_id, usuario_id)
    values (v_fecha, 'Pago cuenta #' || p_cuenta_id || ' · ' || coalesce(v_proveedor, 'proveedor'),
            'automatico', 'egreso', v_egreso_id, p_usuario_id)
    returning id into v_asiento_id;
    insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
    values (v_asiento_id, v_cta_prov, v_aplica, 0, v_orden);
    v_orden := v_orden + 1;
    if v_sobrante > 0 then
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_dif, v_sobrante, 0, v_orden);
      v_orden := v_orden + 1;
    end if;
    insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
    values (v_asiento_id, v_cta_haber, 0, p_monto, v_orden);
    v_orden := v_orden + 1;
    -- Condonación del residuo (v4): cierra 2.1.01 exacto contra lo acreditado
    -- por la factura; la contra-parte es un Haber en Diferencias (ganancia
    -- por redondeo). Σdebe = aplica + residuo = Σhaber = monto + residuo.
    if v_residuo > 0 then
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_prov, v_residuo, 0, v_orden);
      v_orden := v_orden + 1;
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_dif, 0, v_residuo, v_orden);
    end if;
  end if;

  -- 4) Registrar el pago en el historial (v4: + pago_id de retorno)
  insert into public.pagos_cuenta (
    cuenta_a_pagar_id, cuenta_origen_id, monto, fecha, nota,
    usuario_id, movimiento_id, egreso_id, forma_pago, comprobante, sobrante
  ) values (
    p_cuenta_id, p_cuenta_origen_id, p_monto, v_fecha, p_nota,
    p_usuario_id, v_mov_id, v_egreso_id, p_forma_pago, p_comprobante, v_sobrante
  )
  returning id into v_pago_id;

  -- 5) Acumular y cerrar. monto_pagado = plata REAL que salió; la deuda se
  --    considera cubierta con lo APLICADO + el residuo condonado.
  v_nuevo_pagado := v_pagado + p_monto;
  v_completa := (v_aplicado + v_aplica + v_residuo) >= v_monto - 0.009;
  update public.cuentas_a_pagar
    set monto_pagado = v_nuevo_pagado,
        estado = case when v_completa then 'pagada'::public.estado_cuenta_pagar else estado end,
        fecha_pago = case when v_completa then v_fecha else fecha_pago end
    where id = p_cuenta_id;

  -- 6) v6 (mig 148): con plan de cuotas, el vencimiento del padre pasa a la
  --    próxima cuota impaga (solo si la deuda no quedó saldada).
  if not v_completa then
    perform public.fn_sync_vencimiento_cuotas(p_cuenta_id);
  end if;

  return jsonb_build_object(
    'pagado', p_monto,
    'aplicado', v_aplica,
    'sobrante', v_sobrante,
    'condonado', v_residuo,
    'pago_id', v_pago_id,
    'monto_pagado_total', v_nuevo_pagado,
    'pendiente', greatest(v_monto - (v_aplicado + v_aplica + v_residuo), 0),
    'completa', v_completa,
    'movimiento_id', v_mov_id
  );
end;
$$;

revoke execute on function public.fn_pagar_cuenta(integer, uuid, integer, numeric, date, text, text, text) from public, anon;
grant execute on function public.fn_pagar_cuenta(integer, uuid, integer, numeric, date, text, text, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 5. fn_guardar_factura_compra v18 — = v17 (mig 147) + 12º argumento
--    p_cuotas. LA FIRMA CAMBIA → drop explícito de la de 11 args
--    (CREATE OR REPLACE no pisa firmas distintas).
-- ─────────────────────────────────────────────────────────────────────
drop function if exists public.fn_guardar_factura_compra(
  integer, integer, integer, date, boolean, uuid, jsonb, jsonb, numeric, jsonb, numeric);

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

revoke execute on function public.fn_guardar_factura_compra(integer, integer, integer, date, boolean, uuid, jsonb, jsonb, numeric, jsonb, numeric, jsonb) from public, anon;
grant execute on function public.fn_guardar_factura_compra(integer, integer, integer, date, boolean, uuid, jsonb, jsonb, numeric, jsonb, numeric, jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 6. fn_anular_factura_compra v2 — = v1 (mig 133) + borra el plan de
--    cuotas al anular. Misma firma (integer, uuid) → REPLACE limpio
--    (fn_cancelar_pedido, mig 136, la sigue llamando igual).
-- ─────────────────────────────────────────────────────────────────────
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
    select id, producto_id, cantidad_recibida, cantidad_facturada
      from public.items_pedido
      where cuenta_a_pagar_id = p_cuenta_id and cantidad_facturada is not null
      order by id
  loop
    v_delta := coalesce(v_ip.cantidad_recibida, 0) - v_ip.cantidad_facturada;
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

    update public.items_pedido set cantidad_facturada = null where id = v_ip.id;
  end loop;

  -- 3. Borrar la factura y sus items (cascade).
  delete from public.facturas_compra where cuenta_id = p_cuenta_id;

  -- 3b. v2 (mig 148): la factura se lleva su plan de cuotas. La deuda
  -- provisoria vuelve al vencimiento único vigente (el que dejó la última
  -- sync: la próxima cuota que estaba impaga), editable de nuevo en el Drawer.
  delete from public.cuotas_cuenta_pagar where cuenta_a_pagar_id = p_cuenta_id;

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

notify pgrst, 'reload schema';

-- Verificación post-migración (correr aparte):
--   select proname, count(*) from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname = 'public' and proname like 'fn_%'
--     group by proname having count(*) > 1;   → debe dar 0 filas
--   select * from pg_policies where tablename = 'cuotas_cuenta_pagar';
