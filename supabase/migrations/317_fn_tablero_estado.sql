-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 317 · Margen neto de IVA (7/9): fn_tablero_estado        ║
-- ║                                                                     ║
-- ║  SOLO PARTICIÓN, sin cambio de lógica: las secciones 2 a 4 de       ║
-- ║  fn_tablero_gerencial v2 (mig 217: quiebres activos, quiebres del   ║
-- ║  período, cobertura del mapeo, lotes por vencer y frescura del      ║
-- ║  snapshot) pasan a este helper INTERNO, para que la 318 quede corta ║
-- ║  de pegar. Devuelve { quiebres, mapeo, lotes_por_vencer,            ║
-- ║  ultimo_snapshot } y la 318 lo concatena al resultado.              ║
-- ║  Ejecutar COMPLETA.                                                 ║
-- ╚════════════════════════════════════════════════════════════════════╝

drop function if exists public.fn_tablero_estado(date, date);

create function public.fn_tablero_estado(p_desde date, p_hasta date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_hoy date := (now() at time zone 'America/Argentina/La_Rioja')::date;
  v_ini_ts timestamptz := (p_desde::timestamp) at time zone 'America/Argentina/La_Rioja';
  v_fin_ts timestamptz := least(((p_hasta + 1)::timestamp) at time zone 'America/Argentina/La_Rioja', now());
  v_quiebres jsonb;
  v_quiebres_activos jsonb;
  v_mapeo jsonb;
  v_lotes integer;
  v_ultimo_snapshot date;
begin
  -- ── Quiebres activos AHORA (independiente del período elegido) ──
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

  -- ── Quiebres del período: horas y venta perdida RECORTADAS al período.
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

  -- ── Cobertura del mapeo, lotes por vencer y frescura del snapshot ──
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
           'quiebres', v_quiebres,
           'mapeo', v_mapeo,
           'lotes_por_vencer', v_lotes,
           'ultimo_snapshot', v_ultimo_snapshot
         );
end;
$$;

revoke execute on function public.fn_tablero_estado(date, date) from public, anon, authenticated;

notify pgrst, 'reload schema';
