-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 036 · Regenerar vista_proyectos para incluir `orden`     ║
-- ║                                                                     ║
-- ║  La vista se creó en la 034 con `select p.*` ANTES de que la 035    ║
-- ║  agregara `proyectos.orden`. Postgres expande `*` al crear la       ║
-- ║  vista, así que la vista quedó sin esa columna y todos los selects  ║
-- ║  con `.order('orden')` fallan en silencio. Esto la recrea.          ║
-- ╚════════════════════════════════════════════════════════════════════╝

drop view if exists public.vista_proyectos;

create view public.vista_proyectos
with (security_invoker = true) as
select
  p.*,
  coalesce(count(t.id), 0) as total_tareas,
  coalesce(count(t.id) filter (where t.estado = 'hecha'), 0) as tareas_hechas
from public.proyectos p
left join public.tareas t on t.proyecto_id = p.id
group by p.id;

grant select on public.vista_proyectos to anon, authenticated;

notify pgrst, 'reload schema';
