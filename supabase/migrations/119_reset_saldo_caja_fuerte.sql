-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 119 · RESET DEL SALDO DE LA CAJA FUERTE                  ║
-- ║                                                                     ║
-- ║  Lleva cuentas."Caja Efectivo".saldo_actual del acumulador          ║
-- ║  histórico de ventas al valor REAL del circuito de conteo:          ║
-- ║    target = Σ arqueos.monto_fisico                                  ║
-- ║           + Σ movimientos_caja_fuerte (ingreso − egreso)            ║
-- ║           − Σ remesas.monto                                         ║
-- ║  Deja un movimientos_cuenta tipo 'ajuste' de rastro + auditoría.    ║
-- ║                                                                     ║
-- ║  ⚠️ Correr INMEDIATAMENTE después de la 118, sin operar en el medio. ║
-- ║  IDEMPOTENTE: el target es absoluto y el ajuste de rastro no entra  ║
-- ║  en la fórmula → re-correrla da delta 0 y no hace nada.             ║
-- ╚════════════════════════════════════════════════════════════════════╝

do $$
declare
  v_cuenta integer;
  v_actual numeric;
  v_target numeric;
  v_delta numeric;
  v_usuario uuid;
begin
  select id, saldo_actual into v_cuenta, v_actual
    from public.cuentas where es_caja_fuerte for update;
  if v_cuenta is null then
    raise exception 'No hay cuenta marcada como Caja Fuerte. Corré la migración 118 primero.';
  end if;

  select
    coalesce((select sum(monto_fisico) from public.arqueos_tesoreria), 0)
    + coalesce((select sum(case when tipo = 'ingreso' then monto else -monto end)
                from public.movimientos_caja_fuerte), 0)
    - coalesce((select sum(monto) from public.remesas), 0)
  into v_target;
  v_target := round(v_target, 2);
  v_delta := round(v_target - v_actual, 2);

  if v_delta = 0 then
    raise notice 'El saldo ya está en el valor objetivo (%). Nada que hacer.', v_target;
    return;
  end if;

  -- Usuario para el rastro: el del rol administración (el owner). Fallback: cualquiera.
  select id into v_usuario from public.usuarios
    where rol ilike 'administraci%' order by created_at limit 1;
  if v_usuario is null then
    select id into v_usuario from public.usuarios order by created_at limit 1;
  end if;

  insert into public.movimientos_cuenta (
    cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo,
    descripcion, categoria, referencia_tipo, usuario_id, fecha
  ) values (
    v_cuenta, 'ajuste', abs(v_delta), v_actual, v_target,
    'Reset candado caja fuerte: saldo llevado al efectivo verificado (arqueos + manuales − remesas)',
    'ajuste', 'reset_candado', v_usuario,
    (now() at time zone 'America/Argentina/La_Rioja')::date
  );

  update public.cuentas set saldo_actual = v_target, updated_at = now() where id = v_cuenta;

  perform public.fn_auditar(v_usuario, 'reset_candado_caja_fuerte', 'cuenta', v_cuenta,
    jsonb_build_object('saldo_anterior', v_actual, 'saldo_nuevo', v_target, 'delta', v_delta));

  raise notice 'Caja fuerte reseteada: % → % (delta %).', v_actual, v_target, v_delta;
end $$;

notify pgrst, 'reload schema';
