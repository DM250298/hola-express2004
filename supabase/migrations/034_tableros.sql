-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 034 · Tableros (Proyectos agrupados + miembros)          ║
-- ║                                                                     ║
-- ║  Un tablero agrupa proyectos y tiene miembros con rol:              ║
-- ║    · lector  → solo lectura                                         ║
-- ║    · editor  → puede crear/editar/borrar proyectos y tareas         ║
-- ║    · admin   → todo lo anterior + gestionar miembros del tablero    ║
-- ║                                                                     ║
-- ║  Un usuario con permiso de sistema 'configuracion' (admin del       ║
-- ║  sistema) ve y administra TODOS los tableros aunque no sea miembro. ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─── 1. Tabla tableros ─────────────────────────────────────────────────

create table if not exists public.tableros (
  id serial primary key,
  nombre text not null,
  descripcion text,
  color text not null default '#f9b44c',
  archivado boolean not null default false,
  creado_por uuid references public.usuarios(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─── 2. Miembros del tablero ───────────────────────────────────────────

create table if not exists public.tablero_miembros (
  tablero_id integer not null
    references public.tableros(id) on delete cascade,
  usuario_id uuid not null
    references public.usuarios(id) on delete cascade,
  rol text not null default 'editor',          -- lector|editor|admin
  agregado_at timestamptz not null default now(),
  primary key (tablero_id, usuario_id)
);

create index if not exists tablero_miembros_usuario_idx
  on public.tablero_miembros (usuario_id);

-- ─── 3. Relación proyecto → tablero ────────────────────────────────────

alter table public.proyectos
  add column if not exists tablero_id integer
    references public.tableros(id) on delete cascade;

create index if not exists proyectos_tablero_idx
  on public.proyectos (tablero_id);

-- ─── 4. Tablero "General" por defecto + asociar proyectos huérfanos ───

do $$
declare
  v_tablero_id integer;
  v_admin uuid;
begin
  -- Si hay proyectos sin tablero, creamos uno "General" y los movemos ahí.
  if exists (select 1 from public.proyectos where tablero_id is null) then
    select id into v_admin from public.usuarios
      where rol = 'admin' and activo = true
      order by created_at asc limit 1;

    insert into public.tableros (nombre, descripcion, creado_por)
    values ('General', 'Tablero por defecto para proyectos previos.', v_admin)
    returning id into v_tablero_id;

    update public.proyectos
      set tablero_id = v_tablero_id
      where tablero_id is null;

    -- El admin original es admin del tablero general.
    if v_admin is not null then
      insert into public.tablero_miembros (tablero_id, usuario_id, rol)
      values (v_tablero_id, v_admin, 'admin')
      on conflict do nothing;
    end if;
  end if;
end $$;

-- Una vez migrados los proyectos viejos, exigimos tablero_id en los nuevos.
alter table public.proyectos
  alter column tablero_id set not null;

-- ─── 5. RLS (permisivo a nivel SQL; el filtrado real ocurre en la UI) ──

do $$
declare t text;
begin
  foreach t in array array['tableros', 'tablero_miembros'] loop
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

-- ─── 6. Vistas con métricas ─────────────────────────────────────────────

-- Reemplazar vista_proyectos para incluir tablero_id.
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

-- Vista de tableros con conteo de proyectos y miembros.
create or replace view public.vista_tableros
with (security_invoker = true) as
select
  tb.*,
  coalesce(pr.total_proyectos, 0) as total_proyectos,
  coalesce(pr.proyectos_activos, 0) as proyectos_activos,
  coalesce(mb.total_miembros, 0) as total_miembros
from public.tableros tb
left join (
  select tablero_id,
         count(*) as total_proyectos,
         count(*) filter (where estado = 'activo') as proyectos_activos
  from public.proyectos
  group by tablero_id
) pr on pr.tablero_id = tb.id
left join (
  select tablero_id, count(*) as total_miembros
  from public.tablero_miembros
  group by tablero_id
) mb on mb.tablero_id = tb.id;

grant select on public.vista_tableros to anon, authenticated;

-- Vista que incluye el rol del usuario actual en cada tablero (para la UI).
create or replace view public.vista_tableros_usuario
with (security_invoker = true) as
select
  vt.*,
  tm.rol as mi_rol
from public.vista_tableros vt
left join public.tablero_miembros tm
  on tm.tablero_id = vt.id and tm.usuario_id = auth.uid();

grant select on public.vista_tableros_usuario to anon, authenticated;

-- ─── 7. Trigger para updated_at en tableros ────────────────────────────

create or replace function public.tg_tableros_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists tableros_updated_at on public.tableros;
create trigger tableros_updated_at
  before update on public.tableros
  for each row execute function public.tg_tableros_updated_at();

notify pgrst, 'reload schema';
