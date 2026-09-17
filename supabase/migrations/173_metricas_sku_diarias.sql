-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 173 · Snapshot diario de métricas por SKU + fn_quiebres  ║
-- ║                                                                     ║
-- ║  La tabla que resuelve de un saque lo NO reconstruible: stock       ║
-- ║  valorizado histórico, evolución de margen, historia de precio, de  ║
-- ║  clase ABC y de ubicación (todas fuentes que se PISAN).             ║
-- ║                                                                     ║
-- ║  REGLA "no guardar lo calculable": NO se persisten margen           ║
-- ║  (= ingresos − costo_ventas), valor de stock (= stock_fin_dia ×     ║
-- ║  costo_unitario) ni cobertura. Las excepciones (costo_unitario,     ║
-- ║  precio_venta, clase_abc, gondola_id) se guardan porque sus         ║
-- ║  fuentes se pisan y NO son reconstruibles hacia atrás.              ║
-- ║                                                                     ║
-- ║  EJECUCIÓN: Vercel Cron (patrón cierre-diario) →                    ║
-- ║  /api/cron/snapshot-diario → fn_snapshot_metricas_diarias(AYER).    ║
-- ║  Idempotente por fecha (delete + insert) → re-ejecutable a mano.    ║
-- ║  fn_backfill_metricas_diarias rellena huecos y permite arrancar     ║
-- ║  con 90 días de historia aproximada (costo_estimado = true).        ║
-- ║                                                                     ║
-- ║  REQUIERE: migs 170 (ubicaciones), 171 (costos_item_venta) y 172    ║
-- ║  (quiebres_stock) corridas.                                         ║
-- ║  Después de correrla, actualizar types/database.ts:                 ║
-- ║   · Tables: metricas_sku_diarias                                    ║
-- ║   · Functions: fn_snapshot_metricas_diarias,                        ║
-- ║     fn_backfill_metricas_diarias, fn_quiebres                       ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────────────────────
-- 1. Índice por fecha en el kardex. El snapshot reconstruye el stock al
--    cierre del día restando los movimientos POSTERIORES; sin índice por
--    created_at cada corrida barre la tabla entera (500k de guarda).
-- ─────────────────────────────────────────────────────────────────────
create index if not exists movimientos_created_idx
  on public.movimientos_stock (created_at desc);

-- ─────────────────────────────────────────────────────────────────────
-- 2. Tabla snapshot
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.metricas_sku_diarias (
  fecha              date not null,
  producto_id        integer not null references public.productos(id) on delete cascade,
  unidades_vendidas  numeric(12,3) not null default 0,
  unidades_via_combo numeric(12,3) not null default 0,
  ingresos           numeric(14,2) not null default 0,
  costo_ventas       numeric(14,2) not null default 0,
  stock_fin_dia      numeric(12,3) not null default 0,
  costo_unitario     numeric(12,4) not null default 0,
  precio_venta       numeric(12,2) not null default 0,
  clase_abc          char(1),
  gondola_id         integer references public.ubicaciones(id) on delete set null,
  costo_estimado     boolean not null default false,
  primary key (fecha, producto_id)
);

comment on table public.metricas_sku_diarias is
  'Snapshot diario por SKU (productos activos), al cierre del día LOCAL
   (America/Argentina/La_Rioja). unidades_vendidas/ingresos = venta DIRECTA
   del SKU (el combo factura como combo); unidades_via_combo = atribuidas
   como componente (velocity real, no suma ingresos → sin doble conteo).
   costo_ventas usa el costo congelado de costos_item_venta con fallback al
   costo actual (costo_estimado = true). Derivados que NO se guardan:
   margen = ingresos − costo_ventas · valor stock = stock_fin_dia ×
   costo_unitario · cobertura = stock / promedio.';
comment on column public.metricas_sku_diarias.clase_abc is
  'Clase ABC del día (ventana 30 días de ingresos, umbrales 80/95 — misma
   fórmula que la mig 152). NULL = sin ingresos en la ventana.';
comment on column public.metricas_sku_diarias.gondola_id is
  'Góndola (ancestro tipo gondola de la ubicación principal) VIGENTE al
   snapshotear: da la historia de ubicación gratis, con grano día.';
comment on column public.metricas_sku_diarias.costo_estimado is
  'true = el costo de ventas de este día usa costo actual retro-aplicado
   (backfill o ítems sin satélite) — mostrar badge "estimado" en UI.';

create index if not exists metricas_sku_prod_idx
  on public.metricas_sku_diarias(producto_id, fecha desc);

-- RLS: contiene costos → lectura directa solo con permiso 'costos'. Las
-- vistas para el resto de los roles llegarán vía RPCs definer con gate
-- inline (fases C/D).
alter table public.metricas_sku_diarias enable row level security;
drop policy if exists "metricas_sku_select" on public.metricas_sku_diarias;
create policy "metricas_sku_select" on public.metricas_sku_diarias
  for select to authenticated
  using ((select public.fn_tiene_permiso('costos')));
-- Sin policy de escritura: escribe solo fn_snapshot_metricas_diarias.

-- ─────────────────────────────────────────────────────────────────────
-- 3. fn_snapshot_metricas_diarias(p_fecha) — idempotente por fecha.
--    Devuelve la cantidad de filas insertadas.
-- ─────────────────────────────────────────────────────────────────────
drop function if exists public.fn_snapshot_metricas_diarias(date);

create function public.fn_snapshot_metricas_diarias(p_fecha date default null)
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
      -- controlan stock (los combos sin satélite caen a fn_costo del combo,
      -- normalmente 0 → queda marcado estimado) y 0 para los sin control
      -- (su CMV real fue 0, espejo del asiento).
      sum(d.cantidad * coalesce(
        d.costo_congelado,
        case when d.controla or d.es_combo then public.fn_costo(d.producto_id) else 0 end
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
    public.fn_costo(p.id),
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

-- ─────────────────────────────────────────────────────────────────────
-- 4. fn_backfill_metricas_diarias — rellena un rango (huecos del cron o
--    arranque con historia). Ventas/unidades/stock son EXACTOS; el costo
--    de los días previos a la mig 171 queda con costo actual y
--    costo_estimado = true (decisión explícita: no se interpola
--    historial_costos — frágil e incompleto).
-- ─────────────────────────────────────────────────────────────────────
drop function if exists public.fn_backfill_metricas_diarias(date, date);

create function public.fn_backfill_metricas_diarias(p_desde date, p_hasta date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hoy_local date := (now() at time zone 'America/Argentina/La_Rioja')::date;
  v_fecha date;
  v_total integer := 0;
begin
  if p_desde is null or p_hasta is null or p_desde > p_hasta then
    raise exception 'Rango inválido: % a %.', p_desde, p_hasta;
  end if;
  if p_hasta >= v_hoy_local then
    raise exception 'Solo se pueden backfillear días ya terminados.';
  end if;
  if p_hasta - p_desde > 400 then
    raise exception 'Rango demasiado grande (máx. 400 días por corrida).';
  end if;

  v_fecha := p_desde;
  while v_fecha <= p_hasta loop
    v_total := v_total + public.fn_snapshot_metricas_diarias(v_fecha);
    v_fecha := v_fecha + 1;
  end loop;

  return v_total;
end;
$$;

-- Solo el servidor (cron con service_role) ejecuta el snapshot/backfill.
revoke execute on function public.fn_snapshot_metricas_diarias(date) from public, anon, authenticated;
revoke execute on function public.fn_backfill_metricas_diarias(date, date) from public, anon, authenticated;
grant execute on function public.fn_snapshot_metricas_diarias(date) to service_role;
grant execute on function public.fn_backfill_metricas_diarias(date, date) to service_role;

-- ─────────────────────────────────────────────────────────────────────
-- 5. fn_quiebres — lectura de eventos con duración y estimación al vuelo
--    para los abiertos. No expone costos (la estimación usa precio de
--    venta, visible para todos) → grant a authenticated.
--    ORDER BY determinístico para traerTodo() (gotcha migs 104/151).
-- ─────────────────────────────────────────────────────────────────────
drop function if exists public.fn_quiebres(date, date, boolean);

create function public.fn_quiebres(
  p_desde date default null,
  p_hasta date default null,
  p_solo_abiertos boolean default false
)
returns table (
  id integer,
  producto_id integer,
  nombre text,
  codigo_barras text,
  venta_por_peso boolean,
  inicio_at timestamptz,
  fin_at timestamptz,
  abierto boolean,
  duracion_horas numeric,
  venta_perdida_unid numeric,
  venta_perdida_pesos numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    q.id,
    q.producto_id,
    p.nombre::text,
    p.codigo_barras::text,
    coalesce(p.venta_por_peso, false),
    q.inicio_at,
    q.fin_at,
    (q.fin_at is null) as abierto,
    round((extract(epoch from coalesce(q.fin_at, now()) - q.inicio_at) / 3600.0)::numeric, 1)
      as duracion_horas,
    coalesce(
      q.venta_perdida_unid,
      round((vel.unid_30d / 30.0
        * (extract(epoch from coalesce(q.fin_at, now()) - q.inicio_at) / 86400.0))::numeric, 3)
    ) as venta_perdida_unid,
    coalesce(
      q.venta_perdida_pesos,
      round((vel.unid_30d / 30.0
        * (extract(epoch from coalesce(q.fin_at, now()) - q.inicio_at) / 86400.0)
        * p.precio_venta)::numeric, 2)
    ) as venta_perdida_pesos
  from public.quiebres_stock q
  join public.productos p on p.id = q.producto_id
  cross join lateral (
    select coalesce(sum(iv.cantidad), 0) as unid_30d
    from public.items_venta iv
    join public.ventas ve on ve.id = iv.venta_id
    where iv.producto_id = q.producto_id
      and ve.estado = 'completada'
      and ve.fecha >= q.inicio_at - interval '30 days'
      and ve.fecha <  q.inicio_at
  ) vel
  -- Un quiebre ABIERTO de un producto desactivado o sin control de stock es
  -- ruido eterno (nunca llega el movimiento que lo cierre): se oculta. Los
  -- CERRADOS son historia legítima y se muestran siempre.
  where (q.fin_at is not null or (p.activo and coalesce(p.controlar_stock, true)))
    and (not p_solo_abiertos or q.fin_at is null)
    and (p_desde is null or coalesce(q.fin_at, now()) >= (p_desde::timestamp) at time zone 'America/Argentina/La_Rioja')
    and (p_hasta is null or q.inicio_at < ((p_hasta + 1)::timestamp) at time zone 'America/Argentina/La_Rioja')
  order by (q.fin_at is null) desc, q.inicio_at desc, q.id
$$;

revoke execute on function public.fn_quiebres(date, date, boolean) from public, anon;
grant execute on function public.fn_quiebres(date, date, boolean) to authenticated;

-- Reload PostgREST schema cache.
notify pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────────
-- Verificación post-migración:
--
-- 1. Chequeo T1 de funciones duplicadas (debe dar 0 filas):
--    select proname, count(*) from pg_proc p
--    join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and proname like 'fn_%'
--    group by proname having count(*) > 1;
--
-- 2. Snapshot de ayer a mano (como service_role en el SQL Editor):
--    select public.fn_snapshot_metricas_diarias();
--    select count(*), sum(ingresos), sum(stock_fin_dia * costo_unitario)
--    from public.metricas_sku_diarias
--    where fecha = (now() at time zone 'America/Argentina/La_Rioja')::date - 1;
--    → count ≈ productos activos; ingresos ≈ ventas de ayer.
--
-- 3. Backfill de arranque (90 días, una sola vez — tarda unos minutos):
--    select public.fn_backfill_metricas_diarias(
--      (now() at time zone 'America/Argentina/La_Rioja')::date - 90,
--      (now() at time zone 'America/Argentina/La_Rioja')::date - 1);
--
-- 4. Quiebres visibles:  select * from public.fn_quiebres(null, null, true);
--
-- 5. Idempotencia: correr el paso 2 dos veces → mismo count, sin duplicar.
-- ─────────────────────────────────────────────────────────────────────
