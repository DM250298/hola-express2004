-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 204 · Estantes de la isla GI-01 y de limpieza            ║
-- ║                                                                     ║
-- ║  · GI-01: los 6 módulos de las caras (A1-A3, B1-B3) pasan de        ║
-- ║    'estante' a 'modulo' y cada uno recibe 5 estantes                ║
-- ║    (GI-01-A1-E1 … E5). Las dos punteras quedan como están.          ║
-- ║  · LIM-G01 y LIM-G02: 6 estantes cada una, colgados directo de la   ║
-- ║    góndola (LIM-G01-E1 … E6).                                       ║
-- ║                                                                     ║
-- ║  Conserva ids, categorías y productos ya asignados. Idempotente.    ║
-- ║  REQUIERE: migs 199 y 200. Ejecutar UNA sola vez, COMPLETO.         ║
-- ╚════════════════════════════════════════════════════════════════════╝

do $$
declare
  v_padre record;
  v_n integer;
  v_cant integer;
begin
  for v_padre in
    select u.id, u.codigo, u.tipo
    from public.ubicaciones u
    where u.codigo in ('GI-01-A1', 'GI-01-A2', 'GI-01-A3',
                       'GI-01-B1', 'GI-01-B2', 'GI-01-B3',
                       'LIM-G01', 'LIM-G02')
    order by u.codigo
  loop
    if v_padre.codigo like 'GI-01-%' then
      update public.ubicaciones
      set tipo = 'modulo', updated_at = now()
      where id = v_padre.id and tipo <> 'modulo';
      v_cant := 5;
    else
      v_cant := 6;
    end if;

    for v_n in 1..v_cant loop
      insert into public.ubicaciones (parent_id, tipo, nombre, codigo, orden)
      select v_padre.id, 'estante', 'Estante ' || v_n, v_padre.codigo || '-E' || v_n, v_n
      where not exists (
        select 1 from public.ubicaciones where codigo = v_padre.codigo || '-E' || v_n
      );
    end loop;
  end loop;
end $$;

notify pgrst, 'reload schema';

-- Verificación: GI-01 → 6 módulos con 5 estantes; LIM-G01/02 → 6 estantes.
select p.codigo, p.nombre, p.tipo, count(e.id) as estantes
from public.ubicaciones p
left join public.ubicaciones e on e.parent_id = p.id and e.tipo = 'estante'
where p.codigo in ('GI-01-A1', 'GI-01-A2', 'GI-01-A3',
                   'GI-01-B1', 'GI-01-B2', 'GI-01-B3', 'LIM-G01', 'LIM-G02')
group by p.id, p.codigo, p.nombre, p.tipo
order by p.codigo;
