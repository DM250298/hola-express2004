-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 197 · El quiebre se cuenta por DÍA, y solo si ese día    ║
-- ║  además NO se vendió nada                                           ║
-- ║                                                                     ║
-- ║  PROBLEMA (con las migs 195 y 196 ya corridas):                     ║
-- ║  quiebres_stock mide el stock del SISTEMA, no la góndola. En este   ║
-- ║  local se vende con el stock en 0 o en negativo, así que el quiebre ║
-- ║  se abre y NUNCA se cierra: un producto figura "30 de 30 días sin   ║
-- ║  stock" Y vendió 17 unidades en esos mismos 30 días. La v3 dividía  ║
-- ║  esas 17 unidades por los días NO quebrados (piso 10) → 1,700 por   ║
-- ║  día en vez de 0,567, y pedía el triple.                            ║
-- ║                                                                     ║
-- ║  ARREGLO: fn__dias_sin_stock pasa a contar DÍAS (no intervalos) y   ║
-- ║  descuenta los días en que hubo venta: si vendió, había mercadería  ║
-- ║  en la góndola y ese día SÍ pudo vender. Lo que queda es lo único   ║
-- ║  que el negocio puede llamar "no se pudo vender".                   ║
-- ║  Mismo nombre, misma firma y mismas columnas de salida → NO hay que ║
-- ║  tocar fn_sugerencias_compra: con esta sola migración el número ya  ║
-- ║  queda bien (la 198 agrega algo distinto y es opcional).            ║
-- ║                                                                     ║
-- ║  Ventas: items_venta + ventas, la fuente de verdad (la misma que ya ║
-- ║  usa la 196 para el u30), con la venta de combos acreditada a los   ║
-- ║  componentes. NO se usa metricas_sku_diarias: depende del snapshot  ║
-- ║  nocturno y un día sin correr se leería como "no vendió".           ║
-- ║                                                                     ║
-- ║  Incluye la columna de config que necesita la 198.                  ║
-- ║  REQUIERE: migs 172, 195 y 196. Ejecutar UNA sola vez, COMPLETO.    ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─── A. Umbral para volver a pedir un quebrado crónico (lo usa la 198) ──
alter table public.config_compras
  add column if not exists dias_quiebre_reposicion_minimo numeric(4,1) not null default 10
    check (dias_quiebre_reposicion_minimo >= 1);

comment on column public.config_compras.dias_quiebre_reposicion_minimo is
  'Días sin stock de los últimos 30 (contando SOLO los días en que además no
   vendió nada) a partir de los cuales un producto que ya no registra ventas
   vuelve a pedirse usando stock_minimo como piso. Lo aplica la mig 198.';

-- ─── B. fn__dias_sin_stock v2: a grano día, descontando los días con venta ──
-- Un día cuenta como "sin stock" solo si (a) el quiebre estuvo abierto aunque
-- sea un rato de ese día y (b) ese día no se vendió ni una unidad.
create or replace function public.fn__dias_sin_stock(p_dias integer default 30)
returns table (producto_id integer, dias_sin_stock numeric)
language sql
stable
security definer
set search_path = public
as $$
  with ventana as (
    select greatest(coalesce(p_dias, 30), 1) as n,
           (now() at time zone 'America/Argentina/La_Rioja')::date as hoy
  ),
  dias as (
    select (w.hoy - g)::date as dia
    from ventana w, generate_series(0, w.n - 1) as g
  ),
  quebrado as (
    -- Día con el quiebre abierto aunque sea un rato.
    select distinct q.producto_id as pid, d.dia
    from public.quiebres_stock q
    join dias d
      on q.inicio_at < ((d.dia + 1)::timestamp at time zone 'America/Argentina/La_Rioja')
     and coalesce(q.fin_at, now()) > (d.dia::timestamp at time zone 'America/Argentina/La_Rioja')
  ),
  ventas_dia as (
    select iv.producto_id as pid,
           (v.fecha at time zone 'America/Argentina/La_Rioja')::date as dia
    from public.items_venta iv
    join public.ventas v on v.id = iv.venta_id
    cross join ventana w
    where v.estado = 'completada'
      and iv.cantidad > 0
      and v.fecha >= ((w.hoy - (w.n - 1))::timestamp at time zone 'America/Argentina/La_Rioja')
  ),
  vendido as (
    -- Día en que SÍ vendió, tenga lo que tenga el sistema en stock_actual.
    -- La venta de un combo acredita el día a sus componentes (igual que el
    -- CTE `expandido` de la mig 196).
    select vd.pid, vd.dia from ventas_dia vd
    union
    select pc.componente_id, vd.dia
    from ventas_dia vd
    join public.producto_componentes pc on pc.producto_id = vd.pid
  )
  select qb.pid, count(*)::numeric
  from quebrado qb
  where not exists (
    select 1 from vendido ve where ve.pid = qb.pid and ve.dia = qb.dia
  )
  group by qb.pid
$$;

revoke execute on function public.fn__dias_sin_stock(integer) from public, anon, authenticated;

notify pgrst, 'reload schema';

-- ─── Verificación ────────────────────────────────────────────────────
-- Los que siguen figurando con muchos días sin stock tienen que tener
-- unidades_30d = 0. Si alguno muestra días altos Y unidades > 0, avisar:
-- significa que las ventas no están cayendo en los días del quiebre.
select p.nombre,
       d.dias_sin_stock as dias_quebrado_sin_vender,
       u.unidades_30d,
       p.stock_actual
from public.fn__dias_sin_stock(30) d
join public.productos p on p.id = d.producto_id
cross join lateral (
  select coalesce(sum(iv.cantidad), 0) as unidades_30d
  from public.items_venta iv
  join public.ventas v on v.id = iv.venta_id
  where iv.producto_id = p.id
    and v.estado = 'completada'
    and v.fecha >= now() - interval '30 days'
) u
where p.activo
order by d.dias_sin_stock desc, u.unidades_30d desc
limit 15;
