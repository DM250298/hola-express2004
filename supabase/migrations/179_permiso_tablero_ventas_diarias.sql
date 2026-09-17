-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 179 · Tablero del dueño (1/3): permiso + ventas diarias  ║
-- ║                                                                     ║
-- ║  1. Permiso 'tablero' para el rol admin (patrón mig 082). El admin  ║
-- ║     ya lo tiene por hardcode en fn_tiene_permiso, pero tiene que    ║
-- ║     estar en roles.permisos para que el sidebar y el middleware lo  ║
-- ║     muestren. A otros roles (gerencia/administración) se les asigna ║
-- ║     desde Configuración › Usuarios.                                 ║
-- ║                                                                     ║
-- ║  2. fn_ventas_diarias(p_desde, p_hasta): por día LOCAL, ventas      ║
-- ║     (ventas.total), tickets, ingresos por ítem y costo de lo        ║
-- ║     vendido (costo congelado de la mig 171, fallback costo actual   ║
-- ║     marcado como estimado). Helper INTERNO: sin grant a             ║
-- ║     authenticated — solo la llaman RPCs security definer (el        ║
-- ║     tablero), igual que fn_costo desde la mig 161.                  ║
-- ║                                                                     ║
-- ║  REQUIERE: migs 171. Ejecutar UNA sola vez, COMPLETO.               ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────────────────────
-- 1. Permiso 'tablero' para admin (idempotente)
-- ─────────────────────────────────────────────────────────────────────
do $$ begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'roles'
  ) then
    update public.roles
    set permisos = array_append(permisos, 'tablero'),
        updated_at = now()
    where codigo = 'admin'
      and not ('tablero' = any(permisos));
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 2. fn_ventas_diarias
-- ─────────────────────────────────────────────────────────────────────
drop function if exists public.fn_ventas_diarias(date, date);

create function public.fn_ventas_diarias(p_desde date, p_hasta date)
returns table (
  dia date,
  ventas numeric,
  tickets integer,
  ingresos numeric,
  costo_ventas numeric,
  estimado boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with rango as (
    select
      (p_desde::timestamp) at time zone 'America/Argentina/La_Rioja' as ini,
      ((p_hasta + 1)::timestamp) at time zone 'America/Argentina/La_Rioja' as fin
  ),
  cab as (
    select (v.fecha at time zone 'America/Argentina/La_Rioja')::date as d,
           sum(v.total) as ventas,
           count(*)::integer as tickets
    from public.ventas v
    cross join rango r
    where v.estado = 'completada' and v.fecha >= r.ini and v.fecha < r.fin
    group by 1
  ),
  it as (
    select (v.fecha at time zone 'America/Argentina/La_Rioja')::date as d,
           sum(coalesce(iv.subtotal, iv.cantidad * iv.precio_unitario)) as ingresos,
           sum(iv.cantidad * coalesce(
             civ.costo_unitario,
             case when coalesce(p.controlar_stock, true) or cb.es_combo
                  then coalesce(public.fn_costo(iv.producto_id), 0) else 0 end
           )) as costo,
           bool_or(civ.item_venta_id is null
                   and (coalesce(p.controlar_stock, true) or cb.es_combo)) as estimado
    from public.items_venta iv
    join public.ventas v on v.id = iv.venta_id
    join public.productos p on p.id = iv.producto_id
    left join public.costos_item_venta civ on civ.item_venta_id = iv.id
    cross join lateral (
      select exists (
        select 1 from public.producto_componentes x where x.producto_id = iv.producto_id
      ) as es_combo
    ) cb
    cross join rango r
    where v.estado = 'completada' and v.fecha >= r.ini and v.fecha < r.fin
    group by 1
  )
  select
    coalesce(c.d, i.d),
    coalesce(c.ventas, 0),
    coalesce(c.tickets, 0),
    round(coalesce(i.ingresos, 0), 2),
    round(coalesce(i.costo, 0), 2),
    coalesce(i.estimado, false)
  from cab c
  full join it i on i.d = c.d
  order by 1
$$;

revoke execute on function public.fn_ventas_diarias(date, date) from public, anon, authenticated;

notify pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────────
-- Verificación (como admin del SQL Editor, que es postgres):
--   select 'tablero' = any(permisos) from public.roles where codigo = 'admin';
--     → true
--   select * from public.fn_ventas_diarias(current_date - 7, current_date);
--     → 1 fila por día con ventas ≈ lo que muestra el dashboard.
-- ─────────────────────────────────────────────────────────────────────
