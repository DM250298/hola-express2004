-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 318 · Margen neto de IVA (8/9): fn_tablero_gerencial v3  ║
-- ║                                                                     ║
-- ║  Base: mig 217 sin las secciones movidas a fn_tablero_estado (317). ║
-- ║  Cambios en el JSON:                                                ║
-- ║   · margen: + ingresos_netos, iva, devoluciones,                    ║
-- ║     anterior_ingresos_netos, regimen, version 3; margen y margen_pct║
-- ║     pasan a NETO (ventas netas de IVA y devoluciones − costo).      ║
-- ║     `ingresos` sigue siendo el bruto (compatibilidad).              ║
-- ║   · serie: + ingresos_netos y devoluciones por día; margen neto.    ║
-- ║   · ventas (hoy, ayer, semana, mes, período) siguen siendo lo       ║
-- ║     COBRADO con IVA: es lo que el dueño ve en caja.                 ║
-- ║  REQUIERE: migs 313, 316 y 317. Ejecutar COMPLETA; última línea:    ║
-- ║  notify pgrst, 'reload schema';                                     ║
-- ╚════════════════════════════════════════════════════════════════════╝

drop function if exists public.fn_tablero_gerencial(date, date);

create function public.fn_tablero_gerencial(p_desde date, p_hasta date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_costos boolean := public.fn_tiene_permiso('costos');
  v_hoy date := (now() at time zone 'America/Argentina/La_Rioja')::date;
  v_dias integer;
  v_ant_desde date;
  v_ant_hasta date;
  v_ini_mes date;
  v_ini_mes_ant date;
  v_fin_tramo_ant date;
  v_scan_desde date;
  v_scan_hasta date;
  v_ventas jsonb;
  v_margen jsonb;
  v_serie jsonb;
begin
  if not public.fn_tiene_permiso('tablero') then
    raise exception 'No tenés permiso para ver el tablero del dueño.';
  end if;
  if p_desde is null or p_hasta is null or p_desde > p_hasta then
    raise exception 'Período inválido.';
  end if;
  if p_hasta - p_desde > 400 then
    raise exception 'Período demasiado largo (máximo 400 días).';
  end if;

  v_dias := p_hasta - p_desde + 1;
  -- Si el período arranca el 1° de un mes, se compara contra el MISMO
  -- TRAMO del mes anterior; si no, contra los N días previos (mig 217).
  if extract(day from p_desde) = 1 then
    v_ant_desde := (p_desde - interval '1 month')::date;
    v_ant_hasta := least(v_ant_desde + (p_hasta - p_desde), p_desde - 1);
  else
    v_ant_hasta := p_desde - 1;
    v_ant_desde := p_desde - v_dias;
  end if;
  v_ini_mes       := date_trunc('month', v_hoy::timestamp)::date;
  v_ini_mes_ant   := (date_trunc('month', v_hoy::timestamp) - interval '1 month')::date;
  v_fin_tramo_ant := least(v_ini_mes_ant + (v_hoy - v_ini_mes), v_ini_mes - 1);
  v_scan_desde    := least(v_ant_desde, v_ini_mes_ant, v_hoy - 13);
  v_scan_hasta    := greatest(p_hasta, v_hoy);

  -- ── Ventas, margen y serie: un solo recorrido de fn_ventas_diarias v2 ──
  with d as materialized (
    select * from public.fn_ventas_diarias(v_scan_desde, v_scan_hasta)
  ),
  t as (
    select
      coalesce(sum(d.ventas)         filter (where d.dia = v_hoy), 0)                                   as hoy,
      coalesce(sum(d.tickets)        filter (where d.dia = v_hoy), 0)                                   as hoy_tickets,
      coalesce(sum(d.ventas)         filter (where d.dia = v_hoy - 1), 0)                               as ayer,
      coalesce(sum(d.ventas)         filter (where d.dia = v_hoy - 8), 0)                               as ayer_sem_ant,
      coalesce(sum(d.ventas)         filter (where d.dia between v_hoy - 6 and v_hoy), 0)               as semana,
      coalesce(sum(d.ventas)         filter (where d.dia between v_hoy - 13 and v_hoy - 7), 0)          as semana_ant,
      coalesce(sum(d.ventas)         filter (where d.dia between v_ini_mes and v_hoy), 0)               as mes,
      coalesce(sum(d.ventas)         filter (where d.dia between v_ini_mes_ant and v_fin_tramo_ant), 0) as mes_ant,
      coalesce(sum(d.ventas)         filter (where d.dia between p_desde and p_hasta), 0)               as per,
      coalesce(sum(d.tickets)        filter (where d.dia between p_desde and p_hasta), 0)               as per_tickets,
      coalesce(sum(d.ventas)         filter (where d.dia between v_ant_desde and v_ant_hasta), 0)       as per_ant,
      coalesce(sum(d.ingresos)       filter (where d.dia between p_desde and p_hasta), 0)               as ing,
      coalesce(sum(d.ingresos_netos) filter (where d.dia between p_desde and p_hasta), 0)               as ing_neto,
      coalesce(sum(d.iva)            filter (where d.dia between p_desde and p_hasta), 0)               as iva,
      coalesce(sum(d.devoluciones)   filter (where d.dia between p_desde and p_hasta), 0)               as dev,
      coalesce(sum(d.costo_ventas)   filter (where d.dia between p_desde and p_hasta), 0)               as cos,
      coalesce(sum(d.ingresos_netos) filter (where d.dia between v_ant_desde and v_ant_hasta), 0)       as ing_neto_ant,
      coalesce(sum(d.costo_ventas)   filter (where d.dia between v_ant_desde and v_ant_hasta), 0)       as cos_ant,
      coalesce(bool_or(d.estimado)   filter (where d.dia between p_desde and p_hasta), false)           as est
    from d
  ),
  s as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'fecha', g.dia,
             'ventas', coalesce(x.ventas, 0),
             'tickets', coalesce(x.tickets, 0),
             'ingresos', coalesce(x.ingresos, 0),
             'ingresos_netos', coalesce(x.ingresos_netos, 0),
             'devoluciones', coalesce(x.devoluciones, 0),
             'margen', case when v_costos
                            then round(coalesce(x.ingresos_netos, 0) - coalesce(x.costo_ventas, 0), 2) end
           ) order by g.dia), '[]'::jsonb) as serie
    from (
      select generate_series(p_desde::timestamp, p_hasta::timestamp, interval '1 day')::date as dia
    ) g
    left join d x on x.dia = g.dia
  )
  select
    jsonb_build_object(
      'hoy', t.hoy,
      'hoy_tickets', t.hoy_tickets,
      'ayer', t.ayer,
      'ayer_semana_anterior', t.ayer_sem_ant,
      'semana', t.semana,
      'semana_anterior', t.semana_ant,
      'mes', t.mes,
      'mes_anterior_mismo_tramo', t.mes_ant,
      'periodo', t.per,
      'periodo_tickets', t.per_tickets,
      'ticket_promedio', case when t.per_tickets > 0 then round(t.per / t.per_tickets, 2) else 0 end,
      'periodo_anterior', t.per_ant
    ),
    jsonb_build_object(
      'version', 3,
      'regimen', public.fn_regimen_iva(),
      'ingresos', round(t.ing, 2),
      'ingresos_netos', round(t.ing_neto, 2),
      'iva', round(t.iva, 2),
      'devoluciones', round(t.dev, 2),
      'anterior_ingresos_netos', round(t.ing_neto_ant, 2),
      'costo', case when v_costos then round(t.cos, 2) end,
      'margen', case when v_costos then round(t.ing_neto - t.cos, 2) end,
      'margen_pct', case when v_costos and t.ing_neto > 0
                         then round(((t.ing_neto - t.cos) / t.ing_neto * 100)::numeric, 1) end,
      'anterior_margen', case when v_costos then round(t.ing_neto_ant - t.cos_ant, 2) end,
      'anterior_margen_pct', case when v_costos and t.ing_neto_ant > 0
                                  then round(((t.ing_neto_ant - t.cos_ant) / t.ing_neto_ant * 100)::numeric, 1) end,
      'estimado', t.est
    ),
    s.serie
  into v_ventas, v_margen, v_serie
  from t cross join s;

  return jsonb_build_object(
           'generado_at', now(),
           'hoy', v_hoy,
           'periodo', jsonb_build_object(
             'desde', p_desde,
             'hasta', p_hasta,
             'dias', v_dias,
             'anterior_desde', v_ant_desde,
             'anterior_hasta', v_ant_hasta
           ),
           'puede_ver_costos', v_costos,
           'ventas', v_ventas,
           'margen', v_margen,
           'serie', v_serie
         )
         || public.fn_tablero_estado(p_desde, p_hasta)
         || public.fn_tablero_skus(p_desde, p_hasta);
end;
$$;

revoke execute on function public.fn_tablero_gerencial(date, date) from public, anon;
grant execute on function public.fn_tablero_gerencial(date, date) to authenticated;

notify pgrst, 'reload schema';

-- Verificación: chequeo T1 (0 filas) y /tablero en la app como admin (en el
-- SQL Editor no hay usuario logueado y la función exige el permiso 'tablero').
