-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 033 · El cajero entra directo a su área de trabajo       ║
-- ║                                                                     ║
-- ║  Se quita el permiso 'dashboard' del rol cajero. Al iniciar sesión  ║
-- ║  el cajero ya no pasa por el dashboard: entra directo al POS.       ║
-- ║  (Si más adelante querés devolverle el dashboard, agregalo desde    ║
-- ║   Configuración → Roles.)                                           ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez en el SQL Editor de Supabase.                ║
-- ╚════════════════════════════════════════════════════════════════════╝

do $$ begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'roles'
  ) then
    update public.roles
    set permisos = array_remove(permisos, 'dashboard'),
        updated_at = now()
    where codigo = 'cajero'
      and 'dashboard' = any(permisos);
  end if;
end $$;

notify pgrst, 'reload schema';
