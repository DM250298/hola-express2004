-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 010: permiso 'compras' para los roles base                ║
-- ║                                                                     ║
-- ║  Agrega el permiso del nuevo módulo de Compras a los roles          ║
-- ║  Administrador y Encargado (si la tabla roles ya existe).           ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez en el SQL Editor de Supabase.                ║
-- ╚════════════════════════════════════════════════════════════════════╝

do $$ begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'roles'
  ) then
    update public.roles
    set permisos = array_append(permisos, 'compras'),
        updated_at = now()
    where codigo in ('admin', 'encargado')
      and not ('compras' = any(permisos));
  end if;
end $$;

notify pgrst, 'reload schema';
