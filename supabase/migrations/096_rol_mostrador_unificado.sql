-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 096 · Mostrador unificado (Cajero + Fiambrero)            ║
-- ║                                                                     ║
-- ║  El dueño quiere que cajeros y fiambreros vean la MISMA app, con el  ║
-- ║  acceso OPERATIVO de la encargada pero SIN los módulos que muestran  ║
-- ║  el costo (Compras, Pedidos, Reportes, monitor de costos) y con el   ║
-- ║  costo del producto oculto.                                         ║
-- ║                                                                     ║
-- ║  · Eleva el rol 'cajero' al set operativo del mostrador.            ║
-- ║  · Crea el rol 'fiambrero' como CLON del cajero (misma app).        ║
-- ║                                                                     ║
-- ║  Excluidos a propósito (exponen costo / son sensibles): costos,     ║
-- ║  compras, pedidos, reportes, produccion (módulo de costeo de         ║
-- ║  recetas), finanzas, contabilidad, configuracion, rrhh_sueldos,      ║
-- ║  terminales. Así el costo queda oculto por RLS (costos_producto y    ║
-- ║  las tablas de compras/producción se gatean por esos permisos).      ║
-- ║                                                                     ║
-- ║  Los permisos efectivos salen de la tabla `roles`; el fallback en   ║
-- ║  lib/permisos.ts se actualiza en paralelo. La asignación de cada     ║
-- ║  empleado a Cajero o Fiambrero se hace en Configuración → Usuarios.  ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

do $$
declare
  -- Set operativo del mostrador (sin módulos con costo ni sensibles).
  v_mostrador text[] := array[
    'dashboard','proyectos','pos','pos_gasto','ventas','ventas_anular',
    'devoluciones','clientes','inventario','inventario_ajustes',
    'conteo_gestion','vencimientos','etiquetas','recepcion','rrhh'
  ];
begin
  -- Si la tabla roles todavía no existe (migración 009 sin correr), no hay
  -- nada que hacer: el fallback de lib/permisos.ts cubre el caso.
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'roles'
  ) then
    return;
  end if;

  -- Cajero: elevado al set operativo del mostrador.
  update public.roles
    set permisos = v_mostrador, updated_at = now()
    where codigo = 'cajero';

  -- Fiambrero: clon del cajero (misma app). Rol de sistema para que esté
  -- siempre disponible y no se borre por accidente.
  insert into public.roles (codigo, nombre, es_sistema, permisos)
    values ('fiambrero', 'Fiambrero', true, v_mostrador)
  on conflict (codigo) do update
    set permisos = excluded.permisos,
        nombre = excluded.nombre,
        es_sistema = excluded.es_sistema,
        updated_at = now();
end $$;

notify pgrst, 'reload schema';
