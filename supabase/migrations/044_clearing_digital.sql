-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 044 · FASE 2 — Clearing Digital (Cuentas por cobrar)     ║
-- ║                                                                     ║
-- ║  Las ventas con tarjeta / billetera quedan "pendientes de           ║
-- ║  acreditación": el sistema calcula cuándo entrarán al banco según   ║
-- ║  plazos y comisiones de cada procesador.                            ║
-- ║                                                                     ║
-- ║  Cambios:                                                           ║
-- ║   1. medios_pago.dias_acreditacion (default 0 = inmediato)          ║
-- ║   2. Tabla acreditaciones (cada pago no inmediato genera una fila)  ║
-- ║   3. fn_crear_venta v3: si el medio tiene plazo > 0, crea           ║
-- ║      acreditación pendiente en lugar de ingresar al banco           ║
-- ║   4. fn_acreditar_pago: marca la acreditación cobrada y mueve la    ║
-- ║      plata al banco                                                 ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────────────────────
-- 1. Plazo de acreditación por medio de pago
-- ─────────────────────────────────────────────────────────────────────
alter table public.medios_pago
  add column if not exists dias_acreditacion integer not null default 0;

-- Plazos típicos en Argentina (ajustables después desde la UI)
update public.medios_pago set dias_acreditacion = 1
  where codigo = 'debito' and dias_acreditacion = 0;
update public.medios_pago set dias_acreditacion = 14
  where codigo = 'credito' and dias_acreditacion = 0;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Tabla de acreditaciones (cuentas por cobrar de tarjetas / MP)
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.acreditaciones (
  id              serial primary key,
  venta_id        integer references public.ventas(id) on delete cascade,
  pago_venta_id   integer references public.pagos_venta(id) on delete cascade,
  medio_pago      text not null,
  cuenta_id       integer references public.cuentas(id) on delete set null,
  monto_bruto     numeric(12,2) not null,
  comision_pct    numeric(5,2) not null default 0,
  comision_monto  numeric(12,2) not null default 0,
  monto_neto      numeric(12,2) not null,
  fecha_venta     date not null default current_date,
  fecha_estimada  date not null,
  fecha_real      date,
  estado          text not null default 'pendiente',  -- 'pendiente' | 'acreditada' | 'cancelada'
  movimiento_id   integer,  -- movimiento_cuenta generado al acreditarse
  usuario_id      uuid references public.usuarios(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_acreditaciones_estado on public.acreditaciones(estado);
create index if not exists idx_acreditaciones_fecha_est on public.acreditaciones(fecha_estimada);
create index if not exists idx_acreditaciones_venta on public.acreditaciones(venta_id);

alter table public.acreditaciones enable row level security;
do $$ begin
  create policy "todo" on public.acreditaciones
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 3. fn_crear_venta v3 — bifurca según plazo del medio:
--    · Si dias_acreditacion = 0 → ingresa al instante (igual que v2).
--    · Si dias_acreditacion > 0 → NO toca el saldo; crea acreditación
--      pendiente con fecha estimada = hoy + plazo y comisión neta.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_crear_venta(
  p_turno_id integer,
  p_usuario_id uuid,
  p_pagos jsonb,
  p_items jsonb
) returns public.ventas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total numeric := 0;
  v_medio_principal text;
  v_venta public.ventas;
  v_hoy date := current_date;
  v_ahora timestamptz := now();
  v_pago jsonb;
  v_item jsonb;
  v_medio text;
  v_monto numeric;
  v_cuenta_id integer;
  v_comision numeric;
  v_comision_monto numeric;
  v_dias_acred integer;
  v_pago_venta_id integer;
  v_saldo numeric;
  v_saldo_nuevo numeric;
  v_prod_id integer;
  v_cantidad integer;
  v_precio numeric;
  v_stock_ant integer;
  v_stock_nuevo integer;
  v_lote record;
  v_restante integer;
  v_usar integer;
  v_costo_unit numeric;
  v_total_costo numeric := 0;
  v_pagos_no_efec numeric := 0;
  v_neto numeric;
  v_iva numeric;
  v_efectivo numeric;
  v_no_efec numeric;
  v_asiento_id integer;
  v_orden integer := 0;
  v_cta_ventas integer;
  v_cta_iva integer;
  v_cta_caja integer;
  v_cta_banco integer;
  v_cta_cmv integer;
  v_cta_merc integer;
begin
  if p_pagos is null or jsonb_array_length(p_pagos) = 0 then
    raise exception 'La venta debe tener al menos un pago.';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_total := v_total
      + (v_item->>'precio_unitario')::numeric * (v_item->>'cantidad')::integer;
  end loop;

  select p->>'medio_pago' into v_medio_principal
  from jsonb_array_elements(p_pagos) p
  order by (p->>'monto')::numeric desc
  limit 1;

  insert into public.ventas (turno_id, usuario_id, total, medio_pago, estado)
  values (p_turno_id, p_usuario_id, v_total, v_medio_principal, 'completada')
  returning * into v_venta;

  for v_pago in select * from jsonb_array_elements(p_pagos) loop
    insert into public.pagos_venta (venta_id, medio_pago, monto)
    values (v_venta.id, v_pago->>'medio_pago', (v_pago->>'monto')::numeric)
    returning id into v_pago_venta_id;

    v_medio := v_pago->>'medio_pago';
    v_monto := (v_pago->>'monto')::numeric;

    if v_medio <> 'efectivo' then
      v_pagos_no_efec := v_pagos_no_efec + v_monto;
    end if;

    select cuenta_id, coalesce(comision_porcentaje, 0),
           coalesce(dias_acreditacion, 0)
      into v_cuenta_id, v_comision, v_dias_acred
      from public.medios_pago where codigo = v_medio;
    if v_cuenta_id is null then
      continue;
    end if;

    v_comision_monto := round(v_monto * v_comision) / 100;

    -- ── BIFURCACIÓN: con plazo (clearing) vs. acreditación inmediata ──
    if v_dias_acred > 0 then
      -- No toca el saldo; crea una acreditación pendiente
      insert into public.acreditaciones (
        venta_id, pago_venta_id, medio_pago, cuenta_id,
        monto_bruto, comision_pct, comision_monto, monto_neto,
        fecha_venta, fecha_estimada, estado, usuario_id
      ) values (
        v_venta.id, v_pago_venta_id, v_medio, v_cuenta_id,
        v_monto, v_comision, v_comision_monto, v_monto - v_comision_monto,
        v_hoy, v_hoy + v_dias_acred, 'pendiente', p_usuario_id
      );
    else
      -- Acreditación inmediata: ingresa al banco igual que antes
      select saldo_actual into v_saldo
        from public.cuentas where id = v_cuenta_id for update;
      if v_saldo is null then
        continue;
      end if;
      v_saldo_nuevo := v_saldo + v_monto;
      insert into public.movimientos_cuenta (
        cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo,
        descripcion, categoria, referencia_tipo, referencia_id, usuario_id, fecha
      ) values (
        v_cuenta_id, 'ingreso', v_monto, v_saldo, v_saldo_nuevo,
        'Venta #' || v_venta.id || ' · ' || v_medio,
        'venta', 'venta', v_venta.id, p_usuario_id, v_hoy
      );
      if v_comision_monto > 0 then
        insert into public.movimientos_cuenta (
          cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo,
          descripcion, categoria, referencia_tipo, referencia_id, usuario_id, fecha
        ) values (
          v_cuenta_id, 'egreso', v_comision_monto,
          v_saldo_nuevo, v_saldo_nuevo - v_comision_monto,
          'Comisión ' || v_medio || ' (' || v_comision || '%) · Venta #' || v_venta.id,
          'comisiones', 'venta', v_venta.id, p_usuario_id, v_hoy
        );
        v_saldo_nuevo := v_saldo_nuevo - v_comision_monto;
      end if;
      update public.cuentas
        set saldo_actual = v_saldo_nuevo, updated_at = v_ahora
        where id = v_cuenta_id;
    end if;
  end loop;

  -- Items + stock + lotes + acumular costo (idéntico a v2)
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_prod_id := (v_item->>'producto_id')::integer;
    v_cantidad := (v_item->>'cantidad')::integer;
    v_precio := (v_item->>'precio_unitario')::numeric;

    select stock_actual, coalesce(precio_costo, 0)
      into v_stock_ant, v_costo_unit
      from public.productos where id = v_prod_id for update;
    v_stock_ant := coalesce(v_stock_ant, 0);
    v_stock_nuevo := v_stock_ant - v_cantidad;
    v_total_costo := v_total_costo + v_costo_unit * v_cantidad;

    insert into public.items_venta
      (venta_id, producto_id, cantidad, precio_unitario, subtotal)
    values
      (v_venta.id, v_prod_id, v_cantidad, v_precio, v_precio * v_cantidad);

    update public.productos
      set stock_actual = v_stock_nuevo, updated_at = v_ahora
      where id = v_prod_id;

    insert into public.movimientos_stock (
      producto_id, tipo, cantidad, stock_anterior, stock_nuevo,
      referencia_id, usuario_id, nota
    ) values (
      v_prod_id, 'venta', v_cantidad, v_stock_ant, v_stock_nuevo,
      v_venta.id, p_usuario_id, 'Venta #' || v_venta.id
    );

    v_restante := v_cantidad;
    for v_lote in
      select id, cantidad_actual
        from public.lotes
        where producto_id = v_prod_id
          and estado = 'activo'
          and cantidad_actual > 0
        order by fecha_vencimiento asc
        for update
    loop
      exit when v_restante <= 0;
      v_usar := least(v_lote.cantidad_actual, v_restante);
      update public.lotes
        set cantidad_actual = v_lote.cantidad_actual - v_usar,
            estado = case
              when v_lote.cantidad_actual - v_usar = 0 then 'agotado'
              else 'activo'
            end
        where id = v_lote.id;
      v_restante := v_restante - v_usar;
    end loop;
  end loop;

  -- Asiento contable (idéntico a v2)
  select id into v_cta_ventas from public.plan_cuentas where codigo = '4.1.01';
  select id into v_cta_iva from public.plan_cuentas where codigo = '2.1.02';
  select id into v_cta_caja from public.plan_cuentas where codigo = '1.1.01';
  select id into v_cta_banco from public.plan_cuentas where codigo = '1.1.02';
  select id into v_cta_cmv from public.plan_cuentas where codigo = '5.1.01';
  select id into v_cta_merc from public.plan_cuentas where codigo = '1.1.04';

  if v_total > 0 and v_cta_ventas is not null and v_cta_iva is not null
     and v_cta_caja is not null and v_cta_banco is not null then
    v_neto := round(v_total / 1.21, 2);
    v_iva := round(v_total - v_neto, 2);
    v_no_efec := least(v_pagos_no_efec, v_total);
    v_efectivo := v_total - v_no_efec;

    insert into public.asientos (fecha, descripcion, tipo, origen, referencia_id, usuario_id)
    values (v_hoy, 'Venta #' || v_venta.id, 'automatico', 'venta', v_venta.id, p_usuario_id)
    returning id into v_asiento_id;

    if v_efectivo > 0 then
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_caja, v_efectivo, 0, v_orden);
      v_orden := v_orden + 1;
    end if;
    if v_no_efec > 0 then
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_banco, v_no_efec, 0, v_orden);
      v_orden := v_orden + 1;
    end if;
    insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
    values (v_asiento_id, v_cta_ventas, 0, v_neto, v_orden);
    v_orden := v_orden + 1;
    insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
    values (v_asiento_id, v_cta_iva, 0, v_iva, v_orden);
    v_orden := v_orden + 1;

    if v_cta_cmv is not null and v_cta_merc is not null and v_total_costo > 0 then
      v_total_costo := round(v_total_costo, 2);
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_cmv, v_total_costo, 0, v_orden);
      v_orden := v_orden + 1;
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_merc, 0, v_total_costo, v_orden);
    end if;
  end if;

  return v_venta;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 4. fn_acreditar_pago: marca una acreditación como cobrada y mueve
--    el monto neto (bruto − comisión) a la cuenta bancaria.
--    Si fecha_real_param es null, usa hoy.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_acreditar_pago(
  p_acreditacion_id integer,
  p_usuario_id uuid,
  p_fecha_real date
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_acred record;
  v_saldo_ant numeric;
  v_saldo_nuevo numeric;
  v_mov_id integer;
  v_fecha date := coalesce(p_fecha_real, current_date);
begin
  select * into v_acred from public.acreditaciones
    where id = p_acreditacion_id for update;
  if not found then
    raise exception 'La acreditación no existe.';
  end if;
  if v_acred.estado <> 'pendiente' then
    raise exception 'La acreditación ya está en estado %.', v_acred.estado;
  end if;
  if v_acred.cuenta_id is null then
    raise exception 'No hay cuenta bancaria asociada al medio de pago.';
  end if;

  select saldo_actual into v_saldo_ant
    from public.cuentas where id = v_acred.cuenta_id for update;
  v_saldo_nuevo := v_saldo_ant + v_acred.monto_neto;

  insert into public.movimientos_cuenta (
    cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo,
    descripcion, categoria, referencia_tipo, referencia_id, usuario_id, fecha
  ) values (
    v_acred.cuenta_id, 'ingreso', v_acred.monto_neto, v_saldo_ant, v_saldo_nuevo,
    'Acreditación ' || v_acred.medio_pago || ' · Venta #' || v_acred.venta_id ||
      ' (neto, comisión ' || v_acred.comision_pct || '%)',
    'acreditacion', 'acreditacion', v_acred.id, p_usuario_id, v_fecha
  )
  returning id into v_mov_id;

  update public.cuentas
    set saldo_actual = v_saldo_nuevo, updated_at = now()
    where id = v_acred.cuenta_id;

  update public.acreditaciones
    set estado = 'acreditada',
        fecha_real = v_fecha,
        movimiento_id = v_mov_id,
        updated_at = now()
    where id = p_acreditacion_id;

  return jsonb_build_object(
    'movimiento_id', v_mov_id,
    'monto_neto', v_acred.monto_neto,
    'saldo_nuevo', v_saldo_nuevo
  );
end;
$$;

notify pgrst, 'reload schema';
