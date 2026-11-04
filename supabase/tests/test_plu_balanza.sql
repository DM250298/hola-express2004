-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  PRUEBA · PLU de balanza (mig 326)                                   ║
-- ║                                                                     ║
-- ║  Pegar entero en el SQL Editor, DESPUÉS de correr la 326.           ║
-- ║  Cubre: la columna y el índice existen; dos productos con PLU       ║
-- ║  distinto conviven; repetir un PLU choca contra el índice único;    ║
-- ║  0 y 100000 chocan contra el check; NULL vale para muchos.          ║
-- ║  Usa 3 productos existentes y NO inserta nada.                      ║
-- ║  Termina en ROLLBACK: no deja nada.                                 ║
-- ║  Si pasa, la última línea de Messages dice "✔✔✔ PLU BALANZA OK".    ║
-- ╚════════════════════════════════════════════════════════════════════╝
begin;

do $$
declare
  v_a integer;
  v_b integer;
  v_c integer;
  n int;
  choco boolean;
begin
  -- 0. La migración corrió.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'productos'
       and column_name = 'plu_balanza'
  ) then
    raise exception 'FALLO 0a: falta productos.plu_balanza (correr la 326)';
  end if;
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and indexname = 'productos_plu_balanza_key'
  ) then
    raise exception 'FALLO 0b: falta el índice productos_plu_balanza_key (correr la 326)';
  end if;

  select id into v_a from public.productos order by id limit 1;
  select id into v_b from public.productos where id <> v_a order by id limit 1;
  select id into v_c from public.productos where id not in (v_a, v_b) order by id limit 1;
  if v_c is null then
    raise exception 'Hacen falta al menos 3 productos para probar';
  end if;

  -- 1. Dos PLU distintos conviven (99001 y 99004: fuera del rango real).
  update public.productos set plu_balanza = 99001 where id = v_a;
  update public.productos set plu_balanza = 99004 where id = v_b;
  select count(*) into n from public.productos where plu_balanza in (99001, 99004);
  if n <> 2 then raise exception 'FALLO 1: esperaba 2 productos con PLU, hay %', n; end if;

  -- 2. Repetir el PLU de otro producto choca contra el índice único.
  choco := false;
  begin
    update public.productos set plu_balanza = 99001 where id = v_c;
  exception when unique_violation then
    choco := true;
  end;
  if not choco then raise exception 'FALLO 2: dejó repetir el PLU 99001'; end if;

  -- 3. Fuera de rango choca contra el check.
  choco := false;
  begin
    update public.productos set plu_balanza = 0 where id = v_c;
  exception when check_violation then
    choco := true;
  end;
  if not choco then raise exception 'FALLO 3a: aceptó PLU 0'; end if;

  choco := false;
  begin
    update public.productos set plu_balanza = 100000 where id = v_c;
  exception when check_violation then
    choco := true;
  end;
  if not choco then raise exception 'FALLO 3b: aceptó PLU 100000'; end if;

  -- 4. El tope 99999 vale, y NULL vale para todos.
  update public.productos set plu_balanza = 99999 where id = v_c;
  update public.productos set plu_balanza = null where id in (v_a, v_b, v_c);
  select count(*) into n from public.productos
   where id in (v_a, v_b, v_c) and plu_balanza is null;
  if n <> 3 then raise exception 'FALLO 4: no pudo volver a NULL'; end if;

  raise notice '✔✔✔ PLU BALANZA OK';
end $$;

rollback;
