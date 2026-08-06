-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 142 · Adelantos con plata real + fix Anticipos (1.1.10)  ║
-- ║                                                                     ║
-- ║  PROBLEMA 1: el adelanto de sueldo es solo un renglón de descuento  ║
-- ║  (novedades_empleado.tipo='adelanto'): no sale plata de ninguna     ║
-- ║  cuenta, no hay movimiento de tesorería ni asiento.                 ║
-- ║                                                                     ║
-- ║  PROBLEMA 2 (bug contable preexistente): el código 1.1.07 está      ║
-- ║  DUPLICADO. La 063 lo creó como "Percepciones IVA a favor" y el     ║
-- ║  insert de la 090 ("Anticipos al Personal", on conflict do nothing) ║
-- ║  fue un no-op → fn_confirmar_liquidacion acredita hoy los           ║
-- ║  descuentos contra la cuenta de percepciones. Además manda TODO     ║
-- ║  total_descuentos a una sola cuenta: con el fiado del POS (mig 140  ║
-- ║  debita 1.1.03 Deudores por Ventas), el consumo de cta. cte. del    ║
-- ║  empleado nunca cancelaría 1.1.03 y quedaría inflada para siempre.  ║
-- ║                                                                     ║
-- ║  SOLUCIÓN:                                                          ║
-- ║   1. Cuenta nueva 1.1.10 'Anticipos al Personal' (1.1.07 queda      ║
-- ║      solo para percepciones)                                        ║
-- ║   2. novedades_empleado: + fecha, cuenta_id, movimiento_id,         ║
-- ║      asiento_id (trazabilidad del adelanto)                         ║
-- ║   3. fn_registrar_adelanto — debita la cuenta de tesorería elegida  ║
-- ║      + movimiento categoría 'adelanto_sueldo' + asiento DEBE 1.1.10 ║
-- ║      / HABER Caja-Banco. NO usa fn_crear_egreso: el adelanto es un  ║
-- ║      ACTIVO (anticipo), no un gasto — un egreso 5.2.01 duplicaría   ║
-- ║      el costo laboral que fn_confirmar_liquidacion devenga después. ║
-- ║      fn_generar_liquidacion NO cambia: ya suma tipo='adelanto'.     ║
-- ║   4. fn_anular_adelanto — repone saldo + borra asiento y novedad    ║
-- ║   5. fn_confirmar_liquidacion v2 — HABER partido:                   ║
-- ║      renglones 'ctacte' → 1.1.03 (cancela el fiado del POS)         ║
-- ║      'adelanto' + 'descuento' → 1.1.10 (cancela los anticipos)      ║
-- ║   6. Reimputación del histórico: asientos de liquidación que        ║
-- ║      tocaron 1.1.07 pasan a 1.1.10 (limpia percepciones)            ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─── 1. Cuenta 1.1.10 Anticipos al Personal ──────────────────────────
insert into public.plan_cuentas (codigo, nombre, tipo, imputable) values
  ('1.1.10', 'Anticipos al Personal', 'activo', true)
on conflict (codigo) do nothing;

-- ─── 2. Trazabilidad del adelanto en novedades_empleado ──────────────
alter table public.novedades_empleado
  add column if not exists fecha         date not null default current_date,
  add column if not exists cuenta_id     integer references public.cuentas(id),
  add column if not exists movimiento_id integer,
  add column if not exists asiento_id    integer references public.asientos(id) on delete set null;

comment on column public.novedades_empleado.cuenta_id is
  'Cuenta de tesorería debitada si el adelanto salió con plata real (fn_registrar_adelanto). NULL = novedad contable pura.';

-- ─── 3. Registrar un adelanto con egreso real ────────────────────────
create or replace function public.fn_registrar_adelanto(
  p_empleado_id integer,
  p_periodo     text,
  p_monto       numeric,
  p_cuenta_id   integer,
  p_usuario_id  uuid,
  p_fecha       date default null,
  p_concepto    text default null
) returns public.novedades_empleado
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fecha date := coalesce(p_fecha, current_date);
  v_nov public.novedades_empleado;
  v_nombre text;
  v_tipo_cuenta text; v_es_boveda boolean; v_saldo numeric; v_saldo_nuevo numeric;
  v_mov_id integer; v_asiento_id integer;
  v_cta_anticipos integer; v_cta_haber integer;
begin
  if not (select public.fn_tiene_permiso('rrhh_sueldos')) then
    raise exception 'Sin permiso para registrar adelantos de sueldo.';
  end if;
  if p_periodo is null or p_periodo !~ '^\d{4}-\d{2}$' then
    raise exception 'Período inválido (formato YYYY-MM): %', coalesce(p_periodo, '(null)');
  end if;
  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto del adelanto debe ser mayor a 0.';
  end if;
  if public.fn_periodo_cerrado(v_fecha) then
    raise exception 'El período contable de esa fecha está cerrado.';
  end if;
  -- Si la liquidación del período ya está confirmada, el adelanto no se
  -- descontaría nunca del recibo → plata afuera para siempre. Se corta acá.
  if exists (
    select 1 from public.liquidacion_lote
    where periodo = p_periodo and estado <> 'borrador'
  ) then
    raise exception
      'La liquidación de % ya está confirmada; el adelanto no se podría descontar del recibo.',
      p_periodo;
  end if;

  select btrim(coalesce(nombre, '') || ' ' || coalesce(apellido, '')) into v_nombre
    from public.empleados where id = p_empleado_id;
  if v_nombre is null then raise exception 'El empleado no existe.'; end if;

  select tipo, coalesce(es_caja_fuerte, false), saldo_actual
    into v_tipo_cuenta, v_es_boveda, v_saldo
    from public.cuentas where id = p_cuenta_id for update;
  if v_saldo is null then raise exception 'La cuenta de origen del adelanto no existe.'; end if;
  v_saldo_nuevo := v_saldo - p_monto;
  -- Guard de negativo SOLO para la bóveda (idéntico a fn_crear_egreso v2).
  if v_es_boveda and v_saldo_nuevo < 0 then
    raise exception 'El adelanto deja la caja fuerte en negativo (saldo actual %).', v_saldo;
  end if;

  select id into v_cta_anticipos from public.plan_cuentas where codigo = '1.1.10';
  if v_cta_anticipos is null then
    raise exception 'Falta la cuenta 1.1.10 Anticipos al Personal en el plan.';
  end if;
  v_cta_haber := case v_tipo_cuenta
    when 'caja' then (select id from public.plan_cuentas where codigo = '1.1.01')
    else (select id from public.plan_cuentas where codigo = '1.1.02')
  end;

  insert into public.novedades_empleado
    (empleado_id, periodo, tipo, concepto, monto, fecha, cuenta_id, usuario_id)
  values (p_empleado_id, p_periodo, 'adelanto',
          coalesce(nullif(btrim(p_concepto), ''), 'Adelanto de sueldo ' || p_periodo),
          p_monto, v_fecha, p_cuenta_id, p_usuario_id)
  returning * into v_nov;

  insert into public.movimientos_cuenta (
    cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo,
    descripcion, categoria, referencia_tipo, referencia_id, usuario_id, fecha
  ) values (
    p_cuenta_id, 'egreso', p_monto, v_saldo, v_saldo_nuevo,
    'Adelanto de sueldo · ' || v_nombre, 'adelanto_sueldo', 'novedad', v_nov.id,
    p_usuario_id, v_fecha
  ) returning id into v_mov_id;
  update public.cuentas set saldo_actual = v_saldo_nuevo, updated_at = now()
    where id = p_cuenta_id;

  -- Asiento: DEBE Anticipos al Personal (activo, NO gasto — el gasto lo
  -- devenga fn_confirmar_liquidacion sobre el remunerativo completo, y su
  -- HABER a 1.1.10 cancela exactamente este DEBE) / HABER Caja o Bancos.
  insert into public.asientos (fecha, descripcion, tipo, origen, referencia_id, usuario_id)
  values (v_fecha, 'Adelanto de sueldo · ' || v_nombre, 'automatico', 'adelanto',
          v_nov.id, p_usuario_id)
  returning id into v_asiento_id;
  insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
  values (v_asiento_id, v_cta_anticipos, p_monto, 0, 0);
  insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
  values (v_asiento_id, v_cta_haber, 0, p_monto, 1);

  update public.novedades_empleado
    set movimiento_id = v_mov_id, asiento_id = v_asiento_id
    where id = v_nov.id
    returning * into v_nov;

  return v_nov;
end $$;

revoke execute on function public.fn_registrar_adelanto(integer, text, numeric, integer, uuid, date, text) from anon;
grant  execute on function public.fn_registrar_adelanto(integer, text, numeric, integer, uuid, date, text) to authenticated;

-- ─── 4. Anular un adelanto (repone la plata) ─────────────────────────
create or replace function public.fn_anular_adelanto(
  p_novedad_id integer,
  p_usuario_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nov public.novedades_empleado;
  v_saldo numeric; v_saldo_nuevo numeric;
begin
  if not (select public.fn_tiene_permiso('rrhh_sueldos')) then
    raise exception 'Sin permiso para anular adelantos.';
  end if;

  select * into v_nov from public.novedades_empleado where id = p_novedad_id;
  if v_nov.id is null then raise exception 'La novedad no existe.'; end if;
  if v_nov.tipo <> 'adelanto' then
    raise exception 'Solo se anulan adelantos por acá; las demás novedades se borran directo.';
  end if;
  if exists (
    select 1 from public.liquidacion_lote
    where periodo = v_nov.periodo and estado <> 'borrador'
  ) then
    raise exception
      'La liquidación de % ya está confirmada; el adelanto ya se descontó del recibo.',
      v_nov.periodo;
  end if;
  if public.fn_periodo_cerrado(current_date) then
    raise exception 'El período contable actual está cerrado.';
  end if;

  -- Si salió plata real, reponerla con un movimiento inverso.
  if v_nov.cuenta_id is not null then
    select saldo_actual into v_saldo from public.cuentas
      where id = v_nov.cuenta_id for update;
    if v_saldo is not null then
      v_saldo_nuevo := v_saldo + v_nov.monto;
      insert into public.movimientos_cuenta (
        cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo,
        descripcion, categoria, referencia_tipo, referencia_id, usuario_id, fecha
      ) values (
        v_nov.cuenta_id, 'ingreso', v_nov.monto, v_saldo, v_saldo_nuevo,
        'Anulación adelanto #' || p_novedad_id, 'adelanto_sueldo', 'novedad',
        p_novedad_id, p_usuario_id, current_date
      );
      update public.cuentas set saldo_actual = v_saldo_nuevo, updated_at = now()
        where id = v_nov.cuenta_id;
    end if;
  end if;

  delete from public.asientos where origen = 'adelanto' and referencia_id = p_novedad_id;
  delete from public.novedades_empleado where id = p_novedad_id;

  perform public.fn_auditar(p_usuario_id, 'anular_adelanto', 'novedad', p_novedad_id,
    jsonb_build_object('monto', v_nov.monto, 'cuenta_id', v_nov.cuenta_id));
end $$;

revoke execute on function public.fn_anular_adelanto(integer, uuid) from anon;
grant  execute on function public.fn_anular_adelanto(integer, uuid) to authenticated;

-- ─── 5. fn_confirmar_liquidacion v2 · base 090 ÍNTEGRA + split HABER ─
-- Misma firma → create or replace limpio.
create or replace function public.fn_confirmar_liquidacion(
  p_lote_id integer,
  p_usuario_id uuid
) returns public.liquidacion_lote
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lote public.liquidacion_lote;
  v_fecha_asiento date;
  v_asiento_id integer;
  v_cta_sueldos integer;   -- 5.2.01 Sueldos y Jornales (egreso)
  v_cta_apagar integer;    -- 2.1.03 Sueldos a Pagar (pasivo)
  v_cta_anticipos integer; -- 1.1.10 Anticipos al Personal (activo) — v2
  v_cta_deudores integer;  -- 1.1.03 Deudores por Ventas (fiado del POS) — v2
  v_desc_ctacte numeric;   -- v2: descuentos por consumo de cta. cte.
  v_desc_anticipos numeric; -- v2: adelantos + otros descuentos
  v_orden integer := 0;
begin
  if not public.fn_tiene_permiso('rrhh_sueldos') then
    raise exception 'Sin permiso para liquidar sueldos.';
  end if;

  select * into v_lote from public.liquidacion_lote where id = p_lote_id;
  if v_lote.id is null then
    raise exception 'La liquidación no existe.';
  end if;
  if v_lote.estado <> 'borrador' then
    raise exception 'La liquidación ya fue confirmada.';
  end if;
  -- Defensa: con el tope de cta.cte. el neto del lote nunca debería ser
  -- negativo; si lo fuera, no devengar (evita un HABER negativo en 2.1.03).
  if v_lote.total_neto < 0 then
    raise exception 'El neto total es negativo; revisá adelantos/descuentos antes de confirmar.';
  end if;

  -- El costo laboral se devenga en el MES LIQUIDADO, no en "hoy": el asiento se
  -- fecha el último día del período (capado a hoy si se pre-liquida). Así el
  -- candado de cierre se evalúa sobre ESE mes, igual que fn_anular_venta /
  -- fn_guardar_factura_compra.
  v_fecha_asiento := least(
    ((v_lote.periodo || '-01')::date + interval '1 month' - interval '1 day')::date,
    current_date
  );
  if public.fn_periodo_cerrado(v_fecha_asiento) then
    raise exception 'El período contable % está cerrado; no se puede confirmar.',
      to_char(v_fecha_asiento, 'YYYY-MM');
  end if;

  select id into v_cta_sueldos   from public.plan_cuentas where codigo = '5.2.01';
  select id into v_cta_apagar    from public.plan_cuentas where codigo = '2.1.03';
  select id into v_cta_anticipos from public.plan_cuentas where codigo = '1.1.10';  -- v2
  select id into v_cta_deudores  from public.plan_cuentas where codigo = '1.1.03';  -- v2

  -- v2: split de los descuentos por origen contable. El consumo de cta. cte.
  -- ('ctacte') cancela 1.1.03 Deudores por Ventas (lo que debitó el fiado del
  -- POS); adelantos y otros descuentos cancelan 1.1.10 Anticipos al Personal
  -- (lo que debitó fn_registrar_adelanto). Suman total_descuentos por
  -- construcción → el asiento sigue balanceado (debe = haber = remunerativo).
  select
    coalesce(sum(r.monto) filter (where r.codigo = 'ctacte'), 0),
    coalesce(sum(r.monto) filter (where r.clase = 'descuento' and r.codigo <> 'ctacte'), 0)
    into v_desc_ctacte, v_desc_anticipos
  from public.liquidacion_renglon r
  join public.liquidacion_recibo rec on rec.id = r.recibo_id
  where rec.lote_id = v_lote.id;

  if v_lote.total_remunerativo > 0 then
    -- Fail-loud: una liquidación no se marca confirmada sin contrapartida
    -- contable real (las cuentas son de sistema, deberían existir siempre).
    if v_cta_sueldos is null or v_cta_apagar is null then
      raise exception 'Faltan cuentas del plan (5.2.01 / 2.1.03); no se puede devengar.';
    end if;
    if v_desc_anticipos > 0 and v_cta_anticipos is null then
      raise exception 'Falta la cuenta 1.1.10 Anticipos al Personal.';
    end if;
    if v_desc_ctacte > 0 and v_cta_deudores is null then
      raise exception 'Falta la cuenta 1.1.03 Deudores por Ventas.';
    end if;

    insert into public.asientos (fecha, descripcion, tipo, origen, referencia_id, usuario_id)
    values (
      v_fecha_asiento, 'Sueldos ' || v_lote.periodo,
      'automatico', 'liquidacion', v_lote.id, p_usuario_id
    )
    returning id into v_asiento_id;

    -- DEBE Sueldos y Jornales = remunerativo (el costo laboral del mes).
    insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
    values (v_asiento_id, v_cta_sueldos, v_lote.total_remunerativo, 0, v_orden);
    v_orden := v_orden + 1;

    -- HABER Sueldos a Pagar = neto (lo que se le debe al empleado).
    insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
    values (v_asiento_id, v_cta_apagar, 0, v_lote.total_neto, v_orden);
    v_orden := v_orden + 1;

    -- v2: HABER Anticipos al Personal = adelantos + otros descuentos.
    if v_desc_anticipos > 0 then
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_anticipos, 0, v_desc_anticipos, v_orden);
      v_orden := v_orden + 1;
    end if;

    -- v2: HABER Deudores por Ventas = consumo de cta. cte. descontado.
    if v_desc_ctacte > 0 then
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_deudores, 0, v_desc_ctacte, v_orden);
    end if;
  end if;

  update public.liquidacion_lote
    set estado = 'confirmada', confirmada_at = now(), asiento_id = v_asiento_id
    where id = v_lote.id
    returning * into v_lote;

  return v_lote;
end $$;

grant execute on function public.fn_confirmar_liquidacion(integer, uuid) to authenticated;

-- ─── 6. Reimputación del histórico: 1.1.07 → 1.1.10 en liquidaciones ─
-- Los asientos de liquidación viejos acreditaron por error la cuenta de
-- percepciones (bug del código duplicado). Se mueven a 1.1.10 sin tocar
-- los asientos de compra (que usan 1.1.07 legítimamente).
do $$
declare
  v_perc integer := (select id from public.plan_cuentas where codigo = '1.1.07');
  v_anti integer := (select id from public.plan_cuentas where codigo = '1.1.10');
  v_n integer;
begin
  if v_perc is null or v_anti is null then
    raise notice 'Reimputación 1.1.07→1.1.10 salteada (falta alguna cuenta).';
    return;
  end if;
  update public.asientos_items ai
     set cuenta_id = v_anti
   where ai.cuenta_id = v_perc
     and ai.asiento_id in (
       select id from public.asientos where origen = 'liquidacion'
     );
  get diagnostics v_n = row_count;
  raise notice 'Reimputados % renglones de asientos de liquidación de 1.1.07 a 1.1.10.', v_n;
end $$;

notify pgrst, 'reload schema';
