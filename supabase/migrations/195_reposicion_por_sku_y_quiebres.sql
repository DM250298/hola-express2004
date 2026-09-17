-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 195 · Fase G (1/2): parámetros por SKU + días sin stock  ║
-- ║                                                                     ║
-- ║  Dos piezas para que el sugerido deje de sub-comprar lo que más se  ║
-- ║  quiebra (la función v3 que las usa va en la mig 196):              ║
-- ║                                                                     ║
-- ║  A. ESCALÓN POR PRODUCTO en la cascada de reposición. Hoy es        ║
-- ║     proveedor → global (mig 151); pasa a ser SKU → proveedor →      ║
-- ║     global. NULL en el producto = sigue mandando el proveedor, así  ║
-- ║     que nada cambia hasta que alguien cargue un valor.              ║
-- ║     Además stock_objetivo_manual: un piso fijo en unidades para     ║
-- ║     los que siempre tienen que estar en góndola, aunque la fórmula  ║
-- ║     diga menos.                                                     ║
-- ║                                                                     ║
-- ║  B. fn__dias_sin_stock: cuántos días de la ventana estuvo QUEBRADO  ║
-- ║     cada producto, desde quiebres_stock (mig 172). Con eso la v3    ║
-- ║     divide las ventas por los días en que REALMENTE se pudo vender. ║
-- ║     Un producto que vendió 30 unidades en 18 días con stock vende   ║
-- ║     1,7 por día, no 1: comprarle por 1 es garantizar que se vuelva  ║
-- ║     a quebrar.                                                      ║
-- ║     El tope de corrección (config_compras) evita que un producto    ║
-- ║     casi siempre quebrado pida una compra disparatada.              ║
-- ║                                                                     ║
-- ║  Todo aditivo: solo ADD COLUMN IF NOT EXISTS y una función nueva.   ║
-- ║  No toca fn_sugerencias_compra (eso es la 196).                     ║
-- ║  Después: types/database.ts (Producto* con las 3 columnas nuevas).  ║
-- ║  REQUIERE: migs 151, 152 y 172. Ejecutar UNA sola vez, COMPLETO.    ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─── A. Parámetros de reposición por producto ────────────────────────
alter table public.productos
  add column if not exists dias_cobertura_objetivo numeric(6,1)
    check (dias_cobertura_objetivo is null or dias_cobertura_objetivo > 0),
  add column if not exists dias_seguridad numeric(6,1)
    check (dias_seguridad is null or dias_seguridad >= 0),
  add column if not exists stock_objetivo_manual numeric(12,3)
    check (stock_objetivo_manual is null or stock_objetivo_manual >= 0);

comment on column public.productos.dias_cobertura_objetivo is
  'Días de venta a dejar cubiertos al reponer ESTE producto. NULL = usa el
   del proveedor y, si tampoco tiene, el default global. Primer escalón de
   la cascada SKU → proveedor → global.';
comment on column public.productos.dias_seguridad is
  'Colchón en días del punto de reposición para ESTE producto. NULL = cascada.';
comment on column public.productos.stock_objetivo_manual is
  'Piso fijo en unidades: el sugerido nunca deja el stock objetivo por debajo
   de este valor (exhibición mínima en góndola). NULL = solo la fórmula.';

-- ─── Tope de la corrección por quiebres ──────────────────────────────
alter table public.config_compras
  add column if not exists factor_maximo_correccion_quiebre numeric(4,1) not null default 3
    check (factor_maximo_correccion_quiebre >= 1);

comment on column public.config_compras.factor_maximo_correccion_quiebre is
  'Cuánto puede como máximo multiplicarse la venta diaria al corregirla por
   días sin stock. 3 = aunque haya estado quebrado 25 de 30 días, se le
   reconoce hasta el triple de velocidad. 1 = desactiva la corrección.';

-- ─── B. Días sin stock por producto dentro de la ventana ─────────────
-- Suma la intersección de cada quiebre con los últimos p_dias. Un quiebre
-- abierto se cuenta hasta ahora. Helper INTERNO de fn_sugerencias_compra.
create or replace function public.fn__dias_sin_stock(p_dias integer default 30)
returns table (producto_id integer, dias_sin_stock numeric)
language sql
stable
security definer
set search_path = public
as $$
  with ventana as (
    select now() - make_interval(days => greatest(coalesce(p_dias, 30), 1)) as ini,
           now() as fin
  )
  select
    q.producto_id,
    round(greatest(sum(
      extract(epoch from
        least(coalesce(q.fin_at, v.fin), v.fin) - greatest(q.inicio_at, v.ini)
      ) / 86400.0
    ), 0)::numeric, 2) as dias_sin_stock
  from public.quiebres_stock q
  cross join ventana v
  where q.inicio_at < v.fin
    and coalesce(q.fin_at, v.fin) > v.ini
  group by q.producto_id
$$;

revoke execute on function public.fn__dias_sin_stock(integer) from public, anon, authenticated;

notify pgrst, 'reload schema';

-- Verificación (las 3 columnas nuevas, el tope y la función):
select
  (select count(*) from information_schema.columns
   where table_schema = 'public' and table_name = 'productos'
     and column_name in ('dias_cobertura_objetivo', 'dias_seguridad',
                         'stock_objetivo_manual')) as columnas_producto,
  (select count(*) from information_schema.columns
   where table_schema = 'public' and table_name = 'config_compras'
     and column_name = 'factor_maximo_correccion_quiebre') as tope_config,
  to_regprocedure('public.fn__dias_sin_stock(integer)') is not null as funcion;
