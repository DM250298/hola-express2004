-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 174 · Fix: fn_snapshot_metricas_diarias con fn_costo NULL║
-- ║                                                                     ║
-- ║  BUG (detectado al correr la 173 en PRUEBA): fn_costo() (mig 051)   ║
-- ║  devuelve NULL —no 0— cuando el producto NO tiene fila en           ║
-- ║  costos_producto: el coalesce interno cubre el valor de la columna, ║
-- ║  no la ausencia de fila. Un producto sin costo cargado hace que     ║
-- ║  costo_unitario llegue NULL al INSERT y reviente el NOT NULL:       ║
-- ║    23502: null value in column "costo_unitario" …                   ║
-- ║                                                                     ║
-- ║  FIX: coalesce(fn_costo(...), 0) en los DOS usos dentro del         ║
-- ║  snapshot (el fallback de costo_ventas y el costo_unitario final).  ║
-- ║  costo 0 en el snapshot = "sin costo cargado ese día" (la fila      ║
-- ║  además queda costo_estimado si el ítem no tenía satélite).         ║
-- ║  Reissue de la función COMPLETA, misma firma → create or replace.   ║
-- ║                                                                     ║
-- ║  types/database.ts: sin cambios (firma y retorno intactos).         ║
-- ║  REQUIERE: mig 173. Ejecutar UNA sola vez, COMPLETO.                ║
-- ╚════════════════════════════════════════════════════════════════════╝

create or replace function public.fn_snapshot_metricas_diarias(p_fecha date default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hoy_local date := (now() at time zone 'America/Argentina/La_Rioja')::date;
  v_fecha date;
  v_ini timestamptz;
  v_fin timestamptz;
  v_ini_30 timestamptz;
  v_filas integer := 0;
begin
  v_fecha := coalesce(p_fecha, v_hoy_local - 1);
  if v_fecha >= v_hoy_local then
    raise exception 'Solo se puede snapshotear un día ya terminado (pedido: %).', v_fecha;
  end if;

  -- Rango del día LOCAL como timestamptz (mismo criterio de zona que
  -- vista_cobertura_stock, mig 060/062).
  v_ini    := (v_fecha::timestamp)        at time zone 'America/Argentina/La_Rioja';
  v_fin    := ((v_fecha + 1)::timestamp)  at time zone 'America/Argentina/La_Rioja';
  v_ini_30 := ((v_fecha - 29)::timestamp) at time zone 'America/Argentina/La_Rioja';

  delete from public.metricas_sku_diarias where fecha = v_fecha;

  insert into public.metricas_sku_diarias (
    fecha, producto_id, unidades_vendidas, unidades_via_combo, ingresos,
    costo_ventas, stock_fin_dia, costo_unitario, precio_venta, clase_abc,
    gondola_id, costo_estimado
  )
  with dia as (
    -- Ítems vendidos del día, con el costo congelado si existe y el flag
    -- de control de stock (los sin control no suman CMV → fallback 0).
    select
      iv.producto_id,
      iv.cantidad,
      coalesce(iv.subtotal, iv.cantidad * iv.precio_unitario) as ingreso,
      civ.costo_unitario as costo_congelado,
      coalesce(p.controlar_stock, true) as controla,
      exists (
        select 1 from public.producto_componentes pc where pc.producto_id = iv.producto_id
      ) as es_combo
    from public.items_venta iv
    join public.ventas v on v.id = iv.venta_id
    join public.productos p on p.id = iv.producto_id
    left join public.costos_item_venta civ on civ.item_venta_id = iv.id
    where v.estado = 'completada' and v.fecha >= v_ini and v.fecha < v_fin
  ),
  directo as (
    select
      d.producto_id,
      sum(d.cantidad) as unidades,
      sum(d.ingreso) as ingresos,
      -- Costo: congelado si hay satélite; si no, costo actual para los que
      -- controlan stock (v174: fn_costo envuelto en coalesce — devuelve
      -- NULL si el producto no tiene fila en costos_producto) y 0 para
      -- los sin control (su CMV real fue 0, espejo del asiento).
      sum(d.cantidad * coalesce(
        d.costo_congelado,
        case when d.controla or d.es_combo
             then coalesce(public.fn_costo(d.producto_id), 0) else 0 end
      )) as costo_ventas,
      bool_or(d.costo_congelado is null and (d.controla or d.es_combo)) as estimado
    from dia d
    group by d.producto_id
  ),
  via_combo as (
    -- La venta de un combo acredita velocity a sus componentes (mismo
    -- criterio que el CTE expandido de la mig 152). No suma ingresos.
    select pc.componente_id as producto_id,
           sum(d.cantidad * pc.cantidad) as unidades
    from dia d
    join public.producto_componentes pc on pc.producto_id = d.producto_id
    group by pc.componente_id
  ),
  mov_post as (
    -- Delta neto de stock POSTERIOR al cierre del día: stock_fin_dia =
    -- stock_actual − delta (versión SQL de getEvolucionStock).
    select ms.producto_id, sum(ms.stock_nuevo - ms.stock_anterior) as delta
    from public.movimientos_stock ms
    where ms.created_at >= v_fin
    group by ms.producto_id
  ),
  ventas30 as (
    select iv.producto_id,
           sum(coalesce(iv.subtotal, iv.cantidad * iv.precio_unitario)) as ingreso
    from public.items_venta iv
    join public.ventas v on v.id = iv.venta_id
    where v.estado = 'completada' and v.fecha >= v_ini_30 and v.fecha < v_fin
    group by iv.producto_id
    having sum(coalesce(iv.subtotal, iv.cantidad * iv.precio_unitario)) > 0
  ),
  abc as (
    -- Misma fórmula que la pantalla de ranking y la mig 152: acumulado de
    -- ingresos desc, A hasta 80 %, B hasta 95 %, C el resto.
    select t.producto_id,
           case when t.acum <= 0.80 then 'A'
                when t.acum <= 0.95 then 'B'
                else 'C' end as clase
    from (
      select v30.producto_id,
             sum(v30.ingreso) over (order by v30.ingreso desc, v30.producto_id)
               / nullif(sum(v30.ingreso) over (), 0) as acum
      from ventas30 v30
    ) t
  ),
  gondola as (
    -- Ancestro tipo 'gondola' (o el nodo mismo) de la ubicación principal.
    select pu.producto_id, g.id as gondola_id
    from public.producto_ubicacion pu
    join lateral (
      with recursive cadena as (
        select u.id, u.parent_id, u.tipo
        from public.ubicaciones u where u.id = pu.ubicacion_id
        union all
        select u2.id, u2.parent_id, u2.tipo
        from public.ubicaciones u2
        join cadena c on c.parent_id = u2.id
      )
      select cadena.id from cadena where cadena.tipo = 'gondola' limit 1
    ) g on true
    where pu.es_principal
  )
  select
    v_fecha,
    p.id,
    coalesce(d.unidades, 0),
    coalesce(vc.unidades, 0),
    round(coalesce(d.ingresos, 0), 2),
    round(coalesce(d.costo_ventas, 0), 2),
    p.stock_actual - coalesce(mp.delta, 0),
    coalesce(public.fn_costo(p.id), 0),  -- v174: sin fila en costos_producto → 0
    p.precio_venta,
    a.clase,
    g.gondola_id,
    coalesce(d.estimado, false)
  from public.productos p
  left join directo d   on d.producto_id  = p.id
  left join via_combo vc on vc.producto_id = p.id
  left join mov_post mp on mp.producto_id = p.id
  left join abc a       on a.producto_id  = p.id
  left join gondola g   on g.producto_id  = p.id
  -- Activos + cualquier producto que VENDIÓ ese día aunque hoy esté
  -- desactivado: si no, re-correr el snapshot después de desactivar un SKU
  -- borraría sus ventas del día y los totales dejarían de cuadrar.
  where p.activo or d.producto_id is not null or vc.producto_id is not null;

  get diagnostics v_filas = row_count;

  -- Congela la estimación de venta perdida de los quiebres CERRADOS en el
  -- día: velocity de los 30 días previos al inicio × duración en días, a
  -- precio de venta vigente. SIEMPRE es una estimación (así se etiqueta).
  update public.quiebres_stock q
     set venta_perdida_unid  = round(calc.unid, 3),
         venta_perdida_pesos = round(calc.unid * calc.precio, 2)
    from (
      select q2.id,
             (
               select coalesce(sum(iv.cantidad), 0)
               from public.items_venta iv
               join public.ventas ve on ve.id = iv.venta_id
               where iv.producto_id = q2.producto_id
                 and ve.estado = 'completada'
                 and ve.fecha >= q2.inicio_at - interval '30 days'
                 and ve.fecha <  q2.inicio_at
             ) / 30.0
               * (extract(epoch from q2.fin_at - q2.inicio_at) / 86400.0) as unid,
             p.precio_venta as precio
      from public.quiebres_stock q2
      join public.productos p on p.id = q2.producto_id
      where q2.fin_at >= v_ini and q2.fin_at < v_fin
        and q2.venta_perdida_unid is null
    ) calc
   where calc.id = q.id;

  return v_filas;
end;
$$;

-- Reload PostgREST schema cache.
notify pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────────
-- Verificación post-migración:
--
-- 1. Chequeo T1 (0 filas):
--    select proname, count(*) from pg_proc p
--    join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and proname like 'fn_%'
--    group by proname having count(*) > 1;
--
-- 2. El snapshot ya no revienta con productos sin costo cargado:
--    select public.fn_snapshot_metricas_diarias();
--
-- 3. Los productos sin costo quedan con costo_unitario = 0:
--    select count(*) from public.metricas_sku_diarias m
--    where m.fecha = (now() at time zone 'America/Argentina/La_Rioja')::date - 1
--      and m.costo_unitario = 0;
-- ─────────────────────────────────────────────────────────────────────
