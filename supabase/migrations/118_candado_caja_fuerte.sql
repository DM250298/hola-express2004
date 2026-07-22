-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 118 · CANDADO DE LA CAJA FUERTE                          ║
-- ║                                                                     ║
-- ║  La cuenta "Caja Efectivo" pasa a SER la caja fuerte (bóveda):      ║
-- ║  el dinero entra SOLO cuando el administrativo valida el arqueo,    ║
-- ║  nunca directo desde la venta.                                      ║
-- ║                                                                     ║
-- ║  Flujo: venta → caja POS → cierre (control cajero) → buzón →        ║
-- ║         control administrativo (arqueo) → Caja Efectivo.            ║
-- ║                                                                     ║
-- ║  · cuentas.es_caja_fuerte + índice único (a lo sumo una bóveda)     ║
-- ║  · fn_cuenta_caja_fuerte() → resuelve la bóveda con guarda 0/>1     ║
-- ║  · medios_pago.acredita_en_venta + trigger guardia: el medio        ║
-- ║    'efectivo' queda con cuenta_id NULL → fn_crear_venta lo saltea   ║
-- ║    (rama `if v_cuenta_id is null then continue`) SIN tocarla        ║
-- ║  · fn_validar_arqueo v3   → acredita la bóveda con monto_fisico     ║
-- ║  · fn_generar_remesa v3   → transferencia real bóveda→banco         ║
-- ║  · fn_registrar_mov_caja_fuerte v2 → mueve también la cuenta        ║
-- ║                                                                     ║
-- ║  ⚠️ Correr la 119 (reset del saldo) INMEDIATAMENTE después,          ║
-- ║  sin operar ventas/arqueos/egresos en el medio.                     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─── 1. Columnas nuevas ──────────────────────────────────────────────
alter table public.cuentas
  add column if not exists es_caja_fuerte boolean not null default false;

alter table public.medios_pago
  add column if not exists acredita_en_venta boolean not null default true;

-- ─── 2. Marcar la bóveda (la "Caja Efectivo" del seed) ───────────────
update public.cuentas set es_caja_fuerte = true
  where id = (select id from public.cuentas where nombre = 'Caja Efectivo' order by id limit 1)
    and not exists (select 1 from public.cuentas where es_caja_fuerte);

-- A lo sumo UNA cuenta puede ser la bóveda.
create unique index if not exists cuentas_una_caja_fuerte
  on public.cuentas ((true)) where es_caja_fuerte;

-- ─── 3. Resolver la bóveda con guarda ────────────────────────────────
create or replace function public.fn_cuenta_caja_fuerte()
returns integer language plpgsql stable security definer set search_path = public as $$
declare v_id integer; v_n integer;
begin
  select count(*), min(id) into v_n, v_id from public.cuentas where es_caja_fuerte;
  if v_n = 0 then
    raise exception 'No hay cuenta marcada como Caja Fuerte (cuentas.es_caja_fuerte).';
  elsif v_n > 1 then
    raise exception 'Hay % cuentas marcadas como Caja Fuerte; debe haber exactamente una.', v_n;
  end if;
  return v_id;
end $$;

revoke execute on function public.fn_cuenta_caja_fuerte() from anon;
grant execute on function public.fn_cuenta_caja_fuerte() to authenticated;

-- ─── 4. Trigger guardia: el efectivo NUNCA acredita en la venta ──────
-- Blindaje a nivel DB: aunque la UI (ModalMedioPago) intente re-setear
-- cuenta_id del medio 'efectivo', el trigger lo re-nulifica.
create or replace function public.fn_guard_medio_cuenta()
returns trigger language plpgsql as $$
begin
  if new.codigo = 'efectivo' or new.acredita_en_venta = false then
    new.acredita_en_venta := false;
    new.cuenta_id := null;   -- fn_crear_venta: `if v_cuenta_id is null then continue`
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_medio_cuenta on public.medios_pago;
create trigger trg_guard_medio_cuenta
  before insert or update on public.medios_pago
  for each row execute function public.fn_guard_medio_cuenta();

-- Activa el candado: el trigger nulifica cuenta_id en este update.
update public.medios_pago set acredita_en_venta = false where codigo = 'efectivo';

-- ─── 5. fn_validar_arqueo v3 — el control administrativo acredita ────
-- Firma idéntica a v2 (053) → CREATE OR REPLACE limpio.
-- Lo verificado (monto_fisico) entra RECIÉN ACÁ a la bóveda.
create or replace function public.fn_validar_arqueo(
  p_usuario_id uuid, p_sangria_ids integer[], p_monto_fisico numeric, p_nota text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_esperado numeric := 0; v_diferencia numeric; v_estado text;
  v_arqueo_id integer; v_arqueo_fecha date;
  v_cuenta_id integer; v_saldo numeric; v_saldo_nuevo numeric; v_monto numeric;
begin
  if p_sangria_ids is null or array_length(p_sangria_ids, 1) is null then
    raise exception 'Seleccioná al menos un sobre para arquear.';
  end if;
  select coalesce(sum(monto), 0) into v_esperado from public.sangrias
    where id = any(p_sangria_ids) and estado = 'en_buzon';
  v_diferencia := round(p_monto_fisico - v_esperado, 2);
  if v_diferencia <> 0 and (p_nota is null or btrim(p_nota) = '') then
    raise exception 'Hay una diferencia de %. Ingresá una nota de ajuste para validar el arqueo.', v_diferencia;
  end if;
  v_estado := case when v_diferencia = 0 then 'validado' else 'con_diferencia' end;

  insert into public.arqueos_tesoreria (usuario_id, monto_esperado, monto_fisico, diferencia, nota_ajuste, estado)
  values (p_usuario_id, v_esperado, p_monto_fisico, v_diferencia, nullif(btrim(coalesce(p_nota,'')),''), v_estado)
  returning id, fecha into v_arqueo_id, v_arqueo_fecha;

  update public.sangrias set estado = 'arqueada', arqueo_id = v_arqueo_id
    where id = any(p_sangria_ids) and estado = 'en_buzon';

  -- CANDADO: el efectivo verificado entra recién ahora a la bóveda.
  v_monto := round(p_monto_fisico, 2);
  if v_monto > 0 then
    v_cuenta_id := public.fn_cuenta_caja_fuerte();
    select saldo_actual into v_saldo from public.cuentas where id = v_cuenta_id for update;
    v_saldo_nuevo := v_saldo + v_monto;
    insert into public.movimientos_cuenta (
      cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo,
      descripcion, categoria, referencia_tipo, referencia_id, usuario_id, fecha
    ) values (
      v_cuenta_id, 'ingreso', v_monto, v_saldo, v_saldo_nuevo,
      'Arqueo #' || v_arqueo_id || ' · efectivo verificado a bóveda', 'arqueo',
      'arqueo', v_arqueo_id, p_usuario_id, v_arqueo_fecha
    );
    update public.cuentas set saldo_actual = v_saldo_nuevo, updated_at = now() where id = v_cuenta_id;
  end if;

  perform public.fn_auditar(p_usuario_id, 'arqueo', 'arqueo_tesoreria', v_arqueo_id,
    jsonb_build_object('esperado', v_esperado, 'fisico', p_monto_fisico, 'diferencia', v_diferencia));
  return jsonb_build_object('arqueo_id', v_arqueo_id, 'monto_esperado', v_esperado,
    'monto_fisico', p_monto_fisico, 'diferencia', v_diferencia, 'estado', v_estado);
end $$;

-- ─── 6. fn_generar_remesa v3 — transferencia real bóveda → banco ─────
-- Firma idéntica a v2 (053). Debita la bóveda y acredita el banco,
-- enlazados por transferencia_id (patrón de fn_crear_transferencia, 019).
create or replace function public.fn_generar_remesa(
  p_usuario_id uuid, p_cuenta_id integer, p_monto numeric, p_comprobante text, p_nota text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_boveda_id integer; v_transf_id text := gen_random_uuid()::text;
  v_saldo_bov numeric; v_saldo_bco numeric; v_nombre_bco text;
  v_mov_id integer; v_remesa_id integer;
  v_monto numeric := round(p_monto, 2);
  v_fecha date := (now() at time zone 'America/Argentina/La_Rioja')::date;
begin
  if v_monto is null or v_monto <= 0 then
    raise exception 'El monto de la remesa debe ser mayor a cero.';
  end if;
  v_boveda_id := public.fn_cuenta_caja_fuerte();
  if p_cuenta_id = v_boveda_id then
    raise exception 'La cuenta destino no puede ser la propia caja fuerte.';
  end if;

  -- Lock ordenado por id (evita deadlocks entre remesas concurrentes).
  if v_boveda_id < p_cuenta_id then
    select saldo_actual into v_saldo_bov from public.cuentas where id = v_boveda_id for update;
    select saldo_actual, nombre into v_saldo_bco, v_nombre_bco from public.cuentas where id = p_cuenta_id for update;
  else
    select saldo_actual, nombre into v_saldo_bco, v_nombre_bco from public.cuentas where id = p_cuenta_id for update;
    select saldo_actual into v_saldo_bov from public.cuentas where id = v_boveda_id for update;
  end if;
  if v_saldo_bco is null then raise exception 'La cuenta destino no existe.'; end if;
  if v_saldo_bov is null then raise exception 'La cuenta bóveda no existe.'; end if;
  if v_saldo_bov - v_monto < 0 then
    raise exception 'La caja fuerte no tiene saldo suficiente (disponible %).', v_saldo_bov;
  end if;

  -- Salida de la bóveda
  insert into public.movimientos_cuenta (
    cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo,
    descripcion, categoria, contraparte_cuenta_id, referencia_tipo, transferencia_id, usuario_id, fecha
  ) values (
    v_boveda_id, 'transferencia_salida', v_monto, v_saldo_bov, v_saldo_bov - v_monto,
    'Remesa / depósito a ' || v_nombre_bco, 'remesa', p_cuenta_id, 'remesa', v_transf_id, p_usuario_id, v_fecha
  );

  -- Entrada al banco
  insert into public.movimientos_cuenta (
    cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo,
    descripcion, categoria, contraparte_cuenta_id, referencia_tipo, transferencia_id, usuario_id, fecha
  ) values (
    p_cuenta_id, 'transferencia_entrada', v_monto, v_saldo_bco, v_saldo_bco + v_monto,
    'Remesa / depósito de caja fuerte', 'remesa', v_boveda_id, 'remesa', v_transf_id, p_usuario_id, v_fecha
  ) returning id into v_mov_id;

  update public.cuentas set saldo_actual = v_saldo_bov - v_monto, updated_at = now() where id = v_boveda_id;
  update public.cuentas set saldo_actual = v_saldo_bco + v_monto, updated_at = now() where id = p_cuenta_id;

  insert into public.remesas (usuario_id, cuenta_id, monto, comprobante, nota, movimiento_id)
  values (p_usuario_id, p_cuenta_id, v_monto,
    nullif(btrim(coalesce(p_comprobante,'')),''), nullif(btrim(coalesce(p_nota,'')),''), v_mov_id)
  returning id into v_remesa_id;

  perform public.fn_auditar(p_usuario_id, 'remesa', 'remesa', v_remesa_id,
    jsonb_build_object('monto', v_monto, 'cuenta_id', p_cuenta_id, 'boveda_id', v_boveda_id));
  return jsonb_build_object('remesa_id', v_remesa_id, 'movimiento_id', v_mov_id,
    'saldo_nuevo', v_saldo_bco + v_monto);
end $$;

-- ─── 7. fn_registrar_mov_caja_fuerte v2 — mueve también la cuenta ────
-- Firma idéntica a v1 (117). El guard de negativo ahora lee el saldo
-- REAL de la cuenta bóveda (FOR UPDATE), no la suma de tablas.
create or replace function public.fn_registrar_mov_caja_fuerte(
  p_usuario_id uuid,
  p_tipo       text,
  p_monto      numeric,
  p_nota       text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id integer;
  v_monto numeric := round(p_monto, 2);
  v_cuenta_id integer; v_saldo numeric; v_saldo_nuevo numeric;
begin
  if not (select public.fn_tiene_permiso('finanzas')) then
    raise exception 'No tenés permiso para mover la caja fuerte.';
  end if;
  if p_tipo is null or p_tipo not in ('ingreso','egreso') then
    raise exception 'Tipo inválido: %. Debe ser "ingreso" o "egreso".', p_tipo;
  end if;
  if v_monto is null or v_monto <= 0 then
    raise exception 'El monto debe ser mayor a cero.';
  end if;
  if p_nota is null or btrim(p_nota) = '' then
    raise exception 'La nota es obligatoria.';
  end if;

  v_cuenta_id := public.fn_cuenta_caja_fuerte();
  select saldo_actual into v_saldo from public.cuentas where id = v_cuenta_id for update;

  if p_tipo = 'egreso' and v_saldo - v_monto < 0 then
    raise exception 'El egreso deja la caja fuerte en negativo (saldo actual %).', v_saldo;
  end if;
  v_saldo_nuevo := case when p_tipo = 'egreso' then v_saldo - v_monto else v_saldo + v_monto end;

  -- Registro propio del circuito (historial de la pestaña Caja fuerte)
  insert into public.movimientos_caja_fuerte (usuario_id, tipo, monto, nota)
  values (p_usuario_id, p_tipo, v_monto, btrim(p_nota))
  returning id into v_id;

  -- Movimiento real de la cuenta bóveda
  insert into public.movimientos_cuenta (
    cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo,
    descripcion, categoria, referencia_tipo, referencia_id, usuario_id, fecha
  ) values (
    v_cuenta_id, p_tipo::public.tipo_movimiento_cuenta, v_monto, v_saldo, v_saldo_nuevo,
    case when p_tipo = 'ingreso' then 'Ingreso manual a caja fuerte · ' else 'Egreso manual de caja fuerte · ' end || btrim(p_nota),
    'caja_fuerte', 'mov_caja_fuerte', v_id, p_usuario_id,
    (now() at time zone 'America/Argentina/La_Rioja')::date
  );

  update public.cuentas set saldo_actual = v_saldo_nuevo, updated_at = now() where id = v_cuenta_id;

  perform public.fn_auditar(
    p_usuario_id, 'movimiento_caja_fuerte', 'movimiento_caja_fuerte', v_id,
    jsonb_build_object('tipo', p_tipo, 'monto', v_monto, 'saldo_nuevo', v_saldo_nuevo)
  );

  return jsonb_build_object('id', v_id, 'tipo', p_tipo, 'monto', v_monto);
end $$;

revoke execute on function public.fn_registrar_mov_caja_fuerte(uuid, text, numeric, text) from anon;

notify pgrst, 'reload schema';
