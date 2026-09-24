-- Migration 217 · fn_tablero_gerencial v2: comparación contra el mismo
-- tramo del mes anterior. La v1 (182) comparaba contra los N días previos
-- ("este mes" al 23/09 → 09/08–31/08), que el dueño leía como el período
-- equivocado. Resto idéntico a la 182. Ejecutar COMPLETO; última línea:
-- notify pgrst, 'reload schema';

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
  v_ini_ts timestamptz;
  v_fin_ts timestamptz;
  v_ventas jsonb;
  v_margen jsonb;
  v_serie jsonb;
  v_quiebres jsonb;
  v_quiebres_activos jsonb;
  v_mapeo jsonb;
  v_lotes integer;
  v_ultimo_snapshot date;
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

  v_dias          := p_hasta - p_desde + 1;
  -- v2 (mig 217): si el período arranca el 1° de un mes, se compara contra
  -- el MISMO TRAMO del mes anterior (01/09–23/09 → 01/08–23/08; agosto
  -- completo → julio completo). Si no, contra los N días previos.
  if extract(day from p_desde) = 1 then
    v_ant_desde := (p_desde - interval '1 month')::date;
    v_ant_hasta := least(v_ant_desde + (p_hasta - p_desde), p_desde - 1);
  else
    v_ant_hasta := p_desde - 1;
    v_ant_desde := p_desde - v_dias;
  end if;
  v_ini_mes       := date_trunc('month', v_hoy::timestamp)::date;
  v_ini_mes_ant   := (date_trunc('month', v_hoy::timestamp) - interval '1 month')::date;
  -- Mismo tramo del mes anterior (15/09 → 01/08..15/08), clampeado al
  -- último día de ese mes (31/03 → 01/02..28/02).
  v_fin_tramo_ant := least(v_ini_mes_ant + (v_hoy - v_ini_mes), v_ini_mes - 1);
  v_scan_desde    := least(v_ant_desde, v_ini_mes_ant, v_hoy - 13);
  v_scan_hasta    := greatest(p_hasta, v_hoy);
  v_ini_ts        := (p_desde::timestamp) at time zone 'America/Argentina/La_Rioja';
  v_fin_ts        := least(((p_hasta + 1)::timestamp) at time zone 'America/Argentina/La_Rioja', now());

  -- ── 1. Ventas, margen y serie: un solo recorrido de fn_ventas_diarias ──
  with d as materialized (
    select * from public.fn_ventas_diarias(v_scan_desde, v_scan_hasta)
  ),
  t as (
    select
      coalesce(sum(d.ventas)       filter (where d.dia = v_hoy), 0)                                   as hoy,
      coalesce(sum(d.tickets)      filter (where d.dia = v_hoy), 0)                                   as hoy_tickets,
      coalesce(sum(d.ventas)       filter (where d.dia = v_hoy - 1), 0)                               as ayer,
      coalesce(sum(d.ventas)       filter (where d.dia = v_hoy - 8), 0)                               as ayer_sem_ant,
      coalesce(sum(d.ventas)       filter (where d.dia between v_hoy - 6 and v_hoy), 0)               as semana,
      coalesce(sum(d.ventas)       filter (where d.dia between v_hoy - 13 and v_hoy - 7), 0)          as semana_ant,
      coalesce(sum(d.ventas)       filter (where d.dia between v_ini_mes and v_hoy), 0)               as mes,
      coalesce(sum(d.ventas)       filter (where d.dia between v_ini_mes_ant and v_fin_tramo_ant), 0) as mes_ant,
      coalesce(sum(d.ventas)       filter (where d.dia between p_desde and p_hasta), 0)               as per,
      coalesce(sum(d.tickets)      filter (where d.dia between p_desde and p_hasta), 0)               as per_tickets,
      coalesce(sum(d.ventas)       filter (where d.dia between v_ant_desde and v_ant_hasta), 0)       as per_ant,
      coalesce(sum(d.ingresos)     filter (where d.dia between p_desde and p_hasta), 0)               as ing,
      coalesce(sum(d.costo_ventas) filter (where d.dia between p_desde and p_hasta), 0)               as cos,
      coalesce(sum(d.ingresos)     filter (where d.dia between v_ant_desde and v_ant_hasta), 0)       as ing_ant,
      coalesce(sum(d.costo_ventas) filter (where d.dia between v_ant_desde and v_ant_hasta), 0)       as cos_ant,
      coalesce(bool_or(d.estimado) filter (where d.dia between p_desde and p_hasta), false)           as est
    from d
  ),
  s as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'fecha', g.dia,
             'ventas', coalesce(x.ventas, 0),
             'tickets', coalesce(x.tickets, 0),
             'ingresos', coalesce(x.ingresos, 0),
             'margen', case when v_costos
                            then round(coalesce(x.ingresos, 0) - coalesce(x.costo_ventas, 0), 2) end
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
      'ingresos', round(t.ing, 2),
      'costo', case when v_costos then round(t.cos, 2) end,
      'margen', case when v_costos then round(t.ing - t.cos, 2) end,
      'margen_pct', case when v_costos and t.ing > 0
                         then round(((t.ing - t.cos) / t.ing * 100)::numeric, 1) end,
      'anterior_margen', case when v_costos then round(t.ing_ant - t.cos_ant, 2) end,
      'anterior_margen_pct', case when v_costos and t.ing_ant > 0
                                  then round(((t.ing_ant - t.cos_ant) / t.ing_ant * 100)::numeric, 1) end,
      'estimado', t.est
    ),
    s.serie
  into v_ventas, v_margen, v_serie
  from t cross join s;

  -- ── 2. Quiebres activos AHORA (independiente del período elegido) ──
  select jsonb_build_object(
           'activos', count(*),
           'criticos_activos', count(*) filter (where p.es_critico or ult.clase = 'A')
         )
  into v_quiebres_activos
  from public.quiebres_stock q
  join public.productos p on p.id = q.producto_id
  left join lateral (
    select m.clase_abc as clase
    from public.metricas_sku_diarias m
    where m.producto_id = q.producto_id
    order by m.fecha desc
    limit 1
  ) ult on true
  where q.fin_at is null
    and p.activo
    and coalesce(p.controlar_stock, true);

  -- ── 3. Quiebres del período: horas y venta perdida RECORTADAS al período.
  --    Estimación: venta promedio de los 30 días previos al quiebre × días
  --    sin stock dentro del período × precio de venta. ──
  select jsonb_build_object(
           'eventos_periodo', count(*),
           'horas_periodo', round(coalesce(sum(
               extract(epoch from (least(coalesce(q.fin_at, now()), v_fin_ts)
                                   - greatest(q.inicio_at, v_ini_ts))) / 3600.0
             ), 0)::numeric, 1),
           'perdida_periodo', round(coalesce(sum(
               vel.unid_30d / 30.0
               * (extract(epoch from (least(coalesce(q.fin_at, now()), v_fin_ts)
                                      - greatest(q.inicio_at, v_ini_ts))) / 86400.0)
               * p.precio_venta
             ), 0)::numeric, 2)
         )
  into v_quiebres
  from public.quiebres_stock q
  join public.productos p on p.id = q.producto_id
  cross join lateral (
    select coalesce(sum(iv.cantidad), 0) as unid_30d
    from public.items_venta iv
    join public.ventas ve on ve.id = iv.venta_id
    where iv.producto_id = q.producto_id
      and ve.estado = 'completada'
      and ve.fecha >= q.inicio_at - interval '30 days'
      and ve.fecha < q.inicio_at
  ) vel
  where q.inicio_at < v_fin_ts
    and coalesce(q.fin_at, now()) > v_ini_ts
    and (q.fin_at is not null or (p.activo and coalesce(p.controlar_stock, true)));

  v_quiebres := v_quiebres || v_quiebres_activos;

  -- ── 4. Cobertura del mapeo, lotes por vencer y frescura del snapshot ──
  select jsonb_build_object(
           'productos_activos', count(*),
           'ubicados', count(*) filter (where exists (
             select 1 from public.producto_ubicacion pu
             where pu.producto_id = p.id and pu.es_principal
           ))
         )
  into v_mapeo
  from public.productos p
  where p.activo;

  select count(*)::integer
  into v_lotes
  from public.lotes l
  join public.productos p on p.id = l.producto_id
  where p.activo
    and l.estado in ('activo', 'vencido')
    and l.cantidad_actual > 0
    and l.fecha_vencimiento <= v_hoy + 7;

  select max(m.fecha) into v_ultimo_snapshot from public.metricas_sku_diarias m;

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
           'serie', v_serie,
           'quiebres', v_quiebres,
           'mapeo', v_mapeo,
           'lotes_por_vencer', v_lotes,
           'ultimo_snapshot', v_ultimo_snapshot
         )
         || public.fn_tablero_skus(p_desde, p_hasta);
end;
$$;

revoke execute on function public.fn_tablero_gerencial(date, date) from public, anon;
grant execute on function public.fn_tablero_gerencial(date, date) to authenticated;

notify pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────────
-- Verificación:
-- 1. Chequeo T1 (0 filas):
--    select proname, count(*) from pg_proc p
--    join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and proname like 'fn_%'
--    group by proname having count(*) > 1;
--
-- 2. En el SQL Editor NO se puede probar directo: no hay usuario logueado
--    y la función exige el permiso 'tablero' ("No tenés permiso").
--    Se prueba en la app, logueado como admin, entrando a /tablero.
-- ─────────────────────────────────────────────────────────────────────
