-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 019 · FASE 0 — Operaciones atómicas: movimientos cuenta  ║
-- ║                                                                     ║
-- ║  · fn_crear_movimiento    → ingreso / egreso / ajuste de cuenta     ║
-- ║  · fn_crear_transferencia → transferencia entre dos cuentas         ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─── Movimiento de cuenta (ingreso / egreso / ajuste) ───────────────
create or replace function public.fn_crear_movimiento(
  p_cuenta_id integer,
  p_tipo text,
  p_monto numeric,
  p_descripcion text,
  p_categoria text,
  p_fecha date,
  p_usuario_id uuid
) returns public.movimientos_cuenta
language plpgsql
security definer
set search_path = public
as $$
declare
  v_saldo numeric;
  v_saldo_nuevo numeric;
  v_mov public.movimientos_cuenta;
begin
  if p_monto <= 0 then
    raise exception 'El monto debe ser mayor a 0.';
  end if;

  select saldo_actual into v_saldo
    from public.cuentas where id = p_cuenta_id for update;
  if v_saldo is null then
    raise exception 'La cuenta no existe.';
  end if;

  v_saldo_nuevo := case
    when p_tipo = 'egreso' then v_saldo - p_monto
    else v_saldo + p_monto
  end;

  insert into public.movimientos_cuenta (
    cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo,
    descripcion, categoria, usuario_id, fecha, referencia_tipo
  ) values (
    p_cuenta_id, p_tipo, p_monto, v_saldo, v_saldo_nuevo,
    p_descripcion, p_categoria, p_usuario_id,
    coalesce(p_fecha, current_date), 'manual'
  )
  returning * into v_mov;

  update public.cuentas
    set saldo_actual = v_saldo_nuevo, updated_at = now()
    where id = p_cuenta_id;

  return v_mov;
end;
$$;

-- ─── Transferencia entre cuentas ────────────────────────────────────
create or replace function public.fn_crear_transferencia(
  p_origen_id integer,
  p_destino_id integer,
  p_monto numeric,
  p_descripcion text,
  p_fecha date,
  p_usuario_id uuid
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_transf_id text := gen_random_uuid()::text;
  v_saldo_o numeric;
  v_saldo_d numeric;
  v_nombre_o text;
  v_nombre_d text;
  v_fecha date := coalesce(p_fecha, current_date);
begin
  if p_monto <= 0 then
    raise exception 'El monto debe ser mayor a 0.';
  end if;
  if p_origen_id = p_destino_id then
    raise exception 'La cuenta origen y destino deben ser distintas.';
  end if;

  select saldo_actual, nombre into v_saldo_o, v_nombre_o
    from public.cuentas where id = p_origen_id for update;
  select saldo_actual, nombre into v_saldo_d, v_nombre_d
    from public.cuentas where id = p_destino_id for update;
  if v_saldo_o is null or v_saldo_d is null then
    raise exception 'No se encontró alguna de las cuentas.';
  end if;

  insert into public.movimientos_cuenta (
    cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo,
    descripcion, categoria, contraparte_cuenta_id,
    referencia_tipo, transferencia_id, usuario_id, fecha
  ) values (
    p_origen_id, 'transferencia_salida', p_monto,
    v_saldo_o, v_saldo_o - p_monto,
    coalesce(nullif(p_descripcion, ''), 'Transferencia a ' || v_nombre_d),
    'transferencia', p_destino_id,
    'transferencia', v_transf_id, p_usuario_id, v_fecha
  );

  insert into public.movimientos_cuenta (
    cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo,
    descripcion, categoria, contraparte_cuenta_id,
    referencia_tipo, transferencia_id, usuario_id, fecha
  ) values (
    p_destino_id, 'transferencia_entrada', p_monto,
    v_saldo_d, v_saldo_d + p_monto,
    coalesce(nullif(p_descripcion, ''), 'Transferencia desde ' || v_nombre_o),
    'transferencia', p_origen_id,
    'transferencia', v_transf_id, p_usuario_id, v_fecha
  );

  update public.cuentas
    set saldo_actual = v_saldo_o - p_monto, updated_at = now()
    where id = p_origen_id;
  update public.cuentas
    set saldo_actual = v_saldo_d + p_monto, updated_at = now()
    where id = p_destino_id;

  return v_transf_id;
end;
$$;

notify pgrst, 'reload schema';
