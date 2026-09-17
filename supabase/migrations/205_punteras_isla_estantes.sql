-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 205 · Punteras de la isla GI-01 con 5 estantes           ║
-- ║                                                                     ║
-- ║  Las dos punteras (GI-01-PC hacia caja, GI-01-PF hacia el fondo)    ║
-- ║  pasan de 'estante' a 'modulo' y reciben 5 estantes cada una        ║
-- ║  (GI-01-PC-E1 … E5), igual que los módulos de las caras (mig 204).  ║
-- ║                                                                     ║
-- ║  Conserva ids, categoría/marca y productos ya asignados.            ║
-- ║  Idempotente. REQUIERE: migs 200 y 204. Ejecutar UNA sola vez.      ║
-- ╚════════════════════════════════════════════════════════════════════╝

do $$
declare
  v_padre record;
  v_n integer;
begin
  for v_padre in
    select u.id, u.codigo
    from public.ubicaciones u
    where u.codigo in ('GI-01-PC', 'GI-01-PF')
  loop
    update public.ubicaciones
    set tipo = 'modulo', updated_at = now()
    where id = v_padre.id and tipo <> 'modulo';

    for v_n in 1..5 loop
      insert into public.ubicaciones (parent_id, tipo, nombre, codigo, orden)
      select v_padre.id, 'estante', 'Estante ' || v_n, v_padre.codigo || '-E' || v_n, v_n
      where not exists (
        select 1 from public.ubicaciones where codigo = v_padre.codigo || '-E' || v_n
      );
    end loop;
  end loop;
end $$;

notify pgrst, 'reload schema';

-- Verificación: las dos punteras como módulo con 5 estantes.
select p.codigo, p.nombre, p.tipo, count(e.id) as estantes
from public.ubicaciones p
left join public.ubicaciones e on e.parent_id = p.id and e.tipo = 'estante'
where p.codigo in ('GI-01-PC', 'GI-01-PF')
group by p.id, p.codigo, p.nombre, p.tipo
order by p.codigo;
