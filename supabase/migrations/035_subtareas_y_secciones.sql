-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 035 · Subtareas + secciones ordenadas + cover de tablero ║
-- ║                                                                     ║
-- ║  - tableros.imagen_url  → portada del tablero (URL o vacío)         ║
-- ║  - proyectos.orden      → orden horizontal de las "listas" en el    ║
-- ║                            tablero (ascendente)                     ║
-- ║  - subtareas            → checklist dentro de una tarea, con        ║
-- ║                            responsable propio                       ║
-- ╚════════════════════════════════════════════════════════════════════╝

alter table public.tableros
  add column if not exists imagen_url text;

alter table public.proyectos
  add column if not exists orden integer not null default 0;

create table if not exists public.subtareas (
  id serial primary key,
  tarea_id integer not null
    references public.tareas(id) on delete cascade,
  titulo text not null,
  hecha boolean not null default false,
  responsable_id uuid references public.usuarios(id),
  orden integer not null default 0,
  completada_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists subtareas_tarea_idx on public.subtareas (tarea_id);

alter table public.subtareas enable row level security;
do $$ begin
  create policy "todo" on public.subtareas
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null;
end $$;

-- Vista de tarea con conteo de subtareas (para mostrar progreso en la tarjeta).
create or replace view public.vista_tareas
with (security_invoker = true) as
select
  t.*,
  coalesce(s.total_sub, 0)  as total_subtareas,
  coalesce(s.hechas_sub, 0) as subtareas_hechas
from public.tareas t
left join (
  select tarea_id,
         count(*) as total_sub,
         count(*) filter (where hecha) as hechas_sub
  from public.subtareas
  group by tarea_id
) s on s.tarea_id = t.id;

grant select on public.vista_tareas to anon, authenticated;

notify pgrst, 'reload schema';
