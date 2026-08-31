-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 160: último movimiento de stock por producto (agregado)  ║
-- ║                                                                     ║
-- ║  Reportes › Rotación y Dead stock necesitan, por producto, la fecha ║
-- ║  del último movimiento de stock. Lo resolvían bajando               ║
-- ║  movimientos_stock ENTERO (select producto_id, created_at           ║
-- ║  order by created_at desc, sin filtro de fecha) y quedándose con la ║
-- ║  primera fila de cada producto. Con el Max Rows de PostgREST (1000) ║
-- ║  eso significa ver solo los 1000 movimientos más recientes de toda  ║
-- ║  la historia: en un autoservicio 24/7 se agotan en días, así que    ║
-- ║  casi todos los productos quedaban con "sin movimientos" y Dead     ║
-- ║  stock listaba falsos positivos (productos que se venden a diario). ║
-- ║                                                                     ║
-- ║  Paginar esa query con traerTodo() tampoco sirve: la tabla crece    ║
-- ║  sin techo (hay guarda de 500k filas) y sería bajar decenas de      ║
-- ║  miles de filas al browser por cada render del reporte.             ║
-- ║                                                                     ║
-- ║  Esta RPC agrega en la base: una fila por producto con              ║
-- ║  max(created_at). El índice movimientos_producto_idx                ║
-- ║  (producto_id, created_at desc) de schema.sql la cubre.             ║
-- ║                                                                     ║
-- ║  Igual la pagina el cliente con traerTodo(): el Max Rows corta      ║
-- ║  también las funciones que devuelven set (mismo caso que            ║
-- ║  fn_productos_a_reponer, mig 110). Por eso el ORDER BY producto_id  ║
-- ║  fijo acá adentro — es único por el GROUP BY, así que la            ║
-- ║  paginación por .range() es determinística.                         ║
-- ║                                                                     ║
-- ║  security invoker: movimientos_stock conserva su policy base de     ║
-- ║  authenticated (el cliente ya la lee directo hoy) y la función no   ║
-- ║  expone costos ni datos gateados → no hace falta definer.           ║
-- ║  search_path fijo por el advisor de la mig 152.                     ║
-- ╚════════════════════════════════════════════════════════════════════╝

drop function if exists public.fn_ultimo_movimiento_por_producto();

create function public.fn_ultimo_movimiento_por_producto()
returns table (
  producto_id integer,
  ultimo_movimiento timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select m.producto_id, max(m.created_at) as ultimo_movimiento
  from public.movimientos_stock m
  group by m.producto_id
  order by m.producto_id
$$;

revoke execute on function public.fn_ultimo_movimiento_por_producto() from public, anon;
grant execute on function public.fn_ultimo_movimiento_por_producto() to authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- Verificación post-migración (correr aparte en el SQL Editor):
--
-- a) Devuelve una fila por producto con movimientos:
--    select count(*) from public.fn_ultimo_movimiento_por_producto();
--    select count(distinct producto_id) from public.movimientos_stock;
--    -- → los dos números deben coincidir
--
-- b) La fecha es la real (elegir un producto_id cualquiera):
--    select max(created_at) from public.movimientos_stock where producto_id = N;
--    -- → igual a la fila N de la función
--
-- c) Chequeo T1 (funciones duplicadas por reissue):
--    select proname, count(*) from pg_proc p
--    join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and proname like 'fn_%'
--    group by proname having count(*) > 1;      -- → 0 filas
-- ─────────────────────────────────────────────────────────────────────

notify pgrst, 'reload schema';
