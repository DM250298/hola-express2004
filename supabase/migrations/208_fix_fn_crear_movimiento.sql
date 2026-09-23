-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 208 · fn_crear_movimiento: cast del enum + guardas       ║
-- ║                                                                     ║
-- ║  Bug de producción: "Nuevo movimiento" (Finanzas › Cuentas) falla   ║
-- ║  con "column tipo is of type tipo_movimiento_cuenta but expression  ║
-- ║  is of type text". La 019 insertaba p_tipo (text) directo en la     ║
-- ║  columna enum: Postgres no convierte text→enum sin cast explícito   ║
-- ║  (mismo bug que arregló la 101 en fn_anular_venta). Fallaba TODO    ║
-- ║  ingreso/egreso manual, en cualquier cuenta. Las transferencias     ║
-- ║  andaban porque insertan literales.                                 ║
-- ║                                                                     ║
-- ║  v2 (misma firma → CREATE OR REPLACE limpio):                       ║
-- ║   · p_tipo::public.tipo_movimiento_cuenta                           ║
-- ║   · valida el tipo (ingreso / egreso / ajuste)                      ║
-- ║   · permiso 'finanzas'                                              ║
-- ║   · guarda de período cerrado (fn_periodo_cerrado)                  ║
-- ║   · rechaza la bóveda: la Caja Efectivo se mueve SOLO por           ║
-- ║     fn_registrar_mov_caja_fuerte (sino dispara el descuadre)        ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO. Última línea: notify pgrst.       ║
-- ╚════════════════════════════════════════════════════════════════════╝

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
  v_monto numeric := round(p_monto, 2);
  v_fecha date := coalesce(p_fecha, (now() at time zone 'America/Argentina/La_Rioja')::date);
  v_es_boveda boolean;
  v_mov public.movimientos_cuenta;
begin
  if not (select public.fn_tiene_permiso('finanzas')) then
    raise exception 'No tenés permiso para registrar movimientos de cuenta.';
  end if;
  if p_tipo is null or p_tipo not in ('ingreso', 'egreso', 'ajuste') then
    raise exception 'Tipo inválido: %. Debe ser ingreso, egreso o ajuste.', p_tipo;
  end if;
  if v_monto is null or v_monto <= 0 then
    raise exception 'El monto debe ser mayor a 0.';
  end if;
  if public.fn_periodo_cerrado(v_fecha) then
    raise exception 'El período de % está cerrado: no se pueden registrar movimientos.', to_char(v_fecha, 'MM/YYYY');
  end if;

  select saldo_actual, coalesce(es_caja_fuerte, false)
    into v_saldo, v_es_boveda
    from public.cuentas where id = p_cuenta_id for update;
  if v_saldo is null then
    raise exception 'La cuenta no existe.';
  end if;
  if v_es_boveda then
    raise exception 'La Caja Efectivo es la caja fuerte: registrá el movimiento desde Finanzas › Caja fuerte.';
  end if;

  v_saldo_nuevo := case
    when p_tipo = 'egreso' then v_saldo - v_monto
    else v_saldo + v_monto
  end;

  insert into public.movimientos_cuenta (
    cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo,
    descripcion, categoria, usuario_id, fecha, referencia_tipo
  ) values (
    p_cuenta_id, p_tipo::public.tipo_movimiento_cuenta, v_monto, v_saldo, v_saldo_nuevo,
    p_descripcion, p_categoria, p_usuario_id, v_fecha, 'manual'
  )
  returning * into v_mov;

  update public.cuentas
    set saldo_actual = v_saldo_nuevo, updated_at = now()
    where id = p_cuenta_id;

  return v_mov;
end;
$$;

revoke execute on function public.fn_crear_movimiento(integer, text, numeric, text, text, date, uuid) from anon;
grant execute on function public.fn_crear_movimiento(integer, text, numeric, text, text, date, uuid) to authenticated;

-- Verificación (debe devolver 1 fila, y el T1 de duplicadas 0 filas):
--   select to_regprocedure('public.fn_crear_movimiento(integer,text,numeric,text,text,date,uuid)');
--   select proname, count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname = 'public' and proname like 'fn_%' group by proname having count(*) > 1;

notify pgrst, 'reload schema';
