-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 212 · La ficha recupera el IVA de compra de sus facturas ║
-- ║                                                                     ║
-- ║  Reclamo: "las harinas ya las cargué varias veces al 10,5 y en la   ║
-- ║  recompra vuelven al 21". La factura propone el IVA de la FICHA     ║
-- ║  (productos.iva_compra, default 21), y la ficha recién aprende del  ║
-- ║  papel desde la mig 168; además la compra directa la pisaba con un  ║
-- ║  único IVA global. Lo cargado antes quedó solo en                   ║
-- ║  items_factura_compra.                                              ║
-- ║                                                                     ║
-- ║  1. Productos que siguen en el 21 por defecto (o con una alícuota   ║
-- ║     que no existe, ej. 22) toman la del ÚLTIMO renglón de factura   ║
-- ║     CON ORDEN de compra (no compra directa), de comprobante A/M, y  ║
-- ║     solo si esa alícuota es legal. Un producto ya corregido a mano  ║
-- ║     (distinto de 21 y legal) NO se toca.                            ║
-- ║  2. CHECK de alícuota legal en productos e items_factura_compra,    ║
-- ║     SOLO si ya no quedan valores inválidos: un CHECK sobre filas    ║
-- ║     inválidas haría fallar las ventas (que actualizan el stock del  ║
-- ║     producto). Si quedan, la migración avisa cuáles corregir.       ║
-- ║                                                                     ║
-- ║  PREVIEW (correr ANTES, no modifica nada):                          ║
-- ║    ver el bloque "preview" al final de este archivo.                ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO.                                   ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─── 1. Backfill desde el último renglón de factura con orden ────────
with ultimo as (
  select distinct on (i.producto_id)
    i.producto_id,
    i.iva_compra_porcentaje as iva
  from public.items_factura_compra i
  join public.facturas_compra f on f.id = i.factura_id
  where f.pedido_id is not null
    and coalesce(f.tipo_comprobante, 'A') in ('A', 'M')
  order by i.producto_id, f.fecha desc, f.id desc, i.id desc
)
update public.productos p
   set iva_compra = u.iva,
       updated_at = now()
  from ultimo u
 where p.id = u.producto_id
   and u.iva in (0, 2.5, 5, 10.5, 21, 27)
   and p.iva_compra is distinct from u.iva
   and (p.iva_compra = 21 or p.iva_compra not in (0, 2.5, 5, 10.5, 21, 27));

-- ─── 2. CHECK de alícuota legal (solo si los datos ya están limpios) ─
do $$
declare
  v_prod int;
  v_items int;
begin
  select count(*) into v_prod from public.productos
   where iva_compra not in (0, 2.5, 5, 10.5, 21, 27)
      or iva_venta  not in (0, 2.5, 5, 10.5, 21, 27);
  select count(*) into v_items from public.items_factura_compra
   where producto_id is not null
     and (iva_compra_porcentaje not in (0, 2.5, 5, 10.5, 21, 27)
          or iva_venta_porcentaje  not in (0, 2.5, 5, 10.5, 21, 27));

  if v_prod = 0 then
    if not exists (select 1 from pg_constraint where conname = 'productos_iva_legal') then
      alter table public.productos add constraint productos_iva_legal check (
        iva_compra in (0, 2.5, 5, 10.5, 21, 27) and iva_venta in (0, 2.5, 5, 10.5, 21, 27)
      );
    end if;
  else
    raise notice 'productos: % con alícuota inválida. Corregilos desde Configuración › Productos (ver consulta abajo) y volvé a correr este bloque DO.', v_prod;
  end if;

  if v_items = 0 then
    if not exists (select 1 from pg_constraint where conname = 'items_factura_compra_iva_legal') then
      alter table public.items_factura_compra add constraint items_factura_compra_iva_legal check (
        producto_id is null  -- línea de gasto de compra directa: IVA derivado (mig 169)
        or (iva_compra_porcentaje in (0, 2.5, 5, 10.5, 21, 27)
            and iva_venta_porcentaje in (0, 2.5, 5, 10.5, 21, 27))
      );
    end if;
  else
    -- Renglones históricos: no se corrigen solos (son lo que se cargó). El
    -- CHECK queda NOT VALID: rige para lo nuevo sin revalidar lo viejo (esta
    -- tabla no la actualizan las ventas, así que no bloquea la operación).
    if not exists (select 1 from pg_constraint where conname = 'items_factura_compra_iva_legal') then
      alter table public.items_factura_compra add constraint items_factura_compra_iva_legal check (
        producto_id is null  -- línea de gasto de compra directa: IVA derivado (mig 169)
        or (iva_compra_porcentaje in (0, 2.5, 5, 10.5, 21, 27)
            and iva_venta_porcentaje in (0, 2.5, 5, 10.5, 21, 27))
      ) not valid;
    end if;
    raise notice 'items_factura_compra: % renglones históricos con alícuota inválida (CHECK creado NOT VALID).', v_items;
  end if;
end $$;

-- ─── Preview (correr ANTES; no modifica nada) ───────────────────────
--   with ultimo as (
--     select distinct on (i.producto_id) i.producto_id, i.iva_compra_porcentaje as iva, f.fecha
--       from public.items_factura_compra i
--       join public.facturas_compra f on f.id = i.factura_id
--      where f.pedido_id is not null and coalesce(f.tipo_comprobante, 'A') in ('A', 'M')
--      order by i.producto_id, f.fecha desc, f.id desc, i.id desc)
--   select p.id, p.nombre, p.iva_compra as hoy, u.iva as pasa_a, u.fecha as factura
--     from public.productos p join ultimo u on u.producto_id = p.id
--    where u.iva in (0, 2.5, 5, 10.5, 21, 27) and p.iva_compra is distinct from u.iva
--      and (p.iva_compra = 21 or p.iva_compra not in (0, 2.5, 5, 10.5, 21, 27))
--    order by p.nombre;
--
-- Productos con alícuota inválida (después de correrla):
--   select id, nombre, iva_compra, iva_venta from public.productos
--    where iva_compra not in (0, 2.5, 5, 10.5, 21, 27)
--       or iva_venta  not in (0, 2.5, 5, 10.5, 21, 27);
--
-- Verificación: select conname, convalidated from pg_constraint
--   where conname in ('productos_iva_legal', 'items_factura_compra_iva_legal');

notify pgrst, 'reload schema';
