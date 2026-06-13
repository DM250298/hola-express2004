-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Hola! Express — LIMPIEZA DE DATOS DE PRUEBA                         ║
-- ║                                                                      ║
-- ║  ⚠️  DESTRUCTIVO E IRREVERSIBLE. Hacé un BACKUP antes (ver README).  ║
-- ║                                                                      ║
-- ║  BORRA:                                                              ║
-- ║   · Todo lo transaccional: ventas, items_venta, pagos_venta,        ║
-- ║     caja_turnos, sangrias, egresos, movimientos_stock, lotes,       ║
-- ║     conteos, ajustes, pedidos, compras, facturas, devoluciones,     ║
-- ║     asientos, movimientos_cuenta, cuentas_a_pagar, acreditaciones,  ║
-- ║     arqueos, remesas, extractos, auditoria, periodos, pedidos_tienda║
-- ║   · Catálogo de ejemplo (seed): productos, categorias, proveedores, ║
-- ║     costos_producto, proveedor_producto, historial_costos           ║
-- ║   · Otros datos de prueba: clientes, empleados+RRHH, proyectos,     ║
-- ║     tableros, tareas, activos_fijos                                  ║
-- ║                                                                      ║
-- ║  CONSERVA (lista blanca v_protegidas):                              ║
-- ║   · usuarios, roles                  (logins y permisos)            ║
-- ║   · plan_cuentas                     (plan contable)                ║
-- ║   · medios_pago, mapeo_medio_pago_cuenta  (cobros + comisiones)     ║
-- ║   · cuentas  (se conservan, saldo_actual → 0)                       ║
-- ║   · terminales                       (dispositivos MP Point)        ║
-- ║   · config_compras, config_fiscal    (parámetros del sistema)       ║
-- ║                                                                      ║
-- ║  CÓMO USAR (SQL Editor de Supabase):                                ║
-- ║   1) Corré el PASO 1 y revisá qué se va a borrar.                   ║
-- ║   2) Si está OK, corré el PASO 2 (atómico: si falla, no borra nada).║
-- ║   3) Corré el PASO 3 para verificar que la config quedó intacta.    ║
-- ╚════════════════════════════════════════════════════════════════════╝


-- ─────────────────────────────────────────────────────────────────────
-- PASO 1 — DIAGNÓSTICO (solo lectura, NO borra nada)
-- Lista cada tabla que se vaciaría con su conteo real de filas.
-- ─────────────────────────────────────────────────────────────────────

with protegidas as (
  select unnest(array[
    'usuarios','roles','plan_cuentas','medios_pago','mapeo_medio_pago_cuenta',
    'cuentas','terminales','config_compras','config_fiscal'
  ]) as t
)
select
  t.tablename as tabla_a_vaciar,
  (xpath('/row/c/text()',
     query_to_xml(format('select count(*) as c from public.%I', t.tablename),
                  false, true, '')))[1]::text::bigint as filas
from pg_tables t
where t.schemaname = 'public'
  and t.tablename not in (select t from protegidas)
order by filas desc, tabla_a_vaciar;


-- ─────────────────────────────────────────────────────────────────────
-- PASO 2 — LIMPIEZA (DESTRUCTIVO)
-- Corré esto SOLO si el PASO 1 mostró lo que esperabas.
-- Todo el bloque es atómico: si algo sale mal, lanza excepción y revierte.
-- ─────────────────────────────────────────────────────────────────────

do $$
declare
  -- Tablas que NO se tocan. Si querés conservar alguna más (p. ej. clientes
  -- o empleados ya cargados de verdad), agregá su nombre a este array.
  v_protegidas text[] := array[
    'usuarios','roles','plan_cuentas','medios_pago','mapeo_medio_pago_cuenta',
    'cuentas','terminales','config_compras','config_fiscal'
  ];
  v_lista text;
  v_usuarios_antes bigint;
  v_roles_antes    bigint;
begin
  -- Foto previa de la config crítica (para el cinturón de seguridad)
  select count(*) into v_usuarios_antes from public.usuarios;
  select count(*) into v_roles_antes    from public.roles;

  -- Armar la lista de TODAS las tablas de public menos las protegidas
  select string_agg(format('public.%I', tablename), ', ')
    into v_lista
  from pg_tables
  where schemaname = 'public'
    and tablename <> all(v_protegidas);

  if v_lista is null then
    raise exception 'No hay tablas para vaciar. Revisá v_protegidas.';
  end if;

  -- Vaciar todo de una sola vez. RESTART IDENTITY = los IDs vuelven a 1.
  -- CASCADE resuelve el orden de las foreign keys automáticamente.
  execute 'truncate table ' || v_lista || ' restart identity cascade';

  -- Las cuentas se conservan, pero el saldo arranca en cero.
  -- (Cargá el saldo inicial real después con un ajuste de cuenta).
  update public.cuentas set saldo_actual = 0;

  -- Cinturón de seguridad: la config NO se puede haber borrado.
  -- Si algo arrastró usuarios/roles, abortamos y se revierte todo.
  if (select count(*) from public.usuarios) <> v_usuarios_antes then
    raise exception 'ABORTADO: la tabla usuarios cambió (debía quedar intacta).';
  end if;
  if (select count(*) from public.roles) <> v_roles_antes then
    raise exception 'ABORTADO: la tabla roles cambió (debía quedar intacta).';
  end if;

  raise notice 'Limpieza OK: tablas de prueba vaciadas, IDs reseteados, saldos de cuentas en 0.';
end $$;


-- ─────────────────────────────────────────────────────────────────────
-- PASO 3 — VERIFICACIÓN (solo lectura)
-- La config debe seguir con datos; el resto debe dar 0.
-- ─────────────────────────────────────────────────────────────────────

select 'usuarios'     as tabla, count(*) as filas from public.usuarios
union all select 'roles',        count(*) from public.roles
union all select 'plan_cuentas', count(*) from public.plan_cuentas
union all select 'medios_pago',  count(*) from public.medios_pago
union all select 'cuentas',      count(*) from public.cuentas
union all select 'terminales',   count(*) from public.terminales
union all select '— productos',  count(*) from public.productos
union all select '— ventas',     count(*) from public.ventas
union all select '— lotes',      count(*) from public.lotes
order by tabla;
