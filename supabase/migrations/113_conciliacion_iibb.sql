-- ╔═════════════════════════════════════════════════════════════════════╗
-- ║  113 · fn_aplicar_conciliacion v3 — paridad IIBB con el camino manual ║
-- ║                                                                       ║
-- ║  Bug: la mig 058 agregó la retención de IIBB (cuentas.                ║
-- ║  retencion_iibb_porcentaje, ej. MP 3% La Rioja) a fn_crear_venta y a  ║
-- ║  fn_acreditar_pago, pero fn_aplicar_conciliacion quedó en su v2       ║
-- ║  (mig 046): al acreditar una venta desde el extracto importado solo   ║
-- ║  registraba bruto + comisión. Resultado: cada acreditación conciliada ║
-- ║  dejaba el saldo de la cuenta inflado en el IIBB no descontado.       ║
-- ║                                                                       ║
-- ║  v3 = v2 + egreso 'iibb' (conciliado) tras la comisión, misma cuenta  ║
-- ║  y redondeo que fn_acreditar_pago v3 (058). Firma sin cambios.        ║
-- ╚═════════════════════════════════════════════════════════════════════╝

create or replace function public.fn_aplicar_conciliacion(
  p_usuario_id uuid,
  p_cuenta_id integer,
  p_nombre_archivo text,
  p_lineas jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_extracto_id integer;
  v_linea jsonb;
  v_accion text;
  v_ref_id integer;
  v_estado text;
  v_match_tipo text;
  v_monto numeric;
  v_fecha date;
  v_total integer := 0;
  v_conciliadas integer := 0;
  v_anomalias integer := 0;
  v_monto_conc numeric := 0;
  v_acred record;
  v_saldo_ant numeric;
  v_saldo numeric;
  v_mov_id integer;
  v_iibb_pct numeric;
  v_iibb_monto numeric;
begin
  insert into public.extractos_bancarios (cuenta_id, usuario_id, nombre_archivo)
  values (p_cuenta_id, p_usuario_id, p_nombre_archivo)
  returning id into v_extracto_id;

  for v_linea in select * from jsonb_array_elements(p_lineas) loop
    v_total := v_total + 1;
    v_accion := coalesce(v_linea->>'accion', 'anomalia');
    v_ref_id := nullif(v_linea->>'ref_id', '')::integer;
    v_monto := (v_linea->>'monto')::numeric;
    v_fecha := nullif(v_linea->>'fecha', '')::date;
    v_estado := 'anomalia';
    v_match_tipo := null;

    if v_accion = 'acreditar' and v_ref_id is not null then
      select * into v_acred from public.acreditaciones
        where id = v_ref_id and estado = 'pendiente' for update;
      if found and v_acred.cuenta_id is not null then
        select saldo_actual, coalesce(retencion_iibb_porcentaje, 0)
          into v_saldo_ant, v_iibb_pct
          from public.cuentas where id = v_acred.cuenta_id for update;

        -- Ingreso bruto (conciliado)
        v_saldo := v_saldo_ant + v_acred.monto_bruto;
        insert into public.movimientos_cuenta (
          cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo,
          descripcion, categoria, referencia_tipo, referencia_id,
          usuario_id, fecha, conciliado, fecha_conciliacion
        ) values (
          v_acred.cuenta_id, 'ingreso', v_acred.monto_bruto, v_saldo_ant, v_saldo,
          'Acreditación ' || v_acred.medio_pago || ' · Venta #' || v_acred.venta_id ||
            ' (conciliada)',
          'acreditacion', 'acreditacion', v_acred.id,
          p_usuario_id, coalesce(v_fecha, current_date), true, now()
        ) returning id into v_mov_id;

        -- Egreso comisión (conciliado)
        if v_acred.comision_monto > 0 then
          insert into public.movimientos_cuenta (
            cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo,
            descripcion, categoria, referencia_tipo, referencia_id,
            usuario_id, fecha, conciliado, fecha_conciliacion
          ) values (
            v_acred.cuenta_id, 'egreso', v_acred.comision_monto,
            v_saldo, v_saldo - v_acred.comision_monto,
            'Comisión ' || v_acred.medio_pago || ' · Venta #' || v_acred.venta_id,
            'comisiones', 'acreditacion', v_acred.id,
            p_usuario_id, coalesce(v_fecha, current_date), true, now()
          );
          v_saldo := v_saldo - v_acred.comision_monto;
        end if;

        -- Egreso retención IIBB sobre el bruto (conciliado) — paridad con
        -- fn_acreditar_pago v3 (mig 058)
        v_iibb_monto := round(v_acred.monto_bruto * v_iibb_pct) / 100;
        if v_iibb_monto > 0 then
          insert into public.movimientos_cuenta (
            cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo,
            descripcion, categoria, referencia_tipo, referencia_id,
            usuario_id, fecha, conciliado, fecha_conciliacion
          ) values (
            v_acred.cuenta_id, 'egreso', v_iibb_monto,
            v_saldo, v_saldo - v_iibb_monto,
            'Retención IIBB (' || v_iibb_pct || '%) · Venta #' || v_acred.venta_id,
            'iibb', 'acreditacion', v_acred.id,
            p_usuario_id, coalesce(v_fecha, current_date), true, now()
          );
          v_saldo := v_saldo - v_iibb_monto;
        end if;

        update public.cuentas
          set saldo_actual = v_saldo, updated_at = now()
          where id = v_acred.cuenta_id;

        update public.acreditaciones
          set estado = 'acreditada', fecha_real = coalesce(v_fecha, current_date),
              movimiento_id = v_mov_id, updated_at = now()
          where id = v_acred.id;

        v_estado := 'conciliada';
        v_match_tipo := 'acreditacion';
        v_conciliadas := v_conciliadas + 1;
        v_monto_conc := v_monto_conc + v_monto;
      end if;

    elsif v_accion = 'conciliar_mov' and v_ref_id is not null then
      update public.movimientos_cuenta
        set conciliado = true, fecha_conciliacion = now()
        where id = v_ref_id and conciliado = false;
      if found then
        v_estado := 'conciliada';
        v_match_tipo := 'movimiento';
        v_conciliadas := v_conciliadas + 1;
        v_monto_conc := v_monto_conc + v_monto;
      end if;

    elsif v_accion = 'ignorar' then
      v_estado := 'ignorada';
    end if;

    if v_estado = 'anomalia' then
      v_anomalias := v_anomalias + 1;
    end if;

    insert into public.lineas_extracto (
      extracto_id, fecha, descripcion, monto, id_externo,
      estado, match_tipo, match_id
    ) values (
      v_extracto_id, v_fecha, v_linea->>'descripcion', v_monto,
      nullif(v_linea->>'id_externo', ''),
      v_estado, v_match_tipo,
      case when v_estado = 'conciliada' then v_ref_id else null end
    );
  end loop;

  update public.extractos_bancarios
    set lineas_total = v_total, lineas_conciliadas = v_conciliadas,
        lineas_anomalia = v_anomalias, monto_conciliado = v_monto_conc
    where id = v_extracto_id;

  return jsonb_build_object(
    'extracto_id', v_extracto_id, 'total', v_total,
    'conciliadas', v_conciliadas, 'anomalias', v_anomalias
  );
end;
$$;

notify pgrst, 'reload schema';
