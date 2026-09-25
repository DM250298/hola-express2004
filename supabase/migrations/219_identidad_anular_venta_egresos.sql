-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 219 · Identidad y permisos en anular venta y egresos     ║
-- ║                                                                     ║
-- ║  Seguimiento de la 218 (identidad = sesión). Las tres RPCs seguían  ║
-- ║  aceptando el p_usuario_id que manda la pantalla, así que stock,    ║
-- ║  cuentas, asientos y auditoría podían quedar a nombre de otro.      ║
-- ║  Además fn_anular_venta NO tenía control de permisos ni revoke a    ║
-- ║  anon: cualquiera con la clave pública podía anular ventas.         ║
-- ║                                                                     ║
-- ║  · fn_anular_venta  (base 140 ÍNTEGRA): identidad = auth.uid();     ║
-- ║      permiso 'ventas_anular'; sin Finanzas, solo ventas del turno   ║
-- ║      propio y abierto; revoke a public/anon.                        ║
-- ║  · fn_crear_egreso  (base 120 ÍNTEGRA): identidad = auth.uid();     ║
-- ║      gasto de turno → 'pos_gasto' (o Finanzas) + turno propio y     ║
-- ║      ABIERTO; gasto sin turno → 'finanzas'.                         ║
-- ║  · fn_anular_egreso (base 120 ÍNTEGRA): identidad = auth.uid().     ║
-- ║                                                                     ║
-- ║  Mismas firmas → create or replace, sin sobrecargas. Los controles  ║
-- ║  solo corren con JWT 'authenticated' (fn_rol_jwt de la 218):        ║
-- ║  service_role y el SQL Editor quedan igual.                         ║
-- ║  Roles verificados en la copia de prod (2026-09-25): cajero,        ║
-- ║  encargado y admin tienen pos, pos_gasto y ventas_anular.           ║
-- ║                                                                     ║
-- ║  Requiere la 218. Ejecutar UNA sola vez, COMPLETO, en el SQL        ║
-- ║  Editor. Primero PRUEBA, después PRODUCCIÓN. Después: chequeo T1.   ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────────────────────
-- 1. fn_anular_venta · base 140 íntegra + bloque "219"
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_anular_venta(
  p_venta_id integer, p_usuario_id uuid
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_estado text; v_fecha date; v_total numeric;
  v_ahora timestamptz := now(); v_hoy date := current_date;
  v_item record; v_mov record;
  v_stock_ant numeric; v_stock_nuevo numeric;
  v_saldo numeric; v_saldo_nuevo numeric;
  v_tipo_opuesto text; v_lote_id integer;
  v_controlar boolean;
  v_comp record; v_cant_comp numeric;
  v_cc record;  -- v10
  v_turno_dueno uuid; v_turno_estado text;  -- 219
begin
  -- ── 219 · IDENTIDAD Y PERMISO ────────────────────────────────────────
  -- Con sesión de usuario, quien anula es auth.uid() (movimientos, asientos y
  -- auditoría quedan a su nombre), necesita el permiso 'ventas_anular' y solo
  -- puede anular ventas de SU turno abierto. Finanzas (admin incluido) puede
  -- anular cualquiera. service_role / SQL Editor: sin cambios.
  p_usuario_id := public.fn_usuario_efectivo(p_usuario_id);
  if public.fn_rol_jwt() = 'authenticated' then
    if p_usuario_id is null then
      raise exception 'SESION_CAMBIO: la sesión no es válida. Volvé a iniciar sesión.';
    end if;
    if not coalesce((select public.fn_tiene_permiso('ventas_anular')), false) then
      raise exception 'No tenés permiso para anular ventas.';
    end if;
    if not coalesce((select public.fn_tiene_permiso('finanzas')), false) then
      select t.usuario_id, t.estado::text into v_turno_dueno, v_turno_estado
        from public.ventas v join public.caja_turnos t on t.id = v.turno_id
        where v.id = p_venta_id;
      if v_turno_dueno is not null and v_turno_dueno <> p_usuario_id then
        raise exception 'TURNO_AJENO: esa venta es del turno de otra persona; no la podés anular.';
      end if;
      if v_turno_estado is not null and v_turno_estado <> 'abierto' then
        raise exception 'TURNO_CERRADO: esa venta es de un turno ya cerrado; pedile a alguien con Finanzas que la anule.';
      end if;
    end if;
  end if;

  select estado, fecha::date, total into v_estado, v_fecha, v_total
    from public.ventas where id = p_venta_id for update;
  if v_estado is null then raise exception 'La venta no existe.'; end if;
  if v_estado <> 'completada' then raise exception 'La venta ya estaba anulada.'; end if;
  if public.fn_periodo_cerrado(v_fecha) then
    raise exception 'El período de esa venta está cerrado; no se puede anular.';
  end if;

  for v_item in select producto_id, cantidad from public.items_venta where venta_id = p_venta_id loop
    if exists (select 1 from public.producto_componentes where producto_id = v_item.producto_id) then
      -- ── Combo: la venta descontó componentes → la anulación los repone. ──
      for v_comp in
        select pc.componente_id, pc.cantidad
        from public.producto_componentes pc
        where pc.producto_id = v_item.producto_id
        order by pc.id
      loop
        v_cant_comp := v_comp.cantidad * v_item.cantidad;
        select stock_actual, coalesce(controlar_stock, true)
          into v_stock_ant, v_controlar from public.productos
          where id = v_comp.componente_id for update;
        if v_stock_ant is null then continue; end if;
        if v_controlar then
          v_stock_nuevo := v_stock_ant + v_cant_comp;
          update public.productos set stock_actual = v_stock_nuevo, updated_at = v_ahora
            where id = v_comp.componente_id;
          insert into public.movimientos_stock (
            producto_id, tipo, cantidad, stock_anterior, stock_nuevo, referencia_id, usuario_id, nota
          ) values (
            v_comp.componente_id, 'entrada', v_cant_comp, v_stock_ant, v_stock_nuevo,
            p_venta_id, p_usuario_id, 'Anulación venta #' || p_venta_id || ' (combo)'
          );
          select id into v_lote_id from public.lotes
            where producto_id = v_comp.componente_id and estado in ('activo','agotado')
            order by fecha_vencimiento desc, id desc limit 1;
          if v_lote_id is not null then
            update public.lotes set cantidad_actual = cantidad_actual + v_cant_comp, estado = 'activo'
              where id = v_lote_id;
          end if;
        end if;
      end loop;
    else
      -- ── Producto común: idéntico a la 101. ──
      select stock_actual, coalesce(controlar_stock, true)
        into v_stock_ant, v_controlar from public.productos where id = v_item.producto_id for update;
      if v_stock_ant is null then continue; end if;
      -- Solo repone stock/movimiento/lote si el producto controla stock
      -- (simétrico con la venta: si no descontó, la anulación no repone).
      if v_controlar then
        v_stock_nuevo := v_stock_ant + v_item.cantidad;
        update public.productos set stock_actual = v_stock_nuevo, updated_at = v_ahora
          where id = v_item.producto_id;
        insert into public.movimientos_stock (
          producto_id, tipo, cantidad, stock_anterior, stock_nuevo, referencia_id, usuario_id, nota
        ) values (
          v_item.producto_id, 'entrada', v_item.cantidad, v_stock_ant, v_stock_nuevo,
          p_venta_id, p_usuario_id, 'Anulación venta #' || p_venta_id
        );
        select id into v_lote_id from public.lotes
          where producto_id = v_item.producto_id and estado in ('activo','agotado')
          order by fecha_vencimiento desc, id desc limit 1;
        if v_lote_id is not null then
          update public.lotes set cantidad_actual = cantidad_actual + v_item.cantidad, estado = 'activo'
            where id = v_lote_id;
        end if;
      end if;
    end if;
  end loop;

  for v_mov in
    -- v9: se trae también `categoria` para que el reverso la conserve
    -- (comisiones/iibb netean en el P&L en lugar de quedar como 'venta').
    select cuenta_id, tipo, monto, categoria from public.movimientos_cuenta
      where tipo in ('ingreso', 'egreso')
        and ((referencia_tipo = 'venta' and referencia_id = p_venta_id)
          or (referencia_tipo = 'acreditacion' and referencia_id in (
                select id from public.acreditaciones where venta_id = p_venta_id)))
  loop
    v_tipo_opuesto := case when v_mov.tipo = 'ingreso' then 'egreso' else 'ingreso' end;
    select saldo_actual into v_saldo from public.cuentas where id = v_mov.cuenta_id for update;
    if v_saldo is null then continue; end if;
    v_saldo_nuevo := case when v_tipo_opuesto = 'ingreso' then v_saldo + v_mov.monto else v_saldo - v_mov.monto end;
    insert into public.movimientos_cuenta (
      cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo,
      descripcion, categoria, referencia_tipo, referencia_id, usuario_id, fecha
    ) values (
      v_mov.cuenta_id, v_tipo_opuesto::public.tipo_movimiento_cuenta, v_mov.monto, v_saldo, v_saldo_nuevo,
      'Anulación venta #' || p_venta_id, coalesce(v_mov.categoria, 'venta'),
      'venta', p_venta_id, p_usuario_id, v_hoy
    );
    update public.cuentas set saldo_actual = v_saldo_nuevo, updated_at = v_ahora where id = v_mov.cuenta_id;
  end loop;

  -- ── v10: revertir el cargo de cuenta corriente con un CONTRA-MOVIMIENTO,
  -- nunca con delete. Motivo: el cargo pudo haber sido descontado ya por una
  -- liquidación (liquidacion_recibo_id no nulo en el mov de descuento).
  -- Borrarlo re-inflaría el saldo del empleado y el consumo se le cobraría
  -- dos veces. El contra-movimiento puede dejar el saldo NEGATIVO (a favor):
  -- fn_generar_liquidacion lo ignora vía greatest(0, saldo) y se compensa
  -- contra el próximo consumo. ──
  for v_cc in
    select 'cliente'::text as t, cliente_id as deudor, monto
      from public.cuenta_corriente_cliente
      where venta_id = p_venta_id and tipo = 'consumo'
    union all
    select 'empleado', empleado_id, monto
      from public.cuenta_corriente_empleado
      where venta_id = p_venta_id and tipo = 'consumo'
  loop
    if v_cc.t = 'cliente' then
      insert into public.cuenta_corriente_cliente
        (cliente_id, fecha, tipo, concepto, monto, venta_id, usuario_id)
      values (v_cc.deudor, v_hoy, 'ajuste',
              'Anulación venta #' || p_venta_id, -v_cc.monto, p_venta_id, p_usuario_id);
    else
      insert into public.cuenta_corriente_empleado
        (empleado_id, fecha, tipo, concepto, monto, venta_id, usuario_id)
      values (v_cc.deudor, v_hoy, 'ajuste',
              'Anulación venta #' || p_venta_id, -v_cc.monto, p_venta_id, p_usuario_id);
    end if;
  end loop;

  update public.acreditaciones set estado = 'cancelada', updated_at = v_ahora
    where venta_id = p_venta_id and estado in ('pendiente', 'acreditada');
  delete from public.asientos where origen = 'venta' and referencia_id = p_venta_id;
  update public.ventas set estado = 'anulada' where id = p_venta_id;

  perform public.fn_auditar(p_usuario_id, 'anular_venta', 'venta', p_venta_id,
    jsonb_build_object('total', v_total));
end $$;

revoke all on function public.fn_anular_venta(integer, uuid) from public, anon;
grant execute on function public.fn_anular_venta(integer, uuid) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────
-- 2. fn_crear_egreso · base 120 íntegra + bloque "219"
-- ─────────────────────────────────────────────────────────────────────
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
  -- 219
  v_finanzas boolean := false;
  v_turno_dueno uuid;
  v_turno_estado text;
begin
  -- ── 219 · IDENTIDAD, TURNO Y PERMISO ─────────────────────────────────
  -- Con sesión de usuario, el gasto queda a nombre de auth.uid(). Gasto del
  -- turno (efectivo del POS): permiso 'pos_gasto' (o Finanzas) y el turno
  -- tiene que ser propio y estar ABIERTO: un gasto contra un turno cerrado
  -- cambiaría un arqueo que ya se contó. Gasto sin turno (tesorería):
  -- permiso 'finanzas'. service_role / SQL Editor: sin cambios.
  p_usuario_id := public.fn_usuario_efectivo(p_usuario_id);
  if public.fn_rol_jwt() = 'authenticated' then
    if p_usuario_id is null then
      raise exception 'SESION_CAMBIO: la sesión no es válida. Volvé a iniciar sesión.';
    end if;
    v_finanzas := coalesce((select public.fn_tiene_permiso('finanzas')), false);
    if p_turno_id is not null then
      if not (v_finanzas or coalesce((select public.fn_tiene_permiso('pos_gasto')), false)) then
        raise exception 'No tenés permiso para registrar gastos de caja.';
      end if;
      select usuario_id, estado::text into v_turno_dueno, v_turno_estado
        from public.caja_turnos where id = p_turno_id;
      if v_turno_dueno is null then
        raise exception 'El turno de caja #% no existe.', p_turno_id;
      end if;
      if v_turno_dueno <> p_usuario_id and not v_finanzas then
        raise exception 'TURNO_AJENO: el turno de caja #% no es tuyo. Recargá la página.', p_turno_id;
      end if;
      if v_turno_estado <> 'abierto' then
        raise exception 'TURNO_CERRADO: el turno #% ya está cerrado; el gasto no se puede cargar contra él.', p_turno_id;
      end if;
    elsif not v_finanzas then
      raise exception 'No tenés permiso para registrar gastos fuera de un turno de caja.';
    end if;
  end if;

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

revoke all on function public.fn_crear_egreso(text, numeric, text, date, uuid, integer, integer) from public, anon;
grant execute on function public.fn_crear_egreso(text, numeric, text, date, uuid, integer, integer) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────
-- 3. fn_anular_egreso · base 120 íntegra + bloque "219"
-- ─────────────────────────────────────────────────────────────────────
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
  -- ── 219 · IDENTIDAD: el movimiento inverso y la auditoría quedan a nombre
  -- de quien anula de verdad (auth.uid()), no del id que manda la pantalla.
  p_usuario_id := public.fn_usuario_efectivo(p_usuario_id);
  if public.fn_rol_jwt() = 'authenticated' and p_usuario_id is null then
    raise exception 'SESION_CAMBIO: la sesión no es válida. Volvé a iniciar sesión.';
  end if;

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

revoke all on function public.fn_anular_egreso(integer, uuid) from public, anon;
grant execute on function public.fn_anular_egreso(integer, uuid) to authenticated, service_role;

notify pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────────
-- Chequeos post-migración (correr a mano):
--   T1 (0 filas):
--     select proname, count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname = 'public' and proname like 'fn_%' group by proname having count(*) > 1;
--   anon sin acceso (las tres false):
--     select has_function_privilege('anon', 'public.fn_anular_venta(integer,uuid)', 'execute'),
--            has_function_privilege('anon', 'public.fn_crear_egreso(text,numeric,text,date,uuid,integer,integer)', 'execute'),
--            has_function_privilege('anon', 'public.fn_anular_egreso(integer,uuid)', 'execute');
-- ─────────────────────────────────────────────────────────────────────
