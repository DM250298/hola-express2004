-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 120 · PEDIDO 1 — El egreso de Finanzas debita una cuenta ║
-- ║                                                                     ║
-- ║  · fn_crear_egreso v2: 7º arg p_cuenta_origen_id (nullable).        ║
-- ║      cuenta NOT NULL + turno NULL  → DEBITA la cuenta elegida       ║
-- ║        (movimientos_cuenta 'egreso' referencia_tipo='egreso' +      ║
-- ║         update saldo + Haber por tipo; guard negativo SOLO bóveda). ║
-- ║      cuenta + turno a la vez       → RAISE (doble conteo: el gasto  ║
-- ║        del turno ya se descuenta en el cierre).                     ║
-- ║      sin cuenta / con turno        → comportamiento legacy          ║
-- ║        (Haber Caja 1.1.01 fijo, NO toca cuentas).                   ║
-- ║      + guard fn_periodo_cerrado (antes faltaba).                    ║
-- ║  · fn_anular_egreso: repone saldo + movimiento inverso + reversa    ║
-- ║      del asiento + borra el egreso.                                 ║
-- ║                                                                     ║
-- ║  Correr UNA vez, COMPLETO, en el SQL Editor de Supabase.           ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- Cambia la firma (agrega 7º arg) → drop de la firma vieja de 6 args primero.
drop function if exists public.fn_crear_egreso(text, numeric, text, date, uuid, integer);

create or replace function public.fn_crear_egreso(
  p_descripcion text,
  p_monto numeric,
  p_categoria text,
  p_fecha date,
  p_usuario_id uuid,
  p_turno_id integer,
  p_cuenta_origen_id integer default null
) returns public.egresos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_egreso public.egresos;
  v_asiento_id integer;
  v_cta_debe integer;
  v_cta_haber integer;
  v_fecha date := coalesce(p_fecha, current_date);
  v_debita boolean := (p_cuenta_origen_id is not null and p_turno_id is null);
  v_cuenta_final integer;
  v_tipo_cuenta text;
  v_es_boveda boolean;
  v_saldo numeric;
  v_saldo_nuevo numeric;
begin
  -- Guard de período cerrado (antes faltaba en fn_crear_egreso).
  if public.fn_periodo_cerrado(v_fecha) then
    raise exception 'El período de ese gasto está cerrado; no se puede registrar.';
  end if;

  -- REGLA DE ORO anti-doble-conteo: un gasto del turno (efectivo del POS) ya se
  -- descuenta del cierre de caja; NO puede además debitar una cuenta de tesorería.
  if p_cuenta_origen_id is not null and p_turno_id is not null then
    raise exception 'Un gasto de turno no puede debitar una cuenta (doble conteo del efectivo).';
  end if;

  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto del egreso debe ser mayor a 0.';
  end if;

  -- Pagar desde una cuenta requiere permiso de finanzas.
  if v_debita and not (select public.fn_tiene_permiso('finanzas')) then
    raise exception 'No tenés permiso para pagar desde una cuenta de tesorería.';
  end if;

  -- cuenta_id queda registrado SOLO cuando el egreso realmente debita una cuenta.
  v_cuenta_final := case when v_debita then p_cuenta_origen_id else null end;

  insert into public.egresos (
    descripcion, monto, categoria, fecha, usuario_id, turno_id, cuenta_id
  ) values (
    p_descripcion, p_monto, p_categoria, v_fecha, p_usuario_id, p_turno_id, v_cuenta_final
  )
  returning * into v_egreso;

  -- Debe: cuenta del gasto según la categoría (idéntico a la v1).
  v_cta_debe := case p_categoria
    when 'alquiler' then (select id from public.plan_cuentas where codigo = '5.2.03')
    when 'servicios' then (select id from public.plan_cuentas where codigo = '5.2.04')
    when 'sueldos' then (select id from public.plan_cuentas where codigo = '5.2.01')
    when 'mantenimiento' then (select id from public.plan_cuentas where codigo = '5.2.05')
    when 'impuestos' then (select id from public.plan_cuentas where codigo = '5.2.06')
    when 'pago_proveedores' then (select id from public.plan_cuentas where codigo = '2.1.01')
    else (select id from public.plan_cuentas where codigo = '5.2.09')
  end;

  if v_debita then
    -- ── Egreso de Finanzas que SALE de una cuenta de tesorería ──────────
    select tipo, coalesce(es_caja_fuerte, false), saldo_actual
      into v_tipo_cuenta, v_es_boveda, v_saldo
      from public.cuentas where id = p_cuenta_origen_id for update;
    if v_saldo is null then
      raise exception 'La cuenta de origen del gasto no existe.';
    end if;

    v_saldo_nuevo := v_saldo - p_monto;

    -- Guard de negativo SOLO para la bóveda (como fn_registrar_mov_caja_fuerte).
    -- Bancos/billeteras pueden quedar en rojo (igual que fn_pagar_cuenta v2).
    if v_es_boveda and v_saldo_nuevo < 0 then
      raise exception 'El gasto deja la caja fuerte en negativo (saldo actual %).', v_saldo;
    end if;

    -- referencia_tipo='egreso' → getSaldoCajaFuerte lo netea del circuito
    -- (evita el banner de descuadre falso cuando el pago sale de la bóveda).
    insert into public.movimientos_cuenta (
      cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo,
      descripcion, categoria, referencia_tipo, referencia_id, usuario_id, fecha
    ) values (
      p_cuenta_origen_id, 'egreso', p_monto, v_saldo, v_saldo_nuevo,
      p_descripcion, p_categoria, 'egreso', v_egreso.id, p_usuario_id, v_fecha
    );

    update public.cuentas
      set saldo_actual = v_saldo_nuevo, updated_at = now()
      where id = p_cuenta_origen_id;

    -- Haber según el tipo de la cuenta de origen (mismo case que fn_pagar_cuenta v2).
    v_cta_haber := case v_tipo_cuenta
      when 'caja' then (select id from public.plan_cuentas where codigo = '1.1.01')
      else (select id from public.plan_cuentas where codigo = '1.1.02')
    end;
  else
    -- ── Legacy (gasto del turno o sin cuenta): Haber Caja 1.1.01, NO toca cuentas ──
    v_cta_haber := (select id from public.plan_cuentas where codigo = '1.1.01');
  end if;

  if v_cta_debe is not null and v_cta_haber is not null then
    insert into public.asientos (fecha, descripcion, tipo, origen, referencia_id, usuario_id)
    values (v_fecha, p_descripcion, 'automatico', 'egreso', v_egreso.id, p_usuario_id)
    returning id into v_asiento_id;
    insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
    values (v_asiento_id, v_cta_debe, p_monto, 0, 0);
    insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
    values (v_asiento_id, v_cta_haber, 0, p_monto, 1);
  end if;

  return v_egreso;
end;
$$;

revoke execute on function public.fn_crear_egreso(text, numeric, text, date, uuid, integer, integer) from anon;
grant execute on function public.fn_crear_egreso(text, numeric, text, date, uuid, integer, integer) to authenticated;

-- ─── Anular un egreso (revierte saldo + movimiento inverso + asiento) ───────────
create or replace function public.fn_anular_egreso(
  p_egreso_id integer,
  p_usuario_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_egreso public.egresos;
  v_saldo numeric;
  v_saldo_nuevo numeric;
begin
  select * into v_egreso from public.egresos where id = p_egreso_id;
  if v_egreso.id is null then
    raise exception 'El egreso no existe.';
  end if;

  if not (select public.fn_tiene_permiso('finanzas')) then
    raise exception 'No tenés permiso para anular egresos.';
  end if;

  if public.fn_periodo_cerrado(v_egreso.fecha) then
    raise exception 'El período de ese gasto está cerrado; no se puede anular.';
  end if;

  -- No anular egresos que respaldan un pago de cuenta a pagar (se anula por su flujo).
  if exists (select 1 from public.pagos_cuenta where egreso_id = p_egreso_id) then
    raise exception 'Este egreso corresponde al pago de una cuenta a pagar; anulá el pago desde su flujo.';
  end if;

  -- Si debitó una cuenta, reponer el saldo con un movimiento inverso.
  if v_egreso.cuenta_id is not null then
    select saldo_actual into v_saldo from public.cuentas where id = v_egreso.cuenta_id for update;
    if v_saldo is not null then
      v_saldo_nuevo := v_saldo + v_egreso.monto;
      insert into public.movimientos_cuenta (
        cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo,
        descripcion, categoria, referencia_tipo, referencia_id, usuario_id, fecha
      ) values (
        v_egreso.cuenta_id, 'ingreso', v_egreso.monto, v_saldo, v_saldo_nuevo,
        'Anulación egreso #' || p_egreso_id, v_egreso.categoria, 'egreso', p_egreso_id,
        p_usuario_id, current_date
      );
      update public.cuentas
        set saldo_actual = v_saldo_nuevo, updated_at = now()
        where id = v_egreso.cuenta_id;
    end if;
  end if;

  -- Reversa del asiento del egreso (CASCADE de asientos_items).
  delete from public.asientos where origen = 'egreso' and referencia_id = p_egreso_id;

  delete from public.egresos where id = p_egreso_id;

  perform public.fn_auditar(
    p_usuario_id, 'anular_egreso', 'egreso', p_egreso_id,
    jsonb_build_object('monto', v_egreso.monto, 'cuenta_id', v_egreso.cuenta_id)
  );
end;
$$;

revoke execute on function public.fn_anular_egreso(integer, uuid) from anon;
grant execute on function public.fn_anular_egreso(integer, uuid) to authenticated;

notify pgrst, 'reload schema';
