-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  265 · Tareas v2: permiso de administrador de tareas                ║
-- ║  (Etapa 1 · bloque B)                                                ║
-- ║                                                                     ║
-- ║  'tareas_admin' = ver y hacer las privadas, quitar de la rutina,     ║
-- ║  aprobar pedidos, horarios de turno y registro de cambios.           ║
-- ║  'tareas_gestion' sigue siendo la encargada (Sonia, Rebeca).         ║
-- ║                                                                     ║
-- ║  Seguro: se frena si el rol 'admin' tiene usuarios activos que no    ║
-- ║  sean Damián y Rodrigo (Damián, 2026-10-16: Agustina no es           ║
-- ║  administradora). En la base de prueba también vale el usuario       ║
-- ║  admin@pruebas.local. Desactivá o cambiá de rol a quien sobre y      ║
-- ║  volvé a pegarla.                                                    ║
-- ║                                                                     ║
-- ║  Se puede correr más de una vez.                                     ║
-- ║  Última línea del archivo: "notify pgrst, 'reload schema';"          ║
-- ╚════════════════════════════════════════════════════════════════════╝

do $$
declare v_sobran text;
begin
  select string_agg(coalesce(u.email, u.id::text), ', ') into v_sobran
  from public.usuarios u
  where u.rol = 'admin' and u.activo
    and u.id not in ('fb82bbe8-5534-4205-bf68-381cd787d14b',   -- Damián
                     '307ad828-8cd9-4d50-83b1-9873fb16e777')   -- Rodrigo Luna
    and u.email <> 'admin@pruebas.local';
  if v_sobran is not null then
    raise exception '265: el rol admin tiene usuarios activos que no son Damián ni Rodrigo: %. Desactivalos o cambiales el rol y volvé a pegarla.', v_sobran;
  end if;
end $$;

update public.roles
   set permisos = array_append(permisos, 'tareas_admin'), updated_at = now()
 where codigo = 'admin' and not ('tareas_admin' = any(permisos));

-- La encargada: opera tareas, no las administra.
update public.roles
   set permisos = array_remove(permisos, 'tareas_admin'), updated_at = now()
 where codigo <> 'admin' and 'tareas_admin' = any(permisos);

do $$
begin
  if not exists (select 1 from public.roles where codigo = 'admin' and 'tareas_admin' = any(permisos)) then
    raise exception '265: el rol admin no quedó con tareas_admin.';
  end if;
end $$;

-- Para mirar a mano: quién queda como administrador y quién como encargada.
-- select u.email, u.rol, u.activo from public.usuarios u
--  where u.rol in ('admin', 'encargado') order by u.rol, u.email;

notify pgrst, 'reload schema';
