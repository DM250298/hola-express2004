-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 328 · Recibir exige código de barras                     ║
-- ║                                                                     ║
-- ║  Pedido del dueño (2026-11-05): un producto nuevo no se puede       ║
-- ║  recibir con el HEX-… que inventa la 065. O se le carga el código   ║
-- ║  real del envase, o quien lo carga marca a mano "No tiene código de ║
-- ║  barras" (pan, verdura suelta, producción propia).                  ║
-- ║                                                                     ║
-- ║  · productos.sin_codigo_barras boolean not null default false:      ║
-- ║    decisión explícita de "no lleva". Estados derivados (los mismos  ║
-- ║    en lib/utils/codigoBarras.ts): real (código no HEX-), pendiente  ║
-- ║    (HEX- y flag false) y no_lleva (flag true). Un pesable con       ║
-- ║    plu_balanza (326) o un producto con codigo_barras_2 cargado      ║
-- ║    también cuenta como resuelto: se identifica por la etiqueta de   ║
-- ║    la balanza o por el EAN secundario.                              ║
-- ║  · Trigger en items_pedido: no se puede SUBIR cantidad_recibida de  ║
-- ║    un producto pendiente → 'CODIGO_PENDIENTE: <nombre>' y toda la   ║
-- ║    recepción se revierte. Cubre al cliente viejo y al update        ║
-- ║    directo (RLS de items_pedido = "authenticated todo"). Solo       ║
-- ║    fn_recibir_pedido (167) sube esa columna; fn_revertir_recepcion  ║
-- ║    (130) la vuelve a null; las facturas (322/325) no la tocan.      ║
-- ║  · El default HEX- de la 065 queda: Nueva orden, Sugerencias,       ║
-- ║    Configuración e importación (fn_importar_productos, 213) siguen  ║
-- ║    dando de alta "pendientes de código". La recepción es la que     ║
-- ║    obliga a resolverlo.                                             ║
-- ║  · Sin cambios de RPC ni RLS.                                       ║
-- ║                                                                     ║
-- ║  Correrla ANTES de deployar el front (la ficha manda la columna en  ║
-- ║  el update y el detalle del pedido la selecciona).                  ║
-- ║  Test: supabase/tests/test_recepcion_exige_codigo.sql (rollback).   ║
-- ╚════════════════════════════════════════════════════════════════════╝

alter table public.productos
  add column if not exists sin_codigo_barras boolean not null default false;

comment on column public.productos.sin_codigo_barras is
  'Mig 328. true = el producto NO lleva código de barras (pan, verdura suelta, producción propia): lo marcó a mano quien lo cargó. Con false y codigo_barras HEX-… el producto está "pendiente de código" y la recepción no lo deja recibir (trg_items_pedido_exige_codigo).';

-- ── Guard de la base ──────────────────────────────────────────────────
-- Salta solo cuando lo recibido SUBE: fn_recibir_pedido acumula
-- (coalesce(cantidad_recibida, 0) + v_cant, y con v_cant = 0 no sube),
-- fn_revertir_recepcion la vuelve a null, el "no vino" toca cantidad_pedida
-- y las facturas solo la leen. No es security definer ni tiene grants: una
-- función de trigger no se llama por PostgREST, y dentro de fn_recibir_pedido
-- corre con el dueño de la función.
create or replace function public.fn_items_pedido_exige_codigo()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_nombre text;
begin
  if tg_op = 'INSERT' and coalesce(new.cantidad_recibida, 0) <= 0 then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and coalesce(new.cantidad_recibida, 0) <= coalesce(old.cantidad_recibida, 0) then
    return new;
  end if;

  select p.nombre into v_nombre
    from public.productos p
   where p.id = new.producto_id
     and p.codigo_barras like 'HEX-%'
     and not p.sin_codigo_barras
     and p.plu_balanza is null
     and p.codigo_barras_2 is null;

  if v_nombre is not null then
    raise exception 'CODIGO_PENDIENTE: %', v_nombre
      using errcode = 'check_violation',
            hint = 'Cargale el código de barras o marcá "No tiene código de barras" antes de recibirlo.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_items_pedido_exige_codigo on public.items_pedido;
create trigger trg_items_pedido_exige_codigo
  before insert or update of cantidad_recibida on public.items_pedido
  for each row execute function public.fn_items_pedido_exige_codigo();

notify pgrst, 'reload schema';

-- ── VERIFICACIÓN 1: columna y trigger ─────────────────────────────────
-- select column_name, column_default from information_schema.columns
--  where table_schema = 'public' and table_name = 'productos'
--    and column_name = 'sin_codigo_barras';
-- select tgname from pg_trigger where tgname = 'trg_items_pedido_exige_codigo';
--
-- ── VERIFICACIÓN 2: cuántos productos quedan "pendientes de código" ───
-- (se frenan en la próxima recepción hasta cargarles el código o marcar
--  "No tiene código de barras"; no se hace backfill: nadie puede saber
--  desde la base cuáles no llevan)
-- select count(*) filter (where activo) as activos, count(*) as total
--   from public.productos
--  where codigo_barras like 'HEX-%' and not sin_codigo_barras
--    and plu_balanza is null and codigo_barras_2 is null;
