-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 311 · Margen neto de IVA (1/9): alícuota en la venta     ║
-- ║                                                                     ║
-- ║  El margen del Tablero del dueño comparaba ventas CON IVA contra    ║
-- ║  costo SIN IVA. Para descontar el IVA ítem por ítem hace falta la   ║
-- ║  alícuota que tenía el producto al venderse: se guarda en           ║
-- ║  items_venta.iva_venta (la completa un trigger desde                ║
-- ║  productos.iva_venta; fn_crear_venta no se toca). El histórico se   ║
-- ║  rellena con la alícuota actual de cada producto.                   ║
-- ║                                                                     ║
-- ║  También unifica el régimen: PantallaFiscal guardaba 'monotributo'  ║
-- ║  y el motor de precios (migs 109/125) compara con 'monotributista', ║
-- ║  así que trataba a un monotributista como responsable inscripto.    ║
-- ║  fn_regimen_iva() es el helper que leen las funciones nuevas.       ║
-- ║                                                                     ║
-- ║  Los números 306–310 están reservados por la rama                   ║
-- ║  conteo-parcial-ciclico (PR pendiente). Ejecutar COMPLETA; última   ║
-- ║  línea: notify pgrst, 'reload schema';                              ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────────────────────
-- 1. Régimen guardado: un solo valor para monotributo.
-- ─────────────────────────────────────────────────────────────────────
update public.config_fiscal
   set condicion_iva = 'monotributista', updated_at = now()
 where condicion_iva = 'monotributo';

create or replace function public.fn_regimen_iva()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case lower(btrim(coalesce(
           (select cf.condicion_iva from public.config_fiscal cf where cf.id = 1), '')))
         when 'monotributo'    then 'monotributista'
         when 'monotributista' then 'monotributista'
         when 'exento'         then 'exento'
         else 'responsable_inscripto' end
$$;

comment on function public.fn_regimen_iva() is
  'Régimen de IVA del comercio según config_fiscal (mig 311): responsable_inscripto, '
  'monotributista o exento. Solo el responsable inscripto discrimina el IVA de la venta.';

revoke execute on function public.fn_regimen_iva() from public, anon;
grant execute on function public.fn_regimen_iva() to authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Alícuota congelada en cada ítem vendido.
-- ─────────────────────────────────────────────────────────────────────
alter table public.items_venta
  add column if not exists iva_venta numeric(5,2);

comment on column public.items_venta.iva_venta is
  'Alícuota de IVA del producto al momento de la venta (mig 311). La completa '
  'trg_items_venta_iva desde productos.iva_venta si viene null; el histórico se '
  'rellenó con la alícuota vigente al correr la 311 (no cuenta como estimado).';

create or replace function public.fn_items_venta_iva_default()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.iva_venta is null then
    select p.iva_venta into new.iva_venta
      from public.productos p where p.id = new.producto_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_items_venta_iva on public.items_venta;
create trigger trg_items_venta_iva
  before insert on public.items_venta
  for each row execute function public.fn_items_venta_iva_default();

-- ─────────────────────────────────────────────────────────────────────
-- 3. Backfill por tandas (solo filas sin alícuota: se puede volver a
--    correr este bloque suelto si el editor lo corta).
-- ─────────────────────────────────────────────────────────────────────
do $$
declare
  v_desde integer;
  v_max   integer;
  v_paso  constant integer := 20000;
begin
  select min(iv.id), max(iv.id) into v_desde, v_max
    from public.items_venta iv where iv.iva_venta is null;
  while v_desde is not null and v_desde <= v_max loop
    update public.items_venta iv
       set iva_venta = p.iva_venta
      from public.productos p
     where p.id = iv.producto_id
       and iv.iva_venta is null
       and iv.id >= v_desde and iv.id < v_desde + v_paso;
    v_desde := v_desde + v_paso;
  end loop;
end $$;

-- Las devoluciones se cruzan con su ítem de venta para heredar la alícuota.
create index if not exists idx_itemdev_item_venta
  on public.items_devolucion (item_venta_id);

notify pgrst, 'reload schema';

-- Verificación (todo true / 0):
--   select to_regprocedure('public.fn_regimen_iva()') is not null;
--   select count(*) from pg_trigger where tgname = 'trg_items_venta_iva';
--   select count(*) from public.items_venta where iva_venta is null;
