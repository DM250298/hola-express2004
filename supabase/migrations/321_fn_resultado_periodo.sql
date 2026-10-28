-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 321 · Finanzas › Tablero: resultado del período NETO     ║
-- ║                                                                     ║
-- ║  Hasta hoy Finanzas › Tablero (getResumenFinanciero) calculaba en   ║
-- ║  el cliente ventas CON IVA − costo ACTUAL del producto, sin restar   ║
-- ║  devoluciones: el "margen bruto" no coincidía con el margen neto    ║
-- ║  del Tablero del dueño (migs 311–320).                              ║
-- ║                                                                     ║
-- ║  `fn_resultado_periodo(p_desde, p_hasta)` devuelve en un jsonb la   ║
-- ║  suma del período de fn_ventas_diarias v2 (mig 313), que ya lee la  ║
-- ║  única fórmula (fn_items_vendidos_neto / fn_items_devueltos_neto):  ║
-- ║   · ventas_brutas  = lo cobrado, con IVA (Σ ventas.total)           ║
-- ║   · tickets        = cantidad de ventas completadas                 ║
-- ║   · ingresos       = Σ ítems vendidos, con IVA (antes de devolver)  ║
-- ║   · ventas_netas   = neto de IVA y de devoluciones                  ║
-- ║   · iva            = IVA contenido en lo vendido menos lo devuelto  ║
-- ║   · devoluciones   = bruto devuelto en el período                   ║
-- ║   · cmv            = costo congelado de lo vendido − lo devuelto    ║
-- ║   · estimado       = algún ítem sin costo congelado (usó el actual) ║
-- ║   · dias           = lo mismo por día (para la serie semanal)       ║
-- ║  Mermas, egresos, comisiones e IIBB siguen en el cliente.           ║
-- ║                                                                     ║
-- ║  SECURITY DEFINER porque fn_ventas_diarias está revocada a          ║
-- ║  authenticated; exige el permiso `finanzas` (admin = todo).         ║
-- ║  Días en hora de La Rioja, como el resto del tablero.               ║
-- ║  REQUIERE: migs 311–313. Ejecutar COMPLETA.                         ║
-- ╚════════════════════════════════════════════════════════════════════╝

drop function if exists public.fn_resultado_periodo(date, date);

create function public.fn_resultado_periodo(p_desde date, p_hasta date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_resultado jsonb;
begin
  if not public.fn_tiene_permiso('finanzas') then
    raise exception 'SIN_PERMISO: se necesita el permiso finanzas para ver el resultado del período'
      using errcode = '42501';
  end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde then
    raise exception 'RANGO_INVALIDO: desde % y hasta % no forman un período', p_desde, p_hasta
      using errcode = '22023';
  end if;

  with dias as (
    select d.dia, d.ventas, d.tickets, d.ingresos, d.ingresos_netos, d.iva,
           d.devoluciones, d.costo_ventas, d.estimado
    from public.fn_ventas_diarias(p_desde, p_hasta) d
  )
  select jsonb_build_object(
    'version', 1,
    'desde', p_desde,
    'hasta', p_hasta,
    'regimen', public.fn_regimen_iva(),
    'ventas_brutas', round(coalesce(sum(ventas), 0), 2),
    'tickets', coalesce(sum(tickets), 0)::integer,
    'ingresos', round(coalesce(sum(ingresos), 0), 2),
    'ventas_netas', round(coalesce(sum(ingresos_netos), 0), 2),
    'iva', round(coalesce(sum(iva), 0), 2),
    'devoluciones', round(coalesce(sum(devoluciones), 0), 2),
    'cmv', round(coalesce(sum(costo_ventas), 0), 2),
    'estimado', coalesce(bool_or(estimado), false),
    'dias', coalesce(
      (select jsonb_agg(jsonb_build_object(
                 'dia', x.dia,
                 'ventas', x.ventas,
                 'tickets', x.tickets,
                 'ventas_netas', x.ingresos_netos,
                 'cmv', x.costo_ventas
               ) order by x.dia)
         from dias x),
      '[]'::jsonb)
  )
  into v_resultado
  from dias;

  return v_resultado;
end;
$$;

revoke execute on function public.fn_resultado_periodo(date, date) from public, anon;
grant execute on function public.fn_resultado_periodo(date, date) to authenticated;

notify pgrst, 'reload schema';

-- Verificación (en el SQL Editor, como postgres NO pasa el permiso: usar la
-- app, o setear los claims de un admin como hace tests/test_resultado_periodo.sql):
--   select public.fn_resultado_periodo(date_trunc('month', current_date)::date, current_date);
--   Debe cumplirse: ingresos − devoluciones ≈ ventas_netas + iva.
--   Chequeo T1 (0 filas) y fila 26 de scripts/estado_pase_produccion.sql.
