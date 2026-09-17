-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 203 · GM-01: los divisores son MÓDULOS con 6 estantes    ║
-- ║                                                                     ║
-- ║  La 200 cargó los 10 divisores de la góndola mural como estantes.   ║
-- ║  En el local cada divisor (01 · Parafernalia … 10 · Limpieza) es un ║
-- ║  módulo de la góndola y adentro tiene 6 estantes:                   ║
-- ║     GM-01 › 01 · Parafernalia › Estante 1 … Estante 6               ║
-- ║                                                                     ║
-- ║  · Los 10 divisores pasan de 'estante' a 'modulo' (conservan id,    ║
-- ║    código, categoría y los productos que ya tengan asignados).      ║
-- ║  · A cada uno se le crean 6 estantes: GM-01-D01-E1 … E6. Heredan la ║
-- ║    categoría y el responsable del módulo.                           ║
-- ║                                                                     ║
-- ║  Idempotente: si se corre dos veces no duplica estantes.            ║
-- ║  REQUIERE: migs 170, 199 y 200. Ejecutar UNA sola vez, COMPLETO.    ║
-- ╚════════════════════════════════════════════════════════════════════╝

do $$
declare
  v_mod record;
  v_n integer;
begin
  for v_mod in
    select u.id, u.codigo
    from public.ubicaciones u
    where u.codigo like 'GM-01-D__'
    order by u.codigo
  loop
    update public.ubicaciones
    set tipo = 'modulo', updated_at = now()
    where id = v_mod.id and tipo <> 'modulo';

    for v_n in 1..6 loop
      insert into public.ubicaciones (parent_id, tipo, nombre, codigo, orden)
      select v_mod.id, 'estante', 'Estante ' || v_n, v_mod.codigo || '-E' || v_n, v_n
      where not exists (
        select 1 from public.ubicaciones where codigo = v_mod.codigo || '-E' || v_n
      );
    end loop;
  end loop;
end $$;

notify pgrst, 'reload schema';

-- Verificación: 10 módulos con 6 estantes cada uno.
select m.codigo, m.nombre, m.tipo, count(e.id) as estantes
from public.ubicaciones m
left join public.ubicaciones e on e.parent_id = m.id and e.tipo = 'estante'
where m.codigo like 'GM-01-D__'
group by m.id, m.codigo, m.nombre, m.tipo
order by m.codigo;
