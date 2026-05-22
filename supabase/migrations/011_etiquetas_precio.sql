-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 011: etiquetas de precio pendientes                      ║
-- ║                                                                     ║
-- ║  Cada vez que cambia el precio de venta de un producto, un trigger  ║
-- ║  lo encola en `etiquetas_pendientes` para reimprimir la etiqueta    ║
-- ║  de góndola. Al colocarla, la fila se elimina (deja de figurar).    ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- Tabla de etiquetas pendientes de colocar
create table if not exists public.etiquetas_pendientes (
  id serial primary key,
  producto_id integer not null unique
    references public.productos(id) on delete cascade,
  precio numeric(12,2) not null,
  precio_anterior numeric(12,2),
  fecha timestamptz not null default now()
);

alter table public.etiquetas_pendientes enable row level security;

do $$ begin
  create policy "todo" on public.etiquetas_pendientes
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

-- Función del trigger: encola/actualiza la etiqueta del producto
create or replace function public.fn_etiqueta_precio_cambio()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.etiquetas_pendientes (producto_id, precio, precio_anterior, fecha)
  values (new.id, new.precio_venta, old.precio_venta, now())
  on conflict (producto_id) do update
    set precio = excluded.precio,
        precio_anterior = excluded.precio_anterior,
        fecha = now();
  return new;
end;
$$;

-- Trigger: dispara solo cuando cambia el precio de venta
drop trigger if exists trg_etiqueta_precio on public.productos;
create trigger trg_etiqueta_precio
  after update of precio_venta on public.productos
  for each row
  when (old.precio_venta is distinct from new.precio_venta)
  execute function public.fn_etiqueta_precio_cambio();

-- Permiso 'etiquetas' para los roles base
do $$ begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'roles'
  ) then
    update public.roles
    set permisos = array_append(permisos, 'etiquetas'),
        updated_at = now()
    where codigo in ('admin', 'encargado')
      and not ('etiquetas' = any(permisos));
  end if;
end $$;

notify pgrst, 'reload schema';
