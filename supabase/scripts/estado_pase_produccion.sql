-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Script (NO migración, SOLO LECTURA) · ¿Qué le falta a producción?  ║
-- ║                                                                     ║
-- ║  Correr en el SQL Editor de PRODUCCIÓN (arriba tiene que decir      ║
-- ║  HEX-V1 · main PRODUCTION) ANTES de correr migraciones, y otra vez  ║
-- ║  al final: todas las filas tienen que quedar en "✅ ya está".        ║
-- ║                                                                     ║
-- ║  Revisa por los objetos que crea cada migración (no por la tabla de ║
-- ║  MIGRACIONES.md, que puede ir atrasada). Incluye la 169, 188 y 189, ║
-- ║  que figuran pendientes desde septiembre sin confirmar.             ║
-- ║  No crea, cambia ni borra nada. Se puede correr las veces que sea.  ║
-- ║  Última línea del archivo: "order by orden;"                        ║
-- ╚════════════════════════════════════════════════════════════════════╝

with fn as (
  select p.proname, p.prosrc
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
),
chequeos (orden, paso, que_revisa, ok, detalle) as (
  select 1, '169', 'Compra directa: precio de venta manual',
    exists (select 1 from fn where proname = 'fn_registrar_compra_directa'
                                and prosrc like '%v_precio_manual%'),
    null::text
  union all
  select 2, '188', 'Alertas: crear tarea, posponer y reabrir',
    (select count(distinct proname) from fn
      where proname in ('fn_crear_tarea_alertas', 'fn_posponer_alertas', 'fn_reabrir_alertas')) = 3,
    null
  union all
  select 3, '189', 'Alertas: editar reglas',
    exists (select 1 from fn where proname = 'fn_actualizar_regla_alerta'),
    null
  union all
  select 4, '251', 'Tareas con hora, tipo y checklist',
    (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'tareas_turno'
        and column_name in ('hora', 'tipo_actividad', 'checklist')) = 3,
    null
  union all
  select 5, '252', 'Materializar tareas v5 (aplica cambios de la rutina)',
    -- minutos_desde_inicio solo existe desde la 251: ninguna versión anterior lo nombra.
    exists (select 1 from fn where proname = 'fn_materializar_tareas_turno'
                                and prosrc like '%minutos_desde_inicio%'),
    null
  union all
  select 6, '253', 'Iniciar, omitir, reabrir y trasladar tareas',
    (select count(distinct proname) from fn
      where proname in ('fn_iniciar_tarea', 'fn_omitir_tarea', 'fn_reabrir_tarea',
                        'fn_trasladar_tarea')) = 4,
    null
  union all
  -- Lo que la 254 cambia respecto de la seed 242: Fernanda en Compras y Tomás
  -- reportando a Sonia (la 242 lo ponía bajo Rebeca). Sonia y Matías ya venían.
  select 7, '254', 'Organigrama: Fernanda en Compras y Tomás reporta a Sonia',
    exists (select 1 from public.empleados where activo and rol_operativo = 'compras'
             and lower(nombre) like 'fernanda%')
    and exists (select 1 from public.empleados t join public.empleados s on s.id = t.reporta_a
                 where t.activo and translate(lower(t.nombre), 'á', 'a') like 'tomas%'
                   and lower(s.nombre) like 'sonia%'),
    (select string_agg(rol_operativo || ': ' || n, ' · ' order by rol_operativo)
       from (select rol_operativo::text, count(*) as n from public.empleados
              where activo group by rol_operativo) x)
  union all
  select 8, '255', 'Cronograma: dotación requerida y recálculo de asistencia',
    to_regclass('public.dotacion_requerida') is not null
    and to_regprocedure('public.fn_recalcular_asistencia_empleado(integer,date)') is not null,
    null
  union all
  select 9, '256', 'Cajero y fiambrero con mi_panel y sin rrhh',
    not exists (select 1 from public.roles where codigo in ('cajero', 'fiambrero')
                 and ('rrhh' = any(permisos) or not ('mi_panel' = any(permisos)))),
    (select string_agg(codigo || ' = ' || array_to_string(permisos, ','), ' | ' order by codigo)
       from public.roles where codigo in ('cajero', 'fiambrero'))
  union all
  select 10, '257', 'Permiso proveedores en todo rol con configuracion',
    not exists (select 1 from public.roles where 'configuracion' = any(permisos)
                 and not ('proveedores' = any(permisos)))
    and exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'proveedor_producto' and policyname = 'gate_rw'
                 and qual like '%proveedores%'),
    'Roles con configuracion (reciben proveedores): ' || coalesce(
      (select string_agg(codigo, ', ' order by codigo) from public.roles
        where 'configuracion' = any(permisos)), 'ninguno')
  union all
  select 11, '258', 'Proveedores: lectura abierta, escritura con permiso',
    (select count(*) from pg_policies where schemaname = 'public' and tablename = 'proveedores'
      and policyname in ('proveedores_select', 'proveedores_write')) = 2,
    'Policies hoy: ' || coalesce((select string_agg(policyname, ', ' order by policyname)
      from pg_policies where schemaname = 'public' and tablename = 'proveedores'), 'ninguna')
  union all
  select 12, 'D7', 'Sin conteos viejos contados y sin aprobar',
    not exists (select 1 from public.conteos where estado = 'contado'),
    (select string_agg(estado || ': ' || n, ' · ' order by estado)
       from (select estado, count(*) as n from public.conteos group by estado) x)
  union all
  select 13, 'Roles', 'empleado = solo mi_panel · encargado con rrhh',
    exists (select 1 from public.roles where codigo = 'empleado' and permisos = array['mi_panel'])
    and exists (select 1 from public.roles where codigo = 'encargado' and 'rrhh' = any(permisos)),
    (select string_agg(codigo || ' = ' || array_to_string(permisos, ','), ' | ' order by codigo)
       from public.roles where codigo in ('empleado', 'encargado'))
  union all
  -- "revoke ... from public" no alcanza en Supabase: anon y authenticated tienen
  -- EXECUTE explícito. Las de sueldo no chequean permisos (SECURITY DEFINER).
  select 14, '259', 'Sueldos: fn_sueldo / fn_set_sueldo cerradas a la app',
    not has_function_privilege('anon', 'public.fn_sueldo(integer)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.fn_sueldo(integer)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.fn_set_sueldo(integer,numeric)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.fn_set_sueldo(integer,numeric)', 'EXECUTE'),
    null
  union all
  -- ── Margen neto de IVA (311–319). Cada fila mira el cuerpo de la función Y el
  --    grant/revoke final: si el pegado se cortó, falta alguno de los dos. ──
  select 15, '311', 'IVA congelado en items_venta + fn_regimen_iva + trigger',
    exists (select 1 from information_schema.columns where table_schema = 'public'
             and table_name = 'items_venta' and column_name = 'iva_venta')
    and to_regprocedure('public.fn_regimen_iva()') is not null
    and exists (select 1 from pg_trigger where tgname = 'trg_items_venta_iva')
    and not exists (select 1 from public.config_fiscal where condicion_iva = 'monotributo'),
    'Ítems sin alícuota: ' || (select count(*) from public.items_venta where iva_venta is null)
  union all
  select 16, '312', 'Helpers fn_items_vendidos_neto / fn_items_devueltos_neto (internos)',
    to_regprocedure('public.fn_items_vendidos_neto(date,date,integer[])') is not null
    and to_regprocedure('public.fn_items_devueltos_neto(date,date,integer[])') is not null
    and not has_function_privilege('authenticated', 'public.fn_items_devueltos_neto(date,date,integer[])', 'EXECUTE'),
    null
  union all
  select 17, '313', 'fn_ventas_diarias v2 (ingresos_netos, interna)',
    exists (select 1 from fn where proname = 'fn_ventas_diarias' and prosrc like '%ingresos_netos%')
    and not has_function_privilege('authenticated', 'public.fn_ventas_diarias(date,date)', 'EXECUTE'),
    null
  union all
  select 18, '314', 'fn_resumen_skus v3 (margen neto + iva_ventas)',
    exists (select 1 from fn where proname = 'fn_resumen_skus' and prosrc like '%iva_ventas%')
    and has_function_privilege('authenticated', 'public.fn_resumen_skus(date,date)', 'EXECUTE'),
    null
  union all
  select 19, '315', 'fn_metricas_agrupadas v2',
    exists (select 1 from fn where proname = 'fn_metricas_agrupadas' and prosrc like '%iva_ventas%')
    and has_function_privilege('authenticated', 'public.fn_metricas_agrupadas(text,date,date)', 'EXECUTE'),
    null
  union all
  select 20, '316', 'fn_tablero_skus v2 (interna)',
    exists (select 1 from fn where proname = 'fn_tablero_skus' and prosrc like '%ingresos_netos%')
    and not has_function_privilege('authenticated', 'public.fn_tablero_skus(date,date)', 'EXECUTE'),
    null
  union all
  select 21, '317', 'fn_tablero_estado (interna)',
    to_regprocedure('public.fn_tablero_estado(date,date)') is not null
    and not has_function_privilege('authenticated', 'public.fn_tablero_estado(date,date)', 'EXECUTE'),
    null
  union all
  select 22, '318', 'fn_tablero_gerencial v3 (margen neto)',
    exists (select 1 from fn where proname = 'fn_tablero_gerencial' and prosrc like '%anterior_ingresos_netos%')
    and has_function_privilege('authenticated', 'public.fn_tablero_gerencial(date,date)', 'EXECUTE'),
    null
  union all
  select 23, '319', 'fn_mapa_nodo_skus v2 (margen neto)',
    exists (select 1 from fn where proname = 'fn_mapa_nodo_skus' and prosrc like '%ingresos_netos%')
    and has_function_privilege('authenticated', 'public.fn_mapa_nodo_skus(integer,date,date)', 'EXECUTE'),
    null
  union all
  select 24, '320', 'fn_mapa_semaforo v2 (% sobre ventas netas)',
    exists (select 1 from fn where proname = 'fn_mapa_semaforo' and prosrc like '%ingresos_netos%')
    and has_function_privilege('authenticated', 'public.fn_mapa_semaforo(date,date)', 'EXECUTE'),
    null
  union all
  select 25, 'T1', 'Sin funciones duplicadas',
    not exists (select 1 from fn where proname like 'fn_%' group by proname having count(*) > 1),
    (select string_agg(proname, ', ') from (select proname from fn where proname like 'fn_%'
       group by proname having count(*) > 1) d)
)
select paso,
       que_revisa,
       case when ok then '✅ ya está'
            when paso ~ '^[0-9]' then '⏳ falta correrla'
            else '⚠️ revisar' end as estado,
       detalle
from chequeos
order by orden;
