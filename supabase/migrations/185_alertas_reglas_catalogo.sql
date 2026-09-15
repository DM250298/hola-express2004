-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 185 · Alertas (Fase F, 3/7): lotes, precios y catálogo   ║
-- ║                                                                     ║
-- ║  fn__alertas_reglas_catalogo(p_hoy): evalúa las reglas activas      ║
-- ║   · vencimiento_proximo (por LOTE)                                  ║
-- ║   · margen_bajo  (precio ACTUAL vs costo ACTUAL: se resuelve en     ║
-- ║     cuanto se corrige el precio o el costo, no 30 días después)     ║
-- ║   · sin_costo    · sin_categoria                                    ║
-- ║  Mismo contrato que la mig 184 (tablas temporales del evaluador).   ║
-- ║  Helper INTERNO: sin grant a nadie.                                 ║
-- ║                                                                     ║
-- ║  REQUIERE: mig 183. Ejecutar UNA sola vez, COMPLETO.                ║
-- ╚════════════════════════════════════════════════════════════════════╝

create or replace function public.fn__alertas_reglas_catalogo(p_hoy date)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_par jsonb;
  v_min numeric;
  v_dias integer;
begin
  -- ── vencimiento_proximo: lotes con unidades que vencen en N días ──
  select r.parametros into v_par
  from public.reglas_alerta r where r.codigo = 'vencimiento_proximo' and r.activa;
  if found then
    v_dias := least(round(coalesce((v_par->>'dias')::numeric, 7))::integer, 3650);
    insert into pg_temp._alertas_candidatas
    select 'vencimiento_proximo', 'vencimiento_proximo:lote:' || l.id,
           'lote', l.id, l.producto_id,
           case when l.fecha_vencimiento < p_hoy then 'Ya vencidos'
                when l.fecha_vencimiento <= p_hoy + 2 then 'Vencen en 2 días o menos'
                else 'Vencen más adelante' end,
           p.nombre,
           jsonb_build_object(
             'lote_id', l.id,
             'fecha_vencimiento', l.fecha_vencimiento,
             'dias_para_vencer', l.fecha_vencimiento - p_hoy,
             'cantidad', l.cantidad_actual,
             'valor', round(l.cantidad_actual * coalesce(public.fn_costo(p.id), 0), 2),
             'venta_por_peso', coalesce(p.venta_por_peso, false)
           ),
           round(l.cantidad_actual * coalesce(public.fn_costo(p.id), 0), 2)
    from public.lotes l
    join public.productos p on p.id = l.producto_id
    where p.activo
      and l.estado in ('activo', 'vencido')
      and l.cantidad_actual > 0
      and l.fecha_vencimiento <= p_hoy + v_dias;
  end if;

  -- ── margen_bajo: el precio de hoy deja menos margen que el mínimo ──
  select r.parametros into v_par
  from public.reglas_alerta r where r.codigo = 'margen_bajo' and r.activa;
  if found then
    v_min := least(coalesce((v_par->>'margen_minimo_pct')::numeric, 0), 95);
    insert into pg_temp._alertas_candidatas
    select 'margen_bajo', 'margen_bajo:producto:' || x.producto_id,
           'producto', x.producto_id, x.producto_id,
           coalesce(x.categoria, 'Sin categoría'), x.nombre,
           jsonb_build_object(
             'precio_venta', x.precio_venta,
             'costo_actual', x.costo,
             'margen_pct', round(x.margen_pct, 1),
             'unidades_30d', x.unidades,
             'ingresos', x.ingresos
           ),
           -- lo que faltó ganar en 30 días para llegar al margen mínimo
           round(greatest(x.costo / (1 - v_min / 100) - x.precio_venta, 0) * x.unidades, 2)
    from (
      select s.*,
             (s.precio_venta - s.costo) / nullif(s.precio_venta, 0) * 100 as margen_pct
      from pg_temp._alertas_skus s
      where s.ingresos > 0 and s.costo > 0 and s.precio_venta > 0
    ) x
    where x.margen_pct < v_min;
  end if;

  -- ── sin_costo: se vende y no tiene costo cargado ──
  select r.parametros into v_par
  from public.reglas_alerta r where r.codigo = 'sin_costo' and r.activa;
  if found then
    insert into pg_temp._alertas_candidatas
    select 'sin_costo', 'sin_costo:producto:' || s.producto_id,
           'producto', s.producto_id, s.producto_id,
           coalesce(s.categoria, 'Sin categoría'), s.nombre,
           jsonb_build_object('ingresos', s.ingresos, 'unidades_30d', s.unidades),
           s.ingresos
    from pg_temp._alertas_skus s
    where s.stockeable
      and s.ingresos > 0
      and coalesce(s.costo, 0) = 0;
  end if;

  -- ── sin_categoria: se vende y no tiene categoría (agrupa por proveedor) ──
  select r.parametros into v_par
  from public.reglas_alerta r where r.codigo = 'sin_categoria' and r.activa;
  if found then
    insert into pg_temp._alertas_candidatas
    select 'sin_categoria', 'sin_categoria:producto:' || s.producto_id,
           'producto', s.producto_id, s.producto_id,
           coalesce(s.proveedor, 'Sin proveedor'), s.nombre,
           jsonb_build_object('ingresos', s.ingresos, 'unidades_30d', s.unidades),
           s.ingresos
    from pg_temp._alertas_skus s
    where s.ingresos > 0
      and not s.tiene_categoria;
  end if;
end;
$$;

revoke execute on function public.fn__alertas_reglas_catalogo(date) from public, anon, authenticated;

notify pgrst, 'reload schema';

-- Verificación (debe dar true):
select to_regprocedure('public.fn__alertas_reglas_catalogo(date)') is not null as creada;
