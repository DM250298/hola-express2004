-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 128 · Blindaje del cobro con terminal MP Point           ║
-- ║                                                                     ║
-- ║  PROBLEMA: el cobro con la maquinita cobra la plata PRIMERO y       ║
-- ║  registra la venta DESPUÉS, solo en la pestaña del POS. Si esa      ║
-- ║  pestaña se cierra/recarga/duerme entre "aprobado" y "registrada",  ║
-- ║  la plata entra pero la venta nunca se graba (pasó en producción).  ║
-- ║                                                                     ║
-- ║  SOLUCIÓN: guardar el carrito ANTES de cobrar en un "intento de     ║
-- ║  cobro" (cobros_terminal) atado a la orden MP, para que un webhook  ║
-- ║  del servidor pueda crear la venta aunque la pestaña muera. La      ║
-- ║  idempotencia de fn_crear_venta por cliente_uuid garantiza que el   ║
-- ║  cliente (POS) y el webhook nunca dupliquen la venta.               ║
-- ║                                                                     ║
-- ║  Contenido:                                                         ║
-- ║   1. Tabla cobros_terminal (intento) + RLS por permiso 'terminales' ║
-- ║   2. fn_crear_venta v9 = v8 (mig 112) ÍNTEGRA + 7º arg opcional      ║
-- ║      p_forzar_turno (saltea la guarda de turno abierto para el      ║
-- ║      webhook/conciliación; el POS normal no lo pasa → igual que hoy)║
-- ║   3. fn_registrar_venta_cobro_terminal(uuid) — registra desde un    ║
-- ║      intento, idempotente, solo service_role                        ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────────────────────
-- 1. Tabla de intentos de cobro con terminal
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.cobros_terminal (
  id                   uuid primary key default gen_random_uuid(),
  orden_mp_id          text,
  external_reference   text,
  device_id            text,
  turno_id             integer references public.caja_turnos(id),
  usuario_id           uuid,
  cliente_id           integer,
  monto                numeric(14,2) not null,
  items                jsonb not null default '[]'::jsonb,
  pagos_previos        jsonb not null default '[]'::jsonb,
  estado               text not null default 'pendiente',
  venta_id             integer references public.ventas(id),
  medio_pago           text,
  comision_real        numeric(14,2),
  iibb_real            numeric(14,2),
  mp_payment_type      text,
  mp_payment_method_id text,
  error                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists idx_cobros_terminal_ext_ref  on public.cobros_terminal(external_reference);
create index if not exists idx_cobros_terminal_orden_mp on public.cobros_terminal(orden_mp_id);
create index if not exists idx_cobros_terminal_estado   on public.cobros_terminal(estado);
create index if not exists idx_cobros_terminal_venta    on public.cobros_terminal(venta_id);

-- RLS: solo lectura para quien tiene el permiso de terminales. La escritura
-- va 100% por service_role (endpoints del servidor), que bypassea RLS. La
-- llamada envuelta en (select ...) evita reevaluar por fila (patrón mig 111).
alter table public.cobros_terminal enable row level security;
drop policy if exists "cobros_terminal_select" on public.cobros_terminal;
create policy "cobros_terminal_select" on public.cobros_terminal
  for select to authenticated
  using ((select public.fn_tiene_permiso('terminales')));

-- ─────────────────────────────────────────────────────────────────────
-- 2. fn_crear_venta v9 · v8 (mig 112) ÍNTEGRA + 7º arg p_forzar_turno.
--    Agregar un argumento cambia la firma → hay que DROPear la de 6 args
--    y recrear (CREATE OR REPLACE no pisa firmas distintas). El único
--    cambio de lógica es la guarda de turno, ahora condicional.
-- ─────────────────────────────────────────────────────────────────────
drop function if exists public.fn_crear_venta(integer, uuid, jsonb, jsonb, uuid, integer);

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
  end loop;

  select p->>'medio_pago' into v_medio_principal
  from jsonb_array_elements(p_pagos) p order by (p->>'monto')::numeric desc limit 1;

  -- El header se inserta atajando la carrera POS ↔ webhook: si otra
  -- transacción ya creó esta venta (mismo cliente_uuid, índice único parcial
  -- ventas_cliente_uuid_key de la mig 027), devolvemos la existente como éxito
  -- idempotente en vez de reventar con unique_violation.
  begin
    insert into public.ventas (turno_id, usuario_id, total, medio_pago, estado, cliente_uuid, cliente_id)
    values (p_turno_id, p_usuario_id, v_total, v_medio_principal, 'completada', p_cliente_uuid, p_cliente_id)
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
-- 3. fn_registrar_venta_cobro_terminal — registra la venta desde un
--    intento de cobro. Idempotente (por venta_id del intento y por
--    cliente_uuid de fn_crear_venta). La usan el webhook y la pantalla
--    de conciliación, ambos vía service_role. NO cachea la excepción de
--    fn_crear_venta: si falla, propaga y el caller marca 'fallida' en
--    una transacción aparte (si la cacheáramos y re-lanzáramos, el
--    rollback borraría también ese marcado).
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_registrar_venta_cobro_terminal(
  p_cobro_id uuid
) returns public.ventas
language plpgsql security definer set search_path = public
as $$
declare
  v_cobro public.cobros_terminal;
  v_venta public.ventas;
  v_linea jsonb;
  v_pagos jsonb;
begin
  select * into v_cobro from public.cobros_terminal where id = p_cobro_id for update;
  if not found then
    raise exception 'El intento de cobro % no existe.', p_cobro_id;
  end if;

  -- Ya registrada: devolver la venta existente (idempotencia a nivel intento).
  if v_cobro.venta_id is not null then
    select * into v_venta from public.ventas where id = v_cobro.venta_id;
    return v_venta;
  end if;

  if v_cobro.medio_pago is null then
    raise exception 'El intento % todavía no tiene medio de pago resuelto.', p_cobro_id;
  end if;

  -- Línea de la maquinita con la comisión + IIBB REALES que reportó MP.
  v_linea := jsonb_build_object(
    'medio_pago', v_cobro.medio_pago,
    'monto', v_cobro.monto,
    'comision_monto', v_cobro.comision_real,
    'iibb_monto', v_cobro.iibb_real
  );
  v_pagos := coalesce(v_cobro.pagos_previos, '[]'::jsonb) || jsonb_build_array(v_linea);

  -- Fuerza el turno original aunque esté cerrado (decisión de negocio).
  v_venta := public.fn_crear_venta(
    v_cobro.turno_id, v_cobro.usuario_id, v_pagos, v_cobro.items,
    p_cobro_id, v_cobro.cliente_id, true
  );

  update public.cobros_terminal
    set estado = 'registrada', venta_id = v_venta.id, error = null, updated_at = now()
    where id = p_cobro_id;

  return v_venta;
end;
$$;

-- Esta RPC crea ventas: que solo la ejecute el service_role (webhook +
-- endpoint de conciliación). El cliente jamás la llama directo.
revoke all on function public.fn_registrar_venta_cobro_terminal(uuid) from public;
revoke all on function public.fn_registrar_venta_cobro_terminal(uuid) from anon, authenticated;
grant execute on function public.fn_registrar_venta_cobro_terminal(uuid) to service_role;

notify pgrst, 'reload schema';
