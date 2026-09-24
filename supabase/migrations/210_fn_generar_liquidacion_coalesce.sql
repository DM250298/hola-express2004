-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 210 · fn_generar_liquidacion v2: config a prueba de NULL ║
-- ║                                                                     ║
-- ║  Bug de producción: "null value in column presentismo_perdido of    ║
-- ║  relation liquidacion_recibo". La v1 (mig 090) leía cada parámetro  ║
-- ║  con `select coalesce(valor, default) into v from rrhh_config       ║
-- ║  where clave = ...`: si la fila NO existe, plpgsql deja la variable ║
-- ║  en NULL y el coalesce no llega a correr. La 209 re-siembra las     ║
-- ║  claves; esta versión deja de depender de que existan.              ║
-- ║                                                                     ║
-- ║  Cuerpo = el de la 090 sin cambios salvo la lectura de config y     ║
-- ║  el cálculo de v_pres_perdido (con coalesce). Se quitaron los       ║
-- ║  comentarios de línea para que entre en el SQL Editor.              ║
-- ║  Misma firma → CREATE OR REPLACE limpio.                            ║
-- ║                                                                     ║
-- ║  REQUIERE: 209. Ejecutar UNA sola vez, COMPLETO.                    ║
-- ║  Última línea: notify pgrst, 'reload schema';                       ║
-- ╚════════════════════════════════════════════════════════════════════╝

create or replace function public.fn_generar_liquidacion(
  p_periodo text,
  p_usuario_id uuid
) returns public.liquidacion_lote
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lote public.liquidacion_lote;
  v_emp record;
  v_desde date;
  v_hasta date;
  v_hasta_cierre date;
  v_dia date;
  v_mes int;
  v_divisor numeric := 200;
  v_pres_pct numeric := 8.33;
  v_pres_max_tard int := 3;
  v_pres_max_aus int := 1;
  v_f50 numeric := 1.5;
  v_f100 numeric := 2.0;
  v_basico numeric;
  v_valor_hora numeric;
  v_dias_trab int;
  v_tardanzas int;
  v_ausencias int;
  v_he50_raw numeric;
  v_he100_raw numeric;
  v_he50_feriado numeric;
  v_he50 numeric;
  v_he100 numeric;
  v_pres_perdido boolean;
  v_bono numeric;
  v_otro numeric;
  v_adelanto numeric;
  v_descuento numeric;
  v_saldo_cta numeric;
  v_desc_cta numeric;
  v_presentismo numeric;
  v_sac numeric;
  v_imp_he50 numeric;
  v_imp_he100 numeric;
  v_remunerativo numeric;
  v_descuentos numeric;
  v_neto numeric;
  v_recibo_id integer;
  v_orden int;
  v_tot_rem numeric := 0;
  v_tot_desc numeric := 0;
  v_tot_neto numeric := 0;
begin
  if not public.fn_tiene_permiso('rrhh_sueldos') then
    raise exception 'Sin permiso para liquidar sueldos.';
  end if;
  if p_periodo !~ '^\d{4}-\d{2}$' then
    raise exception 'Período inválido (se espera YYYY-MM): %', p_periodo;
  end if;
  v_desde := (p_periodo || '-01')::date;
  v_hasta := (v_desde + interval '1 month' - interval '1 day')::date;
  v_mes := split_part(p_periodo, '-', 2)::int;
  if exists (
    select 1 from public.liquidacion_lote
    where periodo = p_periodo and tipo = 'mensual' and estado <> 'borrador'
  ) then
    raise exception 'Ya existe una liquidación cerrada para el período %.', p_periodo;
  end if;
  v_hasta_cierre := least(v_hasta, current_date);
  v_dia := v_desde;
  while v_dia <= v_hasta_cierre loop
    perform public.fn_cerrar_dia_asistencia(v_dia);
    v_dia := v_dia + 1;
  end loop;
  delete from public.liquidacion_lote
    where periodo = p_periodo and tipo = 'mensual' and estado = 'borrador';
  insert into public.liquidacion_lote (periodo, tipo, estado, usuario_id)
  values (p_periodo, 'mensual', 'borrador', p_usuario_id)
  returning * into v_lote;
  -- v2 (mig 210): `select coalesce(...) into` deja NULL si FALTA la fila
  -- (el coalesce nunca corre) → presentismo_perdido NULL. Ahora el coalesce
  -- envuelve la subconsulta, y ::numeric::int tolera un "3.0".
  v_divisor       := coalesce((select (valor #>> '{}')::numeric      from public.rrhh_config where clave = 'divisor_valor_hora'), 200);
  v_pres_pct      := coalesce((select (valor #>> '{}')::numeric      from public.rrhh_config where clave = 'presentismo_porcentaje'), 8.33);
  v_pres_max_tard := coalesce((select (valor #>> '{}')::numeric::int from public.rrhh_config where clave = 'presentismo_max_tardanzas'), 3);
  v_pres_max_aus  := coalesce((select (valor #>> '{}')::numeric::int from public.rrhh_config where clave = 'presentismo_max_ausencias'), 1);
  v_f50           := coalesce((select (valor #>> '{}')::numeric      from public.rrhh_config where clave = 'hora_extra_50_factor'), 1.5);
  v_f100          := coalesce((select (valor #>> '{}')::numeric      from public.rrhh_config where clave = 'hora_extra_100_factor'), 2.0);
  if v_divisor is null or v_divisor = 0 then v_divisor := 200; end if;
  for v_emp in
    select id from public.empleados where activo = true order by id
  loop
    v_basico := coalesce(public.fn_sueldo(v_emp.id), 0);
    v_valor_hora := round(v_basico / nullif(v_divisor, 0), 2);
    select
      coalesce(count(*) filter (where ad.estado in ('presente','tardanza','sin_turno') and ad.marcaciones >= 2), 0),
      coalesce(count(*) filter (where ad.estado = 'tardanza'), 0),
      coalesce(count(*) filter (where ad.estado = 'ausente_injustificado'), 0),
      coalesce(sum(ad.horas_extra_50), 0),
      coalesce(sum(ad.horas_extra_100), 0),
      coalesce(sum(ad.horas_extra_50) filter (where f.fecha is not null), 0)
    into v_dias_trab, v_tardanzas, v_ausencias, v_he50_raw, v_he100_raw, v_he50_feriado
    from public.asistencia_diaria ad
    left join public.feriados f on f.fecha = ad.fecha
    where ad.empleado_id = v_emp.id
      and ad.fecha between v_desde and v_hasta;
    v_he100 := v_he100_raw + v_he50_feriado;
    v_he50  := greatest(0, v_he50_raw - v_he50_feriado);
    v_pres_perdido := coalesce(v_tardanzas > v_pres_max_tard, false)
                   or coalesce(v_ausencias > v_pres_max_aus, false);
    select
      coalesce(sum(monto) filter (where tipo = 'bono'), 0),
      coalesce(sum(monto) filter (where tipo = 'otro'), 0),
      coalesce(sum(monto) filter (where tipo = 'adelanto'), 0),
      coalesce(sum(monto) filter (where tipo = 'descuento'), 0)
    into v_bono, v_otro, v_adelanto, v_descuento
    from public.novedades_empleado
    where empleado_id = v_emp.id and periodo = p_periodo;
    v_presentismo := case when v_pres_perdido then 0
                          else round(v_basico * v_pres_pct / 100, 2) end;
    v_sac := case when v_mes in (6, 12) then round(v_basico * 0.5, 2) else 0 end;
    v_imp_he50  := round(v_he50  * v_valor_hora * v_f50, 2);
    v_imp_he100 := round(v_he100 * v_valor_hora * v_f100, 2);
    v_remunerativo := v_basico + v_presentismo + v_imp_he50 + v_imp_he100
                      + v_sac + v_bono + v_otro;
    select coalesce(sum(monto), 0)
      into v_saldo_cta
      from public.cuenta_corriente_empleado
      where empleado_id = v_emp.id
        and recibo_id is null
        and liquidacion_recibo_id is null;
    v_desc_cta := least(
      greatest(0, v_saldo_cta),
      greatest(0, v_remunerativo - v_adelanto - v_descuento)
    );
    v_descuentos := v_adelanto + v_descuento + v_desc_cta;
    v_neto := v_remunerativo - v_descuentos;
    if v_neto < 0 then
      raise exception
        'El recibo del empleado id=% da neto negativo (%). Revisá los adelantos/descuentos del período %.',
        v_emp.id, v_neto, p_periodo;
    end if;
    insert into public.liquidacion_recibo (
      lote_id, empleado_id, sueldo_basico, valor_hora,
      dias_trabajados, dias_ausente_injust, tardanzas,
      he50_horas, he100_horas, presentismo_perdido,
      total_remunerativo, total_descuentos, neto
    ) values (
      v_lote.id, v_emp.id, v_basico, v_valor_hora,
      v_dias_trab, v_ausencias, v_tardanzas,
      v_he50, v_he100, v_pres_perdido,
      v_remunerativo, v_descuentos, v_neto
    ) returning id into v_recibo_id;
    v_orden := 0;
    insert into public.liquidacion_renglon (recibo_id, codigo, clase, descripcion, base, cantidad, monto, orden)
      values (v_recibo_id, 'basico', 'haber', 'Sueldo básico', null, null, v_basico, v_orden);
    v_orden := v_orden + 1;
    if v_presentismo > 0 then
      insert into public.liquidacion_renglon (recibo_id, codigo, clase, descripcion, base, cantidad, monto, orden)
        values (v_recibo_id, 'presentismo', 'haber',
                format('Presentismo %s%%', v_pres_pct), v_basico, null, v_presentismo, v_orden);
      v_orden := v_orden + 1;
    end if;
    if v_imp_he50 > 0 then
      insert into public.liquidacion_renglon (recibo_id, codigo, clase, descripcion, base, cantidad, monto, orden)
        values (v_recibo_id, 'he_50', 'haber',
                format('Horas extra 50%% (%s h)', v_he50), v_valor_hora, v_he50, v_imp_he50, v_orden);
      v_orden := v_orden + 1;
    end if;
    if v_imp_he100 > 0 then
      insert into public.liquidacion_renglon (recibo_id, codigo, clase, descripcion, base, cantidad, monto, orden)
        values (v_recibo_id, 'he_100', 'haber',
                format('Horas extra 100%% (%s h)', v_he100), v_valor_hora, v_he100, v_imp_he100, v_orden);
      v_orden := v_orden + 1;
    end if;
    if v_sac > 0 then
      insert into public.liquidacion_renglon (recibo_id, codigo, clase, descripcion, base, cantidad, monto, orden)
        values (v_recibo_id, 'sac', 'haber', 'SAC (½ aguinaldo)', v_basico, null, v_sac, v_orden);
      v_orden := v_orden + 1;
    end if;
    if v_bono > 0 then
      insert into public.liquidacion_renglon (recibo_id, codigo, clase, descripcion, base, cantidad, monto, orden)
        values (v_recibo_id, 'bono', 'haber', 'Bonos (novedades)', null, null, v_bono, v_orden);
      v_orden := v_orden + 1;
    end if;
    if v_otro > 0 then
      insert into public.liquidacion_renglon (recibo_id, codigo, clase, descripcion, base, cantidad, monto, orden)
        values (v_recibo_id, 'otro', 'haber', 'Otros haberes (novedades)', null, null, v_otro, v_orden);
      v_orden := v_orden + 1;
    end if;
    if v_adelanto > 0 then
      insert into public.liquidacion_renglon (recibo_id, codigo, clase, descripcion, base, cantidad, monto, orden)
        values (v_recibo_id, 'adelanto', 'descuento', 'Adelantos del mes', null, null, v_adelanto, v_orden);
      v_orden := v_orden + 1;
    end if;
    if v_descuento > 0 then
      insert into public.liquidacion_renglon (recibo_id, codigo, clase, descripcion, base, cantidad, monto, orden)
        values (v_recibo_id, 'descuento', 'descuento', 'Otros descuentos (novedades)', null, null, v_descuento, v_orden);
      v_orden := v_orden + 1;
    end if;
    if v_desc_cta > 0 then
      insert into public.liquidacion_renglon (recibo_id, codigo, clase, descripcion, base, cantidad, monto, orden)
        values (v_recibo_id, 'ctacte', 'descuento', 'Consumo cuenta corriente', null, null, v_desc_cta, v_orden);
      v_orden := v_orden + 1;
      insert into public.cuenta_corriente_empleado (
        empleado_id, fecha, tipo, concepto, monto, liquidacion_recibo_id, usuario_id
      ) values (
        v_emp.id, current_date, 'descuento_sueldo',
        format('Liquidación %s', p_periodo),
        -v_desc_cta, v_recibo_id, p_usuario_id
      );
    end if;
    v_tot_rem  := v_tot_rem  + v_remunerativo;
    v_tot_desc := v_tot_desc + v_descuentos;
    v_tot_neto := v_tot_neto + v_neto;
  end loop;
  update public.liquidacion_lote
    set total_remunerativo = v_tot_rem,
        total_descuentos   = v_tot_desc,
        total_neto         = v_tot_neto
    where id = v_lote.id
    returning * into v_lote;
  return v_lote;
end $$;

grant execute on function public.fn_generar_liquidacion(text, uuid) to authenticated;

-- Verificación: 1 fila no nula, y el T1 de duplicadas 0 filas.
--   select to_regprocedure('public.fn_generar_liquidacion(text,uuid)');

notify pgrst, 'reload schema';
