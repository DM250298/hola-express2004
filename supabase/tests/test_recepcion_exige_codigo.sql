-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  PRUEBA · Recibir exige código de barras (mig 328)                  ║
-- ║                                                                     ║
-- ║  Pegar entero en el SQL Editor, DESPUÉS de correr la 328.           ║
-- ║  Cubre: la columna y el trigger existen; subir cantidad_recibida de ║
-- ║  un producto HEX- sin el tilde se rechaza con CODIGO_PENDIENTE; no  ║
-- ║  subirla pasa; con el tilde pasa; con PLU de balanza pasa; volver a ║
-- ║  null pasa; con código real pasa.                                   ║
-- ║  Usa 1 renglón existente de items_pedido y NO inserta nada.        ║
-- ║  Termina en ROLLBACK: no deja nada.                                 ║
-- ║  Si pasa, la última línea de Messages dice                          ║
-- ║  "✔✔✔ RECEPCION EXIGE CODIGO OK".                                   ║
-- ╚════════════════════════════════════════════════════════════════════╝
begin;

do $$
declare
  v_item public.items_pedido%rowtype;
  v_prod integer;
  v_plu integer;
  choco boolean;
begin
  -- 0. La migración corrió.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'productos'
       and column_name = 'sin_codigo_barras'
  ) then
    raise exception 'FALLO 0a: falta productos.sin_codigo_barras (correr la 328)';
  end if;
  if not exists (
    select 1 from pg_trigger where tgname = 'trg_items_pedido_exige_codigo'
  ) then
    raise exception 'FALLO 0b: falta el trigger trg_items_pedido_exige_codigo (correr la 328)';
  end if;

  select * into v_item from public.items_pedido order by id limit 1;
  if v_item.id is null then
    raise exception 'Hace falta al menos un renglón en items_pedido para probar';
  end if;
  v_prod := v_item.producto_id;

  -- El producto queda "pendiente de código" (todo dentro de la transacción).
  update public.productos
     set codigo_barras = 'HEX-TEST328', sin_codigo_barras = false,
         plu_balanza = null, codigo_barras_2 = null
   where id = v_prod;

  -- 1. Subir lo recibido de un pendiente se rechaza.
  choco := false;
  begin
    update public.items_pedido
       set cantidad_recibida = coalesce(cantidad_recibida, 0) + 1
     where id = v_item.id;
  exception when others then
    choco := sqlerrm like 'CODIGO_PENDIENTE:%';
    if not choco then raise; end if;
  end;
  if not choco then raise exception 'FALLO 1: dejó recibir un producto sin código'; end if;

  -- 2. Tocar la fila sin subir lo recibido pasa (facturas, "no vino").
  update public.items_pedido
     set cantidad_recibida = cantidad_recibida
   where id = v_item.id;

  -- 3. Marcado "No tiene código de barras" pasa.
  update public.productos set sin_codigo_barras = true where id = v_prod;
  update public.items_pedido
     set cantidad_recibida = coalesce(cantidad_recibida, 0) + 1
   where id = v_item.id;

  -- 4. Pesable con PLU de balanza pasa aunque el tilde esté apagado.
  update public.productos set sin_codigo_barras = false where id = v_prod;
  select min(n) into v_plu from generate_series(99990, 99999) n
   where not exists (select 1 from public.productos where plu_balanza = n);
  update public.productos set plu_balanza = v_plu where id = v_prod;
  update public.items_pedido
     set cantidad_recibida = coalesce(cantidad_recibida, 0) + 1
   where id = v_item.id;

  -- 5. Volver a pendiente y BAJAR a null (revertir recepción) pasa.
  update public.productos set plu_balanza = null where id = v_prod;
  update public.items_pedido set cantidad_recibida = null where id = v_item.id;

  -- 6. Con un código real pasa.
  update public.productos set codigo_barras = 'TEST328-REAL' where id = v_prod;
  update public.items_pedido set cantidad_recibida = 1 where id = v_item.id;

  raise notice '✔✔✔ RECEPCION EXIGE CODIGO OK';
end $$;

rollback;
