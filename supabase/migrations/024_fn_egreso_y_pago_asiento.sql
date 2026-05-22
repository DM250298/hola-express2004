-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 024 · FASE 1 — Asientos automáticos de gastos y pagos    ║
-- ║                                                                     ║
-- ║  · fn_crear_egreso  → registra el gasto + su asiento                ║
-- ║      Debe (cuenta del gasto según categoría) / Haber Caja           ║
-- ║  · fn_pagar_cuenta  → marca pagada la cuenta y genera el egreso     ║
-- ║      del pago (Debe Proveedores / Haber Caja).                      ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─── Crear egreso + asiento ─────────────────────────────────────────
create or replace function public.fn_crear_egreso(
  p_descripcion text,
  p_monto numeric,
  p_categoria text,
  p_fecha date,
  p_usuario_id uuid,
  p_turno_id integer
) returns public.egresos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_egreso public.egresos;
  v_asiento_id integer;
  v_cta_debe integer;
  v_cta_caja integer;
  v_fecha date := coalesce(p_fecha, current_date);
begin
  insert into public.egresos (
    descripcion, monto, categoria, fecha, usuario_id, turno_id
  ) values (
    p_descripcion, p_monto, p_categoria, v_fecha, p_usuario_id, p_turno_id
  )
  returning * into v_egreso;

  -- Cuenta contable según la categoría del gasto
  v_cta_debe := case p_categoria
    when 'alquiler' then (select id from public.plan_cuentas where codigo = '5.2.03')
    when 'servicios' then (select id from public.plan_cuentas where codigo = '5.2.04')
    when 'sueldos' then (select id from public.plan_cuentas where codigo = '5.2.01')
    when 'mantenimiento' then (select id from public.plan_cuentas where codigo = '5.2.05')
    when 'impuestos' then (select id from public.plan_cuentas where codigo = '5.2.06')
    when 'pago_proveedores' then (select id from public.plan_cuentas where codigo = '2.1.01')
    else (select id from public.plan_cuentas where codigo = '5.2.09')
  end;
  select id into v_cta_caja from public.plan_cuentas where codigo = '1.1.01';

  if p_monto > 0 and v_cta_debe is not null and v_cta_caja is not null then
    insert into public.asientos (fecha, descripcion, tipo, origen, referencia_id, usuario_id)
    values (v_fecha, p_descripcion, 'automatico', 'egreso', v_egreso.id, p_usuario_id)
    returning id into v_asiento_id;
    insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
    values (v_asiento_id, v_cta_debe, p_monto, 0, 0);
    insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
    values (v_asiento_id, v_cta_caja, 0, p_monto, 1);
  end if;

  return v_egreso;
end;
$$;

-- ─── Pagar una cuenta a pagar ───────────────────────────────────────
create or replace function public.fn_pagar_cuenta(
  p_cuenta_id integer,
  p_usuario_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_monto numeric;
  v_pedido_id integer;
  v_estado text;
  v_proveedor text;
  v_hoy date := current_date;
begin
  select c.monto, c.pedido_id, c.estado, p.nombre
    into v_monto, v_pedido_id, v_estado, v_proveedor
    from public.cuentas_a_pagar c
    left join public.proveedores p on p.id = c.proveedor_id
    where c.id = p_cuenta_id;
  if v_monto is null then
    raise exception 'La cuenta no existe.';
  end if;
  if v_estado = 'pagada' then
    raise exception 'Esta cuenta ya está pagada.';
  end if;

  update public.cuentas_a_pagar
    set estado = 'pagada', fecha_pago = v_hoy
    where id = p_cuenta_id;

  -- El egreso del pago genera su propio asiento (Debe Proveedores / Haber Caja)
  perform public.fn_crear_egreso(
    'Pago a ' || coalesce(v_proveedor, 'proveedor') ||
      ' (pedido #' || v_pedido_id || ')',
    v_monto, 'pago_proveedores', v_hoy, p_usuario_id, null
  );
end;
$$;

notify pgrst, 'reload schema';
