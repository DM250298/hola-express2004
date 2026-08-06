-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 141 · Cobranza de cuenta corriente (fiado)               ║
-- ║                                                                     ║
-- ║  PROBLEMA: con la 139/140 el POS puede fiar, pero no hay forma      ║
-- ║  atómica de COBRAR la deuda, y un cobro en efectivo en la caja      ║
-- ║  metería plata al cajón que el cierre no espera (sobrante falso).   ║
-- ║                                                                     ║
-- ║  SOLUCIÓN:                                                          ║
-- ║   1. fn_cobrar_cta_cte — dos modos MUTUAMENTE EXCLUYENTES           ║
-- ║      (regla de oro de la mig 120, invertida para ingresos):         ║
-- ║      · p_turno_id  → cobro en EFECTIVO en la caja del POS. NO toca  ║
-- ║        movimientos_cuenta: la plata queda en el cajón y entra a la  ║
-- ║        bóveda por cierre → sangría → arqueo (candado 118). Asiento  ║
-- ║        DEBE 1.1.01 Caja / HABER 1.1.03 Deudores.                    ║
-- ║      · p_cuenta_id → cobro por TESORERÍA (transferencia, MP...):    ║
-- ║        ingreso en movimientos_cuenta + saldo + asiento DEBE         ║
-- ║        1.1.01/1.1.02 según tipo de cuenta / HABER 1.1.03.           ║
-- ║      El pago queda en la cta. cte. como movimiento 'pago_libre'     ║
-- ║      negativo, con turno_id/cuenta_id/movimiento_id/asiento_id.     ║
-- ║   2. fn_cobros_fiado_turno — total cobrado en efectivo en un turno  ║
-- ║      (para sumarlo al esperado del cierre de caja).                 ║
-- ║                                                                     ║
-- ║  Requiere la 139. Ejecutar UNA sola vez, COMPLETO.                  ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─── 1. Cobrar la deuda de un deudor ─────────────────────────────────

create or replace function public.fn_cobrar_cta_cte(
  p_deudor_tipo text,
  p_deudor_id   integer,
  p_monto       numeric,
  p_usuario_id  uuid,
  p_cuenta_id   integer default null,   -- cobro por tesorería (Finanzas)
  p_turno_id    integer default null,   -- cobro en efectivo en la caja del POS
  p_fecha       date    default null,
  p_nota        text    default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fecha date := coalesce(p_fecha, current_date);
  v_nombre text; v_saldo numeric; v_mov_id integer; v_cc_id integer;
  v_tipo_cuenta text; v_es_boveda boolean; v_saldo_cta numeric; v_saldo_nuevo numeric;
  v_asiento_id integer; v_cta_deudores integer; v_cta_debe integer;
begin
  -- REGLA DE ORO (mig 120, espejo para ingresos): un cobro en la caja del
  -- POS entra al cajón y se computa en el ARQUEO; NO puede además acreditar
  -- una cuenta de tesorería (contaría el efectivo dos veces).
  if p_cuenta_id is not null and p_turno_id is not null then
    raise exception 'Un cobro en caja no puede acreditar una cuenta (doble conteo del efectivo).';
  end if;
  if p_cuenta_id is null and p_turno_id is null then
    raise exception 'Indicá de dónde entra la plata: caja del turno o cuenta de tesorería.';
  end if;
  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto del cobro debe ser mayor a 0.';
  end if;
  if p_deudor_tipo is null or p_deudor_tipo not in ('cliente', 'empleado') then
    raise exception 'Tipo de deudor inválido: %', coalesce(p_deudor_tipo, '(null)');
  end if;
  if public.fn_periodo_cerrado(v_fecha) then
    raise exception 'El período contable de esa fecha está cerrado.';
  end if;

  -- Permisos: cobrar por tesorería exige el permiso de fiado; cobrar en caja
  -- alcanza con ser el dueño del turno ABIERTO (el cajero cobra sin permiso
  -- de finanzas, igual que registra ventas).
  if p_cuenta_id is not null then
    if not (select public.fn_tiene_permiso('cuenta_corriente')) then
      raise exception 'No tenés permiso para cobrar desde una cuenta de tesorería.';
    end if;
  else
    if not exists (
      select 1 from public.caja_turnos
      where id = p_turno_id and estado = 'abierto'
        and (usuario_id = auth.uid() or auth.uid() is null)
    ) and not (select public.fn_tiene_permiso('cuenta_corriente')) then
      raise exception 'Solo podés cobrar fiado contra tu propio turno abierto.';
    end if;
  end if;

  -- Deudor + saldo, con FOR UPDATE del deudor (serializa contra un fiado
  -- simultáneo de fn_crear_venta, que bloquea la misma fila).
  if p_deudor_tipo = 'cliente' then
    select nombre into v_nombre from public.clientes where id = p_deudor_id for update;
    select coalesce(sum(monto), 0) into v_saldo
      from public.cuenta_corriente_cliente where cliente_id = p_deudor_id;
  else
    select btrim(coalesce(nombre, '') || ' ' || coalesce(apellido, '')) into v_nombre
      from public.empleados where id = p_deudor_id for update;
    select coalesce(sum(monto), 0) into v_saldo
      from public.cuenta_corriente_empleado where empleado_id = p_deudor_id;
  end if;
  if v_nombre is null then raise exception 'El deudor no existe.'; end if;
  if p_monto > v_saldo + 0.009 then
    raise exception 'El cobro ($%) supera la deuda ($%).', round(p_monto, 2), round(v_saldo, 2);
  end if;

  select id into v_cta_deudores from public.plan_cuentas where codigo = '1.1.03';

  if p_cuenta_id is not null then
    -- ── Cobro por tesorería: acredita la cuenta elegida. ──
    select tipo, coalesce(es_caja_fuerte, false), saldo_actual
      into v_tipo_cuenta, v_es_boveda, v_saldo_cta
      from public.cuentas where id = p_cuenta_id for update;
    if v_saldo_cta is null then raise exception 'La cuenta de destino no existe.'; end if;
    v_saldo_nuevo := v_saldo_cta + p_monto;
    insert into public.movimientos_cuenta (
      cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo,
      descripcion, categoria, referencia_tipo, referencia_id, usuario_id, fecha
    ) values (
      p_cuenta_id, 'ingreso', p_monto, v_saldo_cta, v_saldo_nuevo,
      'Cobro cta. cte. · ' || v_nombre, 'cobro_cta_cte', 'cta_cte', p_deudor_id,
      p_usuario_id, v_fecha
    ) returning id into v_mov_id;
    update public.cuentas set saldo_actual = v_saldo_nuevo, updated_at = now()
      where id = p_cuenta_id;
    v_cta_debe := case v_tipo_cuenta
      when 'caja' then (select id from public.plan_cuentas where codigo = '1.1.01')
      else (select id from public.plan_cuentas where codigo = '1.1.02')
    end;
  else
    -- ── Cobro en la caja del POS: NO toca movimientos_cuenta (candado 118).
    --    La plata queda en el cajón; el esperado del cierre la suma vía
    --    fn_cobros_fiado_turno y entra a la bóveda por sangría + arqueo. ──
    v_cta_debe := (select id from public.plan_cuentas where codigo = '1.1.01');
  end if;

  if v_cta_deudores is not null and v_cta_debe is not null then
    insert into public.asientos (fecha, descripcion, tipo, origen, referencia_id, usuario_id)
    values (v_fecha, 'Cobro cta. cte. · ' || v_nombre, 'automatico', 'cobro_cta_cte',
            p_deudor_id, p_usuario_id)
    returning id into v_asiento_id;
    insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
    values (v_asiento_id, v_cta_debe, p_monto, 0, 0);
    insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
    values (v_asiento_id, v_cta_deudores, 0, p_monto, 1);
  end if;

  if p_deudor_tipo = 'cliente' then
    insert into public.cuenta_corriente_cliente
      (cliente_id, fecha, tipo, concepto, monto, turno_id, cuenta_id, movimiento_id, asiento_id, usuario_id)
    values (p_deudor_id, v_fecha, 'pago_libre',
            coalesce(nullif(btrim(p_nota), ''), 'Cobro de cuenta corriente'),
            -p_monto, p_turno_id, p_cuenta_id, v_mov_id, v_asiento_id, p_usuario_id)
    returning id into v_cc_id;
  else
    insert into public.cuenta_corriente_empleado
      (empleado_id, fecha, tipo, concepto, monto, turno_id, cuenta_id, movimiento_id, asiento_id, usuario_id)
    values (p_deudor_id, v_fecha, 'pago_libre',
            coalesce(nullif(btrim(p_nota), ''), 'Cobro de cuenta corriente'),
            -p_monto, p_turno_id, p_cuenta_id, v_mov_id, v_asiento_id, p_usuario_id)
    returning id into v_cc_id;
  end if;

  return jsonb_build_object(
    'movimiento_cta_cte_id', v_cc_id,
    'saldo_anterior', v_saldo,
    'saldo_nuevo', v_saldo - p_monto,
    'asiento_id', v_asiento_id,
    'movimiento_id', v_mov_id
  );
end $$;

revoke execute on function public.fn_cobrar_cta_cte(text, integer, numeric, uuid, integer, integer, date, text) from anon;
grant  execute on function public.fn_cobrar_cta_cte(text, integer, numeric, uuid, integer, integer, date, text) to authenticated;

-- ─── 2. Cobros de fiado en efectivo de un turno (para el arqueo) ─────
-- Definer: el cajero no puede leer las tablas de cta. cte. por RLS, pero
-- el cierre de SU turno necesita el total cobrado en efectivo. Devuelve
-- solo un número y solo para el dueño del turno (o quien tenga permiso).

create or replace function public.fn_cobros_fiado_turno(p_turno_id integer)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_total numeric;
begin
  if not exists (
    select 1 from public.caja_turnos
    where id = p_turno_id
      and (usuario_id = auth.uid()
           or (select public.fn_tiene_permiso('finanzas'))
           or (select public.fn_tiene_permiso('cuenta_corriente')))
  ) then
    return 0;
  end if;

  select coalesce(-sum(monto), 0) into v_total from (
    select monto from public.cuenta_corriente_cliente
      where turno_id = p_turno_id and monto < 0
    union all
    select monto from public.cuenta_corriente_empleado
      where turno_id = p_turno_id and monto < 0
  ) s;
  return coalesce(v_total, 0);
end $$;

revoke execute on function public.fn_cobros_fiado_turno(integer) from anon;
grant  execute on function public.fn_cobros_fiado_turno(integer) to authenticated;

notify pgrst, 'reload schema';
