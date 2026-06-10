-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 082 · permiso 'produccion' para los roles base           ║
-- ║                                                                     ║
-- ║  Agrega el permiso del módulo Producción a los roles Administrador  ║
-- ║  y Encargado (el cajero NO lo lleva: la comida la elabora cocina,   ║
-- ║  no caja). Idempotente. El admin igual lo tendría por hardcode en   ║
-- ║  fn_tiene_permiso, pero se agrega explícito para que aparezca       ║
-- ║  tildado en la matriz de Configuración › Usuarios.                  ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez en el SQL Editor de Supabase.                ║
-- ╚════════════════════════════════════════════════════════════════════╝

do $$ begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'roles'
  ) then
    update public.roles
    set permisos = array_append(permisos, 'produccion'),
        updated_at = now()
    where codigo in ('admin', 'encargado')
      and not ('produccion' = any(permisos));
  end if;
end $$;

notify pgrst, 'reload schema';
