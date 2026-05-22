-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 030 · FASE 5 — Proyectos y tareas internas               ║
-- ║                                                                     ║
-- ║  Tablero de trabajo del equipo: proyectos que agrupan tareas        ║
-- ║  (refacciones, trámites, mejoras del local, etc.). Cada tarea con   ║
-- ║  responsable, prioridad, estado y fecha límite.                     ║
-- ║                                                                     ║
-- ║   • proyectos        → agrupador                                    ║
-- ║   • tareas           → unidad de trabajo (Kanban: pendiente/        ║
-- ║                        en_curso/hecha)                              ║
-- ║   • vista_proyectos  → proyecto + conteo de tareas y completadas    ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─── 1. Tablas ──────────────────────────────────────────────────────

create table if not exists public.proyectos (
  id serial primary key,
  nombre text not null,
  descripcion text,
  estado text not null default 'activo',     -- activo|completado|archivado
  fecha_limite date,
  usuario_id uuid references public.usuarios(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tareas (
  id serial primary key,
  proyecto_id integer not null
    references public.proyectos(id) on delete cascade,
  titulo text not null,
  descripcion text,
  estado text not null default 'pendiente',  -- pendiente|en_curso|hecha
  prioridad text not null default 'media',   -- baja|media|alta
  responsable_id uuid references public.usuarios(id),
  fecha_limite date,
  creado_por uuid references public.usuarios(id),
  completada_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tareas_proyecto_idx on public.tareas (proyecto_id);
create index if not exists tareas_responsable_idx
  on public.tareas (responsable_id);

-- ─── 2. RLS ─────────────────────────────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array['proyectos', 'tareas'] loop
    execute format('alter table public.%I enable row level security', t);
    begin
      execute format(
        'create policy "todo" on public.%I for all to authenticated using (true) with check (true)',
        t
      );
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ─── 3. Vista con métricas de avance ────────────────────────────────

create or replace view public.vista_proyectos
with (security_invoker = true) as
select
  p.*,
  coalesce(count(t.id), 0) as total_tareas,
  coalesce(count(t.id) filter (where t.estado = 'hecha'), 0) as tareas_hechas
from public.proyectos p
left join public.tareas t on t.proyecto_id = p.id
group by p.id;

grant select on public.vista_proyectos to anon, authenticated;

-- ─── 4. Permiso 'proyectos' para todo el personal ──────────────────

do $$ begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'roles'
  ) then
    update public.roles
    set permisos = array_append(permisos, 'proyectos'),
        updated_at = now()
    where codigo in ('admin', 'encargado', 'cajero')
      and not ('proyectos' = any(permisos));
  end if;
end $$;

notify pgrst, 'reload schema';
