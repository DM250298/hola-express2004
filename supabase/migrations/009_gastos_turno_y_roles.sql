-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 009: gastos de caja por turno + roles personalizados     ║
-- ║                                                                     ║
-- ║  A) egresos.turno_id  → un gasto del POS sale de la caja del turno  ║
-- ║  B) tabla roles       → roles personalizados con permisos a medida  ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─── A) Gasto de caja vinculado al turno ────────────────────────────
alter table public.egresos
  add column if not exists turno_id integer references public.caja_turnos(id);

-- ─── B) Roles personalizados ────────────────────────────────────────
create table if not exists public.roles (
  id serial primary key,
  codigo text not null unique,
  nombre text not null,
  permisos text[] not null default '{}',
  es_sistema boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.roles enable row level security;

do $$ begin
  create policy "todo" on public.roles
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

-- Roles base del sistema (no se pueden borrar)
insert into public.roles (codigo, nombre, es_sistema, permisos) values
  ('admin', 'Administrador', true, ARRAY[
    'dashboard','pos','pos_gasto','ventas','ventas_anular','inventario',
    'inventario_ajustes','conteo_gestion','vencimientos','pedidos',
    'recepcion','finanzas','reportes','configuracion']),
  ('encargado', 'Encargado', true, ARRAY[
    'dashboard','pos','pos_gasto','ventas','ventas_anular','inventario',
    'inventario_ajustes','conteo_gestion','vencimientos','pedidos',
    'recepcion','reportes']),
  ('cajero', 'Cajero', true, ARRAY[
    'dashboard','pos','ventas','inventario','recepcion'])
on conflict (codigo) do nothing;

-- Convertir usuarios.rol de enum a text para soportar roles nuevos.
-- (El tipo enum `rol` queda sin uso pero NO se elimina, por seguridad.)
alter table public.usuarios alter column rol drop default;
alter table public.usuarios alter column rol type text using rol::text;

notify pgrst, 'reload schema';
