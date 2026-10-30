# Registro de migraciones — Hola Express

Este archivo existe porque **no hay migration runner**: las migraciones se corren a mano en el
SQL Editor de Supabase, y hasta ahora no quedaba registro de cuáles se aplicaron. Sin ese
registro no se puede clonar producción de forma confiable ni usar Branching.

## Reglas

1. **El número es el orden de aplicación.** Una migración ya aplicada es **inmutable**: no se
   renumera, no se edita, no se borra. Si hay que corregirla, se crea una nueva.
2. **Una migración pendiente sí se puede renumerar** al próximo número libre.
3. **Toda migración termina con `notify pgrst, 'reload schema';`**
4. **Después de reemitir cualquier RPC, correr el chequeo T1** (debe dar 0 filas):
   ```sql
   select proname, count(*) from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and proname like 'fn_%'
   group by proname having count(*) > 1;
   ```
5. **Al reemitir un RPC, partir SIEMPRE de la última firma real**, aunque la migración anterior
   esté pendiente. La 153 partió de una firma vieja y creó una sobrecarga duplicada que hubo
   que arreglar con la 154.
6. **Actualizar este archivo en el mismo commit que agrega la migración.**
7. **Antes de pasar a producción, correr `scripts/estado_pase_produccion.sql` en producción.**
   Revisa los objetos que crea cada migración, no esta tabla, que puede ir atrasada: el
   2026-10-16 la 251–253 figuraban corridas en producción y no estaban. Al agregar migraciones
   nuevas, sumarles una fila a esa consulta.

## Cómo se dedujo el estado

El flujo de trabajo del repo es **correr en el SQL Editor → commitear → push**. Por eso una
migración commiteada se considera aplicada, y la fecha/commit de la tabla son la evidencia
(reconstruidos de `git log --diff-filter=AR`, que sigue los renombres históricos).

Las que estaban **sin commitear** eran las dudosas, y se verificaron el **2026-08-31**
consultando el catálogo de Postgres directamente (privilegios de funciones, `reloptions` de
vistas, `proconfig` y firmas vivas en `pg_proc`).

---

## ✅ Resueltas el 2026-08-31

Las tres que estaban sin commitear. La 154 ya estaba aplicada; la 161 y la 162 se corrieron ese día.

| Nº | Archivo | Verificación posterior |
|---|---|---|
| 154 | `154_fix_overload_fn_guardar_factura_compra.sql` | Ya estaba aplicada (fecha exacta desconocida, sin commitear). Verificada: `fn_guardar_factura_compra` con **una sola firma de 12 argumentos** y chequeo T1 en 0 filas. |
| 161 | `161_blindar_rpcs_costo.sql` | `fn_costo` y `fn_set_costo` → `has_function_privilege(authenticated, EXECUTE) = false`. `fn_costo_receta` → habilitada con gate interno. Chequeo T1 → 0 filas. |
| 162 | `162_advisors_security_invoker_search_path.sql` | `vista_cobertura_stock` → `{security_invoker=true}`. Las 13 funciones → 13 de 13 con `search_path` fijo. |

## ⏳ Pendientes de correr

**321** (rama `finanzas-tablero-neto`, PR #27, oct-2026): `fn_resultado_periodo` para que
Finanzas › Tablero use el mismo margen neto que `/tablero`. Correrla en las DOS bases
(**requiere 311–313**); después `supabase/tests/test_resultado_periodo.sql` (rollback). Sin la
321 la app cae al cálculo viejo con `neto: false` y la tarjeta avisa.

Las **322 → 323 → 324** (rama `factura-margen-coherente`, PR #28) se corrieron en las dos bases
el 2026-10-29 (ver el historial). Si algo no cierra en producción:
`supabase/scripts/margen_desactualizado.sql` (solo lectura) debe dar 0 filas y
`supabase/scripts/control_mig_322_324.sql` dos `true`.


**Verificado antes de renumerar** (el riesgo real de correr una migración vieja es que pise
código nuevo):

- La `fn_costo_receta` de la 161 es **idéntica** a la última versión vigente (mig 080) más cuatro
  líneas de control. No hay regresión.
- Ninguna migración posterior a la 150 recrea `vista_cobertura_stock`, así que el `alter view`
  de la 162 se aplica sobre la versión vigente.
- El frontend nunca llama `fn_costo` ni `fn_set_costo` por `rpc()`. La única que usa directo es
  `fn_costo_receta` (`lib/queries/produccion.ts:291`), que la 161 conserva habilitada.
  **Ninguna de las dos puede romper la aplicación.**

## ❓ Pendiente de confirmar

Ninguna. Las tres migraciones que estaban sin commitear quedaron resueltas el 2026-08-31.

---

## Números duplicados (históricos, ambos aplicados)

Se dejan **como están**. Ambas versiones de cada número se aplicaron hace meses; renumerarlas
reescribiría historia real y rompería la correspondencia con los mensajes de commit.

| Nº | Archivos |
|---|---|
| 055 | `055_medios_pago_disponible_terminal.sql` · `055_pago_cuentas_parcial.sql` |
| 062 | `062_proveedores_datos_fiscales.sql` · `062_venta_por_peso_numerico.sql` |
| 063 | `063_fn_crear_venta_comision_real.sql` · `063_percepciones_compra.sql` |

## Renumeraciones

| Antes | Después | Fecha | Motivo |
|---|---|---|---|
| `045`–`049` (medios de pago MP) | `055`–`059` | 2026-06 | Colisión con las migraciones de otra tanda |
| `134_fn_cancelar_pedido.sql` | `136_fn_cancelar_pedido.sql` | 2026-08 | El working tree estaba atrasado y el 134 ya estaba tomado |
| `099_blindar_rpcs_costo.sql` | `161_blindar_rpcs_costo.sql` | 2026-08-31 | Escrita en julio, nunca aplicada (confirmado contra el catálogo) |
| `152_advisors_...sql` | `162_advisors_...sql` | 2026-08-31 | Nunca aplicada; el 152 lo ocupa `152_v2_sugerido_persistido_calendario.sql`, que sí corrió |

---

## Próximo número libre: **325**

(306–310 están tomadas por la rama `conteo-parcial-ciclico`, PR pendiente de abrir; 311–320 por la rama
`margen-neto-iva` (mergeada); la 321 por la rama `finanzas-tablero-neto` (PR #27) y 322–324 por
`factura-margen-coherente`. No reusar ninguno de esos tramos.)

---

## Historial completo

| Nº | Archivo | Estado | Fecha | Commit |
|---|---|---|---|---|
| 001 | `001_pagos_venta.sql` | ✅ aplicada | 2026-05-22 | `f42ca1e` |
| 002 | `002_productos_tipo_unidad.sql` | ✅ aplicada | 2026-05-22 | `f42ca1e` |
| 003 | `003_lotes_pedido_origen.sql` | ✅ aplicada | 2026-05-22 | `f42ca1e` |
| 004 | `004_cuentas_y_movimientos.sql` | ✅ aplicada | 2026-05-22 | `f42ca1e` |
| 005 | `005_mapeo_medio_pago_cuenta.sql` | ✅ aplicada | 2026-05-22 | `f42ca1e` |
| 006 | `006_config_medio_pago.sql` | ✅ aplicada | 2026-05-22 | `f42ca1e` |
| 007 | `007_medios_pago_dinamicos.sql` | ✅ aplicada | 2026-05-22 | `f42ca1e` |
| 008 | `008_ajustes_y_conteos.sql` | ✅ aplicada | 2026-05-22 | `f42ca1e` |
| 009 | `009_gastos_turno_y_roles.sql` | ✅ aplicada | 2026-05-22 | `f42ca1e` |
| 010 | `010_permiso_compras.sql` | ✅ aplicada | 2026-05-22 | `f42ca1e` |
| 011 | `011_etiquetas_precio.sql` | ✅ aplicada | 2026-05-22 | `f42ca1e` |
| 012 | `012_facturas_compra.sql` | ✅ aplicada | 2026-05-22 | `f42ca1e` |
| 013 | `013_productos_costo_iva.sql` | ✅ aplicada | 2026-05-22 | `f42ca1e` |
| 014 | `014_fn_crear_venta.sql` | ✅ aplicada | 2026-05-22 | `f42ca1e` |
| 015 | `015_fn_anular_venta.sql` | ✅ aplicada | 2026-05-22 | `f42ca1e` |
| 016 | `016_fn_recibir_pedido.sql` | ✅ aplicada | 2026-05-22 | `f42ca1e` |
| 017 | `017_fn_guardar_factura_compra.sql` | ✅ aplicada | 2026-05-22 | `f42ca1e` |
| 018 | `018_fn_conteo_y_ajuste.sql` | ✅ aplicada | 2026-05-22 | `f42ca1e` |
| 019 | `019_fn_movimientos_cuenta.sql` | ✅ aplicada | 2026-05-22 | `f42ca1e` |
| 020 | `020_plan_cuentas.sql` | ✅ aplicada | 2026-05-22 | `f42ca1e` |
| 021 | `021_asientos.sql` | ✅ aplicada | 2026-05-22 | `f42ca1e` |
| 022 | `022_fn_crear_venta_asiento.sql` | ✅ aplicada | 2026-05-22 | `f42ca1e` |
| 023 | `023_fn_factura_compra_asiento.sql` | ✅ aplicada | 2026-05-22 | `f42ca1e` |
| 024 | `024_fn_egreso_y_pago_asiento.sql` | ✅ aplicada | 2026-05-22 | `f42ca1e` |
| 025 | `025_conciliacion_bancaria.sql` | ✅ aplicada | 2026-05-22 | `f42ca1e` |
| 026 | `026_activos_fijos.sql` | ✅ aplicada | 2026-05-22 | `f42ca1e` |
| 027 | `027_pos_offline.sql` | ✅ aplicada | 2026-05-22 | `f42ca1e` |
| 028 | `028_clientes.sql` | ✅ aplicada | 2026-05-22 | `f42ca1e` |
| 029 | `029_rrhh.sql` | ✅ aplicada | 2026-05-22 | `f42ca1e` |
| 030 | `030_proyectos.sql` | ✅ aplicada | 2026-05-22 | `f42ca1e` |
| 031 | `031_terminales.sql` | ✅ aplicada | 2026-05-22 | `f42ca1e` |
| 032 | `032_fix_estado_lote.sql` | ✅ aplicada | 2026-05-22 | `b9feed4` |
| 033 | `033_cajero_sin_dashboard.sql` | ✅ aplicada | 2026-05-22 | `ab21cc6` |
| 034 | `034_tableros.sql` | ✅ aplicada | 2026-05-24 | `716e9c1` |
| 035 | `035_subtareas_y_secciones.sql` | ✅ aplicada | 2026-05-24 | `716e9c1` |
| 036 | `036_fix_vista_proyectos_orden.sql` | ✅ aplicada | 2026-05-24 | `f21a1c4` |
| 037 | `037_tareas_recurrentes.sql` | ✅ aplicada | 2026-05-24 | `5084370` |
| 038 | `038_vencimiento_minimo.sql` | ✅ aplicada | 2026-05-24 | `a278bfc` |
| 039 | `039_cuenta_corriente_empleado.sql` | ✅ aplicada | 2026-05-24 | `19ae6fb` |
| 040 | `040_venta_por_peso.sql` | ✅ aplicada | 2026-05-25 | `fe620b4` |
| 041 | `041_pedidos_tienda.sql` | ✅ aplicada | 2026-05-28 | `20d77ee` |
| 042 | `042_compras_unificado.sql` | ✅ aplicada | 2026-05-31 | `06d4e91` |
| 043 | `043_caja_fuerte.sql` | ✅ aplicada | 2026-05-31 | `87c1158` |
| 044 | `044_clearing_digital.sql` | ✅ aplicada | 2026-06-01 | `569d05b` |
| 045 | `045_conciliacion_bancaria.sql` | ✅ aplicada | 2026-06-04 | `1224d71` |
| 046 | `046_fix_integridad.sql` | ✅ aplicada | 2026-06-04 | `e37c0d3` |
| 047 | `047_rls_tablas_sensibles.sql` | ✅ aplicada | 2026-06-04 | `1b2420f` |
| 048 | `048_devoluciones.sql` | ✅ aplicada | 2026-06-04 | `7abaa85` |
| 049 | `049_nota_credito_pago.sql` | ✅ aplicada | 2026-06-04 | `69b8bcf` |
| 050 | `050_costos_producto.sql` | ✅ aplicada | 2026-06-04 | `faa3f3b` |
| 051 | `051_rpcs_usan_costos_producto.sql` | ✅ aplicada | 2026-06-04 | `b97bf35` |
| 052 | `052_drop_precio_costo.sql` | ✅ aplicada | 2026-06-04 | `891114f` |
| 053 | `053_cierre_periodo_auditoria.sql` | ✅ aplicada | 2026-06-04 | `e184d13` |
| 054 | `054_modulo_fiscal.sql` | ✅ aplicada | 2026-06-04 | `63e829d` |
| 055 | `055_medios_pago_disponible_terminal.sql` | ✅ aplicada | 2026-06-04 | `011935a` |
| 055 | `055_pago_cuentas_parcial.sql` | ✅ aplicada | 2026-06-04 | `d957c6e` |
| 056 | `056_medios_pago_mp_detection.sql` | ✅ aplicada | 2026-06-04 | `011935a` |
| 057 | `057_seed_medios_pago_mp.sql` | ✅ aplicada | 2026-06-04 | `011935a` |
| 058 | `058_retencion_iibb.sql` | ✅ aplicada | 2026-06-04 | `011935a` |
| 059 | `059_medios_pago_real_rates.sql` | ✅ aplicada | 2026-06-04 | `011935a` |
| 060 | `060_vista_cobertura_stock.sql` | ✅ aplicada | 2026-06-04 | `63e829d` |
| 061 | `061_fix_circuito_compras.sql` | ✅ aplicada | 2026-06-05 | `3849b69` |
| 062 | `062_proveedores_datos_fiscales.sql` | ✅ aplicada | 2026-06-05 | `af629b9` |
| 062 | `062_venta_por_peso_numerico.sql` | ✅ aplicada | 2026-06-05 | `6b9a92e` |
| 063 | `063_fn_crear_venta_comision_real.sql` | ✅ aplicada | 2026-06-05 | `dc681bd` |
| 063 | `063_percepciones_compra.sql` | ✅ aplicada | 2026-06-05 | `5203cc2` |
| 064 | `064_medios_terminal_por_tipo.sql` | ✅ aplicada | 2026-06-06 | `7971399` |
| 065 | `065_import_maestros.sql` | ✅ aplicada | 2026-06-08 | `8c244e6` |
| 066 | `066_producto_flags_imagen.sql` | ✅ aplicada | 2026-06-09 | `abbeaca` |
| 067 | `067_fn_crear_venta_controlar_stock.sql` | ✅ aplicada | 2026-06-09 | `abbeaca` |
| 068 | `068_storage_productos.sql` | ✅ aplicada | 2026-06-09 | `abbeaca` |
| 069 | `069_rls_costos_fiscal_pagos.sql` | ✅ aplicada | 2026-06-09 | `065da93` |
| 070 | `070_rls_pedidos_tienda.sql` | ✅ aplicada | 2026-06-09 | `065da93` |
| 071 | `071_controlar_stock_anular_devolucion.sql` | ✅ aplicada | 2026-06-09 | `bf7f8b2` |
| 072 | `072_fn_crear_venta_valida_turno.sql` | ✅ aplicada | 2026-06-09 | `540702a` |
| 073 | `073_comprobantes_compra.sql` | ✅ aplicada | 2026-06-09 | `76941b4` |
| 074 | `074_sugerencias_producto.sql` | ✅ aplicada | 2026-06-09 | `30182a0` |
| 075 | `075_ensanchar_costos_y_movimientos.sql` | ✅ aplicada | 2026-06-09 | `195eaac` |
| 076 | `076_circuito_stock_fraccionado.sql` | ✅ aplicada | 2026-06-09 | `195eaac` |
| 077 | `077_canonicalizar_unidad_dimension.sql` | ✅ aplicada | 2026-06-09 | `195eaac` |
| 078 | `078_enum_tipo_movimiento_produccion.sql` | ✅ aplicada | 2026-06-09 | `195eaac` |
| 079 | `079_tablas_produccion.sql` | ✅ aplicada | 2026-06-09 | `195eaac` |
| 080 | `080_fn_convertir_costo_receta.sql` | ✅ aplicada | 2026-06-09 | `195eaac` |
| 081 | `081_fn_orden_produccion.sql` | ✅ aplicada | 2026-06-09 | `195eaac` |
| 082 | `082_permiso_produccion.sql` | ✅ aplicada | 2026-06-09 | `195eaac` |
| 083 | `083_reposicion_automatica_produccion.sql` | ✅ aplicada | 2026-06-10 | `053a7b3` |
| 084 | `084_consumo_real_desfasaje.sql` | ✅ aplicada | 2026-06-10 | `3b28562` |
| 085 | `085_rrhh_empleados.sql` | ✅ aplicada | 2026-06-12 | `cc6eabd` |
| 086 | `086_gastos_no_debitables_compra.sql` | ✅ aplicada | 2026-06-11 | `b45159b` |
| 087 | `087_rrhh_asistencia.sql` | ✅ aplicada | 2026-06-12 | `cc6eabd` |
| 088 | `088_rrhh_fn_asistencia.sql` | ✅ aplicada | 2026-06-12 | `cc6eabd` |
| 089 | `089_rrhh_tareas.sql` | ✅ aplicada | 2026-06-12 | `4a78b43` |
| 090 | `090_rrhh_liquidaciones.sql` | ✅ aplicada | 2026-06-12 | `7626768` |
| 091 | `091_rrhh_desempeno.sql` | ✅ aplicada | 2026-06-13 | `6d7be0d` |
| 092 | `092_fn_insumos_a_comprar.sql` | ✅ aplicada | 2026-06-13 | `244ad25` |
| 093 | `093_desfasaje_atribucion.sql` | ✅ aplicada | 2026-06-13 | `244ad25` |
| 094 | `094_push_subscriptions.sql` | ✅ aplicada | 2026-06-14 | `daef369` |
| 095 | `095_producto_pendiente_precio.sql` | ✅ aplicada | 2026-06-15 | `9e1023f` |
| 096 | `096_rol_mostrador_unificado.sql` | ✅ aplicada | 2026-06-15 | `9e1023f` |
| 097 | `097_enum_ajuste_conteo.sql` | ✅ aplicada | 2026-07-09 | `3b05565` |
| 098 | `098_conteo_fisico_sesiones.sql` | ✅ aplicada | 2026-07-09 | `3b05565` |
| 100 | `100_backfill_053_infra.sql` | ✅ aplicada | 2026-07-09 | `3b05565` |
| 101 | `101_fix_anular_venta_enum_tipo.sql` | ✅ aplicada | 2026-07-09 | `3b05565` |
| 102 | `102_permiso_conteo_cierre_admin.sql` | ✅ aplicada | 2026-07-10 | `5837627` |
| 103 | `103_conteo_cierre_rol_real.sql` | ✅ aplicada | 2026-07-10 | `b40b739` |
| 104 | `104_conteo_diferencias_orden.sql` | ✅ aplicada | 2026-07-10 | `cbac748` |
| 105 | `105_config_ventas.sql` | ✅ aplicada | 2026-07-12 | `fc37d87` |
| 106 | `106_recepcion_multi_factura.sql` | ✅ aplicada | 2026-07-12 | `f77e53b` |
| 107 | `107_pedido_total_multifactura.sql` | ✅ aplicada | 2026-07-12 | `396d8a8` |
| 108 | `108_pricing_config.sql` | ✅ aplicada | 2026-07-13 | `1ac2f7c` |
| 109 | `109_fn_precio_venta_motor.sql` | ✅ aplicada | 2026-07-13 | `e0a4d22` |
| 110 | `110_fn_productos_a_reponer.sql` | ✅ aplicada | 2026-07-14 | `2b8f2c3` |
| 111 | `111_rls_initplan.sql` | ✅ aplicada | 2026-07-14 | `2b8f2c3` |
| 112 | `112_productos_combo.sql` | ✅ aplicada | 2026-07-15 | `8400e50` |
| 113 | `113_conciliacion_iibb.sql` | ✅ aplicada | 2026-07-16 | `659ef55` |
| 114 | `114_anulacion_conserva_categoria.sql` | ✅ aplicada | 2026-07-16 | `659ef55` |
| 115 | `115_pedidos_terminos_pago.sql` | ✅ aplicada | 2026-07-21 | `c56e894` |
| 116 | `116_fn_actualizar_pedido.sql` | ✅ aplicada | 2026-07-21 | `c56e894` |
| 117 | `117_movimientos_caja_fuerte.sql` | ✅ aplicada | 2026-07-21 | `3f516db` |
| 118 | `118_candado_caja_fuerte.sql` | ✅ aplicada | 2026-07-22 | `348c347` |
| 119 | `119_reset_saldo_caja_fuerte.sql` | ✅ aplicada | 2026-07-22 | `348c347` |
| 120 | `120_egreso_debita_cuenta.sql` | ✅ aplicada | 2026-07-22 | `2ec7d5d` |
| 121 | `121_compra_directa_schema.sql` | ✅ aplicada | 2026-07-22 | `2456865` |
| 122 | `122_fn_compra_directa.sql` | ✅ aplicada | 2026-07-22 | `2456865` |
| 123 | `123_compra_directa_control.sql` | ✅ aplicada | 2026-07-23 | `e48fd46` |
| 124 | `124_import_productos_margen.sql` | ✅ aplicada | 2026-07-23 | `445f7f7` |
| 125 | `125_import_precio_deduce_margen.sql` | ✅ aplicada | 2026-07-24 | `0c560de` |
| 126 | `126_import_par_coherente.sql` | ✅ aplicada | 2026-07-25 | `55c3ff0` |
| 127 | `127_eliminar_producto.sql` | ✅ aplicada | 2026-07-26 | `e66e483` |
| 128 | `128_cobros_terminal.sql` | ✅ aplicada | 2026-07-28 | `d0c730f` |
| 129 | `129_pedido_por_peso.sql` | ✅ aplicada | 2026-07-28 | `e0e062a` |
| 130 | `130_revertir_recepcion.sql` | ✅ aplicada | 2026-07-28 | `02443f1` |
| 131 | `131_items_pedido_cantidad_facturada.sql` | ✅ aplicada | 2026-07-30 | `170be73` |
| 132 | `132_fn_guardar_factura_reconcilia_stock.sql` | ✅ aplicada | 2026-07-30 | `170be73` |
| 133 | `133_fn_anular_factura_compra.sql` | ✅ aplicada | 2026-07-30 | `170be73` |
| 134 | `134_reactivar_pedido_cancelado.sql` | ✅ aplicada | 2026-08-03 | `6a30f9d` |
| 135 | `135_fix_trigger_transicion_revertir.sql` | ✅ aplicada | 2026-08-04 | `eea9024` |
| 136 | `136_fn_cancelar_pedido.sql` | ✅ aplicada | 2026-08-04 | `8793a4d` |
| 137 | `137_no_vino_y_orden_recepcion.sql` | ✅ aplicada | 2026-08-04 | `f70c546` |
| 138 | `138_fn_guardar_factura_precio_manual.sql` | ✅ aplicada | 2026-08-05 | `93ad841` |
| 139 | `139_cuenta_corriente_base.sql` | ✅ aplicada | 2026-08-06 | `8238e18` |
| 140 | `140_fn_crear_venta_v10_ctacte.sql` | ✅ aplicada | 2026-08-06 | `8238e18` |
| 141 | `141_cobranza_cta_cte.sql` | ✅ aplicada | 2026-08-06 | `8238e18` |
| 142 | `142_adelantos_anticipos_personal.sql` | ✅ aplicada | 2026-08-06 | `8238e18` |
| 143 | `143_autoservicio_cta_cte_empleado.sql` | ✅ aplicada | 2026-08-06 | `8238e18` |
| 144 | `144_pago_en_factura_y_forma_pago.sql` | ✅ aplicada | 2026-08-10 | `5b655d0` |
| 145 | `145_pago_multiple_en_factura.sql` | ✅ aplicada | 2026-08-10 | `1f259e9` |
| 146 | `146_redondeo_y_pagos_programados.sql` | ✅ aplicada | 2026-08-13 | `810a4e9` |
| 147 | `147_fecha_local_pagos.sql` | ✅ aplicada | 2026-08-13 | `0d8e031` |
| 148 | `148_cuotas_cuenta_pagar.sql` | ✅ aplicada | 2026-08-22 | `99df33f` |
| 149 | `149_compra_directa_cta_cte.sql` | ✅ aplicada | 2026-08-22 | `99df33f` |
| 150 | `150_stock_por_peso_decimales.sql` | ✅ aplicada | 2026-08-17 | `f66d0a4` |
| 151 | `151_compras_por_cobertura.sql` | ✅ aplicada | 2026-08-17 | `e453ed7` |
| 152 | `152_v2_sugerido_persistido_calendario.sql` | ✅ aplicada | 2026-08-18 | `4b48612` |
| 153 | `153_listas_precio_mayorista.sql` | ✅ aplicada | 2026-08-21 | `c77fd48` |
| 154 | `154_fix_overload_fn_guardar_factura_compra.sql` | ✅ aplicada | verificada 2026-08-31 | pendiente de commit |
| 155 | `155_comprobante_pago_y_datos_fiscales.sql` | ✅ aplicada | 2026-08-22 | `0ada1a3` |
| 156 | `156_costo_bonificadas_no_pisa.sql` | ✅ aplicada | 2026-08-26 | `2784d34` |
| 157 | `157_fix_bonificadas_costo_null.sql` | ✅ aplicada | 2026-08-28 | `287050e` |
| 158 | `158_tareas_multiasignacion.sql` | ✅ aplicada | 2026-08-28 | `fe80d6b` |
| 159 | `159_tareas_gestion_lee_empleados.sql` | ✅ aplicada | 2026-08-28 | `2a99e43` |
| 160 | `160_ultimo_movimiento_por_producto.sql` | ✅ aplicada | 2026-08-31 | `eade720` |
| 161 | `161_blindar_rpcs_costo.sql` | ✅ aplicada | 2026-08-31 | pendiente de commit |
| 162 | `162_advisors_security_invoker_search_path.sql` | ✅ aplicada | 2026-08-31 | pendiente de commit |
| 163 | `163_iva_venta_por_medio_pago.sql` | ✅ aplicada | 2026-09-01 | en este commit |
| 164 | `164_precio_bonificadas_costo_lista.sql` | ✅ aplicada | 2026-09-01 | `29847cb` |
| 165 | `165_produccion_ficha_y_rapida.sql` | ✅ aplicada | 2026-09-03 | en este commit |
| 166 | `166_factura_extras_mueven_stock.sql` | ✅ aplicada | 2026-09-07 | en este commit |
| 167 | `167_recepcion_no_toca_costo.sql` | ✅ aplicada | verificada 2026-09-08 | `cd21662` |
| 168 | `168_factura_guarda_iva_producto.sql` | ✅ aplicada | verificada 2026-09-08 | `c75b919` |
| 169 | `169_compra_directa_precio_congelado.sql` | ⏳ pendiente | verificado 2026-10-16: NO está en producción | en este commit |
| 170 | `170_ubicaciones_fisicas.sql` | ✅ aplicada | verificada 2026-09-15 | `ba158e3` |
| 171 | `171_costo_congelado_en_venta.sql` | ✅ aplicada | verificada 2026-09-15 | `ba158e3` |
| 172 | `172_quiebres_stock.sql` | ✅ aplicada | verificada 2026-09-15 | `ba158e3` |
| 173 | `173_metricas_sku_diarias.sql` | ✅ aplicada | verificada 2026-09-15 | `ba158e3` |
| 174 | `174_fix_snapshot_costo_null.sql` | ✅ aplicada | verificada 2026-09-15 | `970a91e` |
| 175 | `175_conteo_zonas_ubicacion.sql` | ✅ aplicada | verificada 2026-09-15 | `c2beabc` |
| 176 | `176_conteo_ancla_mapa.sql` | ✅ aplicada | verificada 2026-09-15 | `b08b521` |
| 177 | `177_marcas.sql` | ✅ aplicada | verificada 2026-09-15 | `137ddf9` |
| 178 | `178_rpcs_metricas_sku.sql` | ✅ aplicada | verificada 2026-09-15 | `137ddf9` |
| 179 | `179_permiso_tablero_ventas_diarias.sql` | ✅ aplicada | verificada 2026-09-15 | `0e28417` |
| 180 | `180_fn_metricas_agrupadas.sql` | ✅ aplicada | verificada 2026-09-15 | `0e28417` |
| 181 | `181_fn_tablero_skus.sql` | ✅ aplicada | verificada 2026-09-15 | `0e28417` |
| 182 | `182_fn_tablero_gerencial.sql` | ✅ aplicada | verificada 2026-09-15 | `0e28417` |
| 183 | `183_alertas_tablas.sql` | ✅ aplicada | verificada 2026-09-15 | `fd529f8` |
| 184 | `184_alertas_reglas_productos.sql` | ✅ aplicada | verificada 2026-09-15 (la reemplaza la 191) | `fd529f8` |
| 185 | `185_alertas_reglas_catalogo.sql` | ✅ aplicada | verificada 2026-09-15 (la reemplaza la 190) | `fd529f8` |
| 186 | `186_fn_evaluar_alertas.sql` | ✅ aplicada | verificada 2026-09-15 | `fd529f8` |
| 187 | `187_fn_alertas_lectura.sql` | ✅ aplicada | verificada 2026-09-15 | `fd529f8` |
| 188 | `188_fn_alertas_acciones.sql` | ✅ aplicada | verificada 2026-10-16 (producción) | `fd529f8` |
| 189 | `189_fn_actualizar_regla_alerta.sql` | ✅ aplicada | verificada 2026-10-16 (producción) | en este commit |
| 190 | `190_alertas_reglas_stock_real.sql` | ✅ aplicada | verificada 2026-09-15 | `4bad2e7` |
| 191 | `191_alertas_quiebre_vs_desfasaje.sql` | ✅ aplicada | verificada 2026-09-15 (la reemplaza la 192) | `4bad2e7` |
| 192 | `192_stock_desfasado_por_clase.sql` | ✅ aplicada | verificada 2026-09-15 | `99077e9` |
| 193 | `193_fn_mapa_semaforo.sql` | ✅ aplicada | 2026-09-17 | `69dc397` |
| 194 | `194_fn_mapa_nodo_skus.sql` | ✅ aplicada | 2026-09-17 | `69dc397` |
| 195 | `195_reposicion_por_sku_y_quiebres.sql` | ✅ aplicada | 2026-09-16 | `f7c7d5d` |
| 196 | `196_fn_sugerencias_compra_v3.sql` | ✅ aplicada | 2026-09-16 · ⚠️ la corrección por quiebres sobre-estima cuando el producto vendió con stock negativo (se corrige en la 197) | `f7c7d5d` |
| 197 | `197_dias_sin_stock_por_dia.sql` | ✅ aplicada | 2026-09-17 | `2b609b3` |
| 198 | `198_fn_sugerencias_compra_v4.sql` | ✅ aplicada | 2026-09-17 | `2b609b3` |
| 199 | `199_ubicaciones_mueble_categoria_marca_responsable.sql` | ✅ aplicada | 2026-09-17 | `471a3fe` |
| 200 | `200_seed_local_real.sql` | ✅ aplicada | 2026-09-17 | `471a3fe` |
| 201 | `201_alertas_reglas_espacio.sql` | ✅ aplicada | 2026-09-17 | `471a3fe` |
| 202 | `202_alertas_catalogo_llama_espacio.sql` | ✅ aplicada | 2026-09-17 | `471a3fe` |
| 203 | `203_gm01_modulos_con_6_estantes.sql` | ✅ aplicada | 2026-09-17 | `d63b96d` |
| 204 | `204_isla_y_limpieza_estantes.sql` | ✅ aplicada | 2026-09-17 | `b4bfc99` |
| 205 | `205_punteras_isla_estantes.sql` | ✅ aplicada | 2026-09-17 | `491a668` |
| 206 | `206_fix_178_join_costos_item_venta.sql` | ✅ aplicada | 2026-09-17 | `d447cda` |
| 207 | `207_stock_maximo_y_conteo_parcial.sql` | ✅ aplicada | 2026-09-17 (prueba + producción) | `2e07940` |
| 208 | `208_fix_fn_crear_movimiento.sql` | ✅ aplicada | 2026-09-23 (prueba + producción) | `483ed6c` |
| 209 | `209_rrhh_config_reseed.sql` | ✅ aplicada | 2026-09-23 (prueba + producción) | `483ed6c` |
| 210 | `210_fn_generar_liquidacion_coalesce.sql` | ✅ aplicada | 2026-09-23 (prueba + producción) | `483ed6c` |
| 211 | `211_variacion_costo_sin_overflow.sql` | ✅ aplicada | 2026-09-23 (prueba + producción) | `483ed6c` |
| 212 | `212_backfill_iva_compra_productos.sql` | ✅ aplicada | 2026-09-23 (prueba + producción) | `908fe2f` |
| 213 | `213_import_iva_compra_separado.sql` | ✅ aplicada | 2026-09-23 (prueba + producción) | `908fe2f` |
| 214 | `214_devolucion_tarjeta_debita_cuenta.sql` | ✅ aplicada | 2026-09-23 (prueba + producción) | `35c93c0` |
| 215 | `215_cerrar_deudas_saldadas.sql` | ✅ aplicada | 2026-09-23 (prueba + producción) | `35c93c0` |
| 216 | `216_arqueo_diario_boveda.sql` | ✅ aplicada | 2026-09-23 (prueba + producción) | en este commit |
| 217 | `217_tablero_compara_mismo_tramo.sql` | ✅ aplicada | 2026-09-23 (prueba + producción) | `ea8140d` |
| 218 | `218_identidad_turnos.sql` | ✅ aplicada | 2026-09-24 (prueba + producción) | `5734647` |
| 219 | `219_identidad_anular_venta_egresos.sql` | ✅ aplicada | 2026-09-25 (prueba + producción) | `c789014` |
| 220 | `220_identidad_devoluciones_cobro_fiado.sql` | ✅ aplicada | 2026-09-25 (prueba + producción) | `452294c` |
| 222 | `222_conteo_tareas_esquema.sql` | ✅ aplicada | 2026-09-29 (prueba + producción) | `b459eb2` |
| 223 | `223_conteo_alcance.sql` | ✅ aplicada | 2026-09-29 (prueba + producción) | `b459eb2` |
| 224 | `224_conteo_crear_tareas.sql` | ✅ aplicada | 2026-09-29 (prueba + producción) | `b459eb2` |
| 225 | `225_conteo_abrir_agregar_previsualizar.sql` | ✅ aplicada | 2026-09-29 (prueba + producción) | `b459eb2` |
| 226 | `226_conteo_registrar_con_alcance.sql` | ✅ aplicada | 2026-09-29 (prueba + producción) | `b459eb2` |
| 227 | `227_conteo_gestion_y_avance.sql` | ✅ aplicada | 2026-09-29 (prueba + producción) | `b459eb2` |
| 228 | `228_conteo_cerrar_zona_y_cobertura.sql` | ✅ aplicada | 2026-09-29 (prueba + producción) | `b459eb2` |
| 229 | `229_empleados_organigrama.sql` | ✅ aplicada | 2026-10-10 (prueba + producción) | `e325bfe` |
| 230 | `230_incidencias_esquema.sql` | ✅ aplicada | 2026-10-10 (prueba + producción) | `e325bfe` |
| 231 | `231_incidencias_rpcs.sql` | ✅ aplicada | 2026-10-10 (prueba + producción) | `e325bfe` |
| 232 | `232_sanciones_rpc_permiso.sql` | ✅ aplicada | 2026-10-10 (prueba + producción) | `e325bfe` |
| 233 | `233_pases_turno_esquema.sql` | ✅ aplicada | 2026-10-10 (prueba + producción) | `e325bfe` |
| 234 | `234_pases_turno_rpcs.sql` | ✅ aplicada | 2026-10-10 (prueba + producción) | `e325bfe` |
| 235 | `235_fn_dashboard_disciplina.sql` | ✅ aplicada | 2026-10-10 (prueba + producción) | `e325bfe` |
| 236 | `236_patrones_cronograma_esquema.sql` | ✅ aplicada | 2026-10-10 (prueba + producción) | `e325bfe` |
| 237 | `237_fn_generar_cronograma.sql` | ✅ aplicada | 2026-10-10 (prueba + producción) | `e325bfe` |
| 239 | `239_patrones_orden_dias.sql` | ✅ aplicada | 2026-10-10 (prueba + producción) | `e325bfe` |
| 240 | `240_fn_generar_cronograma_v2.sql` | ✅ aplicada | 2026-10-10 (prueba + producción) | `e325bfe` |
| 241 | `241_patron_francos_jul2026.sql` | ✅ aplicada | 2026-10-10 (prueba + producción) | `e325bfe` |
| 242 | `242_organigrama_datos.sql` | ✅ aplicada | 2026-10-10 (prueba + producción) | `e325bfe` |
| 243 | `243_checklists_diarios_datos.sql` | ✅ aplicada | 2026-10-10 (prueba + producción) | `e325bfe` |
| 244 | `244_fn_materializar_tareas_v3.sql` | ✅ aplicada | 2026-10-10 (prueba + producción) | `e325bfe` |
| 245 | `245_fix_rls_tareas_participantes.sql` | ✅ aplicada | 2026-10-10 (prueba + producción) | `e325bfe` |
| 246 | `246_patrones_bloques_alternados.sql` | ✅ aplicada | 2026-10-11 (prueba + producción) | `64c9c27` |
| 247 | `247_fn_generar_cronograma_v3.sql` | ✅ aplicada | 2026-10-11 (prueba + producción) | `64c9c27` |
| 248 | `248_tareas_por_puesto_esquema.sql` | ✅ aplicada | 2026-10-12 (prueba + producción) | en este commit |
| 249 | `249_fn_asignados_tareas_dia.sql` | ✅ aplicada | 2026-10-12 (prueba + producción) | en este commit |
| 250 | `250_fn_materializar_tareas_v4.sql` | ✅ aplicada | 2026-10-12 (prueba + producción) | en este commit |
| 251 | `251_tareas_horario_esquema.sql` | ✅ aplicada | 2026-10-12 (prueba) · 2026-10-16 (producción; la fecha anterior de producción era un error) | `27ebbee` |
| 252 | `252_fn_materializar_tareas_v5.sql` | ✅ aplicada | 2026-10-12 (prueba) · 2026-10-16 (producción; la fecha anterior de producción era un error) | `27ebbee` |
| 253 | `253_tareas_acciones_rpcs.sql` | ✅ aplicada | 2026-10-12 (prueba) · 2026-10-16 (producción; la fecha anterior de producción era un error) | `27ebbee` (test: `tests/test_tareas_agenda.sql`) |
| 254 | `254_organigrama_puestos_2026_10.sql` | ✅ producción · ⏳ prueba sin confirmar | 2026-10-16 (producción) | `cef332d` |
| 255 | `255_cronograma_dotacion_recalculo.sql` | ✅ aplicada | 2026-10-13 (prueba, test OK) · 2026-10-16 (producción) | `c5192cb` (test: `tests/test_cronograma_recalculo.sql`) |
| 256 | `256_cajero_fiambrero_mi_panel.sql` | ✅ aplicada | 2026-10-13 (prueba) · 2026-10-16 (producción) | `5fbc967` (D8) |
| 257 | `257_permiso_proveedores.sql` | ✅ aplicada | 2026-10-13 (prueba) · 2026-10-16 (producción) | `5fbc967` (D9; test: `tests/test_permiso_proveedores.sql`) |
| 258 | `258_rls_proveedores_escritura.sql` | ✅ aplicada | 2026-10-13 (prueba) · 2026-10-16 (producción) | `2894830` (test: `tests/test_rls_proveedores.sql`) |
| 259 | `259_revocar_funciones_sueldo.sql` | ✅ aplicada | 2026-10-16 (prueba + producción; en producción verificado con `scripts/tareas_v2_relevamiento.sql`: anon y authenticated sin EXECUTE) | en este commit (urgente: `fn_sueldo`/`fn_set_sueldo` eran ejecutables sin iniciar sesión) |
| 260 | `260_seguridad_roles_usuarios.sql` | ✅ aplicada | 2026-10-16 (prueba + producción; probada la pantalla de usuarios) | roles/usuarios: escritura solo con `usuarios_roles`, guardas anti-escalada, alta con `sin_acceso`, inactivos sin permisos |
| 261 | `261_seguridad_registro_legajos.sql` | ✅ aplicada | 2026-10-16 (producción, verificado el índice único) · prueba el mismo día, después de desvincular la cuenta duplicada de Sonia | `seguridad_eventos` inmutable, una cuenta por legajo, vincular cuenta exige `usuarios_roles`, sin borrar legajos |
| 262 | `262_tareas_estado_no_se_pudo.sql` | ✅ aplicada | 2026-10-16 (prueba + producción, pegada sola) | enum `estado_tarea_turno` + `no_se_pudo` |
| 263 | `263_tareas_v2_esquema.sql` | ✅ aplicada | 2026-10-16 (prueba + producción; verificado: 0 sin origen, 0 plantillas con hora) | tipos y columnas nuevas de rutina y agenda, backfills |
| 264 | `264_tareas_v2_registro.sql` | ✅ aplicada | 2026-10-16 (prueba + producción) | `tareas_eventos` y `tareas_pedidos`, inmutables |
| 265 | `265_tareas_v2_permisos.sql` | ✅ aplicada | 2026-10-16 (prueba + producción; antes se desactivó a Agustina Fajardo en las dos) | `tareas_admin` al rol admin; seguro de administradores |
| 266 | `266_tareas_v2_helpers.sql` | ✅ aplicada | 2026-10-16 (prueba + producción) | funciones de base: hoy, inicio/fin de turno, rango, actor, escritor del registro |
| 267 | `267_tareas_v2_trigger_agenda.sql` | ✅ aplicada | 2026-10-16 (prueba + producción; el chequeo inicial se cambió a búsqueda por nombre antes de correrla) | trigger de tareas_turno: origen, privada, horario absoluto, marcas de tocada a mano |
| 268 | `268_tareas_v2_trigger_turnos.sql` | ✅ aplicada | 2026-10-16 (prueba + producción) | al cambiar el horario de un turno, las tareas abiertas se corren y queda `turno_editado` |
| 269 | `269_tareas_v2_a_quien_le_toca.sql` | ⚠️ no se aplicó (pegado recortado) | 2026-10-16 (prueba + producción) | versión vigente de la rutina por fecha; resolvers cerrados a la app; `fn_personas_turno` y `fn_a_quien_le_toca` para gestión — **reparada por la 290–292** |
| 270 | `270_tareas_v2_sync_reasignar.sql` | ✅ aplicada | 2026-10-16 (prueba + producción) | sincronización parte 1: preparar, limpiar y reasignar según el cronograma (francos y licencias), evento `reasignada` de HEX |
| 271 | `271_tareas_v2_sincronizar.sql` | ✅ aplicada | 2026-10-16 (prueba + producción) | `fn_tareas_sincronizar` + índice único por `empleado_rutina_id` |
| 272 | `272_tareas_v2_materializar_v6.sql` | ✅ aplicada | 2026-10-16 (prueba + producción; mañana 30 tareas, 0 duplicados en las dos) | `fn_materializar_tareas_turno` v6 (sin anon) y `fn_marcar_tareas_vencidas` v3 (fin real del turno, solo puntuales, solo el cron) |
| 273 | `273_tareas_v2_operar_completar.sql` | ✅ aplicada | 2026-10-16 (prueba + producción; T1 en 0) | `fn_tarea_puede_operar` v2 (privadas solo admin, empleado hasta 2 h después del turno), `fn_tarea_puede_gestionar`, `fn_completar_tarea` con nota (DROP + CREATE) |
| 274 | `274_tareas_v2_acciones_estado.sql` | ✅ aplicada | 2026-10-16 (prueba + producción; T1 en 0) | iniciar, omitir, reabrir y rechazar con evento; `fn_tarea_no_se_pudo` nueva, cerrada a la app hasta la 283 |
| 275 | `275_tareas_v2_cancelar_trasladar.sql` | ✅ aplicada | 2026-10-16 (prueba + producción; T1 en 0) | `fn_tarea_cancelar` nueva; `fn_trasladar_tarea` v2 con evento en las dos tareas |
| 276 | `276_tareas_v2_crear_editar.sql` | ✅ aplicada | 2026-10-16 (prueba + producción; T1 en 0) | `fn_tarea_crear_puntual` y `fn_tarea_editar` nuevas; validación de horario dentro del turno |
| 277 | `277_tareas_v2_mover_corregir.sql` | ✅ aplicada | 2026-10-16 (prueba + producción; T1 en 0) | `fn_agenda_mover`, `fn_tarea_corregir_hora`, `fn_tarea_checklist_paso`, `fn_tarea_nota` |
| 278 | `278_tareas_v2_lecturas.sql` | ✅ aplicada | 2026-10-16 (prueba + producción; T1 en 0) | `fn_tarea_historial`, `fn_rutina_historial`, `fn_notas_proximo_turno`, `fn_mi_turno` |
| 279 | `279_tareas_v2_rutina_guardar.sql` | ✅ aplicada | 2026-10-16 (prueba + producción; T1 en 0) | `fn_rutina_guardar` (hoy o desde mañana, versión vigente, minutos desde el inicio), `fn_rutina_resincronizar` |
| 280 | `280_tareas_v2_rutina_quitar_pedidos.sql` | ✅ aplicada | 2026-10-16 (prueba + producción; T1 en 0) | quitar/reactivar (admin), pedidos de la encargada, `fn_pedido_resolver`, `fn_agenda_actualizar_hoy` |
| 281 | `281_tareas_v2_fotos_evidencia.sql` | ✅ aplicada | 2026-10-16 (prueba + producción; en producción no quedan reglas de editar/borrar que alcancen a `tareas-evidencia`) | fotos de evidencia: solo subir, nadie reemplaza ni borra |
| 282 | `282_tareas_v2_rls_transicion.sql` | ✅ aplicada | 2026-10-16 (prueba + producción) | RLS nueva de agenda y rutina: privadas solo `tareas_admin`; escrituras directas de transición para la app vieja (se cierran en la 285) |
| 283 | `283_tareas_v2_cumplimiento.sql` | ✅ aplicada | 2026-10-16 (prueba + producción) | `fn_cumplimiento_tareas` v3: sin canceladas, recordatorios, bloques ni privadas; `no_se_pudo` y `hechas_por_otro` aparte |
| 284 | `284_tareas_v2_desempeno.sql` | ✅ aplicada | 2026-10-16 (prueba + producción; T1 en 0) | `fn_calcular_evaluacion` v3: el puntaje de tareas cuenta solo puntuales no privadas |
| 285 | `285_tareas_v2_anexo_a_manana.sql` | ✅ aplicada | 2026-10-17 (prueba + producción) | rutina del Anexo A, mañana: 16 tareas (M01–M16) desde mañana; las viejas del turno salen de la rutina |
| 286 | `286_tareas_v2_anexo_a_tarde.sql` | ✅ aplicada | 2026-10-17 (prueba + producción) | tarde: 13 tareas (T01–T13); control y merienda a la encargada de turno, reposición grupal con el fiambrero |
| 287 | `287_tareas_v2_anexo_a_noche.sql` | ✅ aplicada | 2026-10-17 (prueba + producción; domingo 18: 16/13/15 del Anexo, 0 viejas, T1 en 0) | noche: 15 tareas (N01–N15) al vendedor de turno |
| 288 | `288_tareas_v2_cierre.sql` | ✅ aplicada | 2026-10-17 (prueba + producción) | cierre de la Etapa 1: sin escrituras directas en agenda y rutina, horarios de turno solo `tareas_admin`, "No se pudo" habilitado ("Omitir" cierra como no_se_pudo/otro), `registro_completo` |
| 289 | `289_tareas_v2_realtime.sql` | ✅ aplicada | 2026-10-17 (prueba + producción) | `tareas_turno` y participantes en Realtime (agenda en vivo, Etapa 2) |
| 290 | `290_tareas_v2_reparar_269_plantillas.sql` | ✅ aplicada | 2026-10-17 (prueba + producción) | repara la 269 (1/3): `fn_plantillas_tareas_dia` con versión vigente, cerrada a la app |
| 291 | `291_tareas_v2_reparar_269_asignados.sql` | ✅ aplicada | 2026-10-17 (prueba + producción) | repara la 269 (2/3): `fn_asignados_tareas_dia` con "cubierto", cerrada a la app |
| 292 | `292_tareas_v2_reparar_269_lecturas.sql` | ✅ aplicada | 2026-10-17 (prueba + producción; control `scripts/tareas_v2_control_funciones.sql` en 0 filas en producción) | repara la 269 (3/3): `fn_personas_turno` y `fn_a_quien_le_toca` |
| 293 | `293_tareas_v2_avisos.sql` | ✅ aplicada | 2026-10-17 (prueba + producción) | Etapa 5: `tareas_avisos` (un aviso por tarea atrasada; lo lee su destinatario y los admin; nadie lo escribe ni lo borra; en Realtime) |
| 294 | `294_tareas_v2_avisar_atrasos.sql` | ✅ aplicada | 2026-10-17 (prueba, corrida 2 veces: la encargada también por puesto; producción) | `fn_tareas_avisar_atrasos()` (solo sistema): avisa a la encargada del turno, o a los admin si la tarea es de una encargada o privada; evento `aviso_atraso` |
| 295 | `295_tareas_v2_resumen_semanal.sql` | ✅ aplicada | 2026-10-17 (prueba + producción) | `tareas_resumenes` (inmutable) + `fn_tareas_resumen_semana(lunes)` (solo admin) |
| 296 | `296_tareas_v2_programar_cron.sql` | ✅ aplicada | 2026-10-17 (prueba + producción; pg_cron activo en las dos; control en 0 y registro intocable bloqueado) | **requiere pg_cron activo.** `fn_tareas_guardar_resumen()` + procesos `hex-tareas-atrasos` (cada 5 min) y `hex-tareas-resumen` (lunes 08:00 AR) |
| 297 | `297_tareas_v2_push_temas.sql` | ✅ aplicada | 2026-10-17 (prueba + producción) | Etapa 6 B: `push_subscriptions.temas` ('produccion', 'tareas'; las viejas quedan en producción) + `tareas_avisos_push` (un envío por aviso, solo service_role) |
| 298 | `298_tareas_v2_cron_push.sql` | ✅ aplicada | 2026-10-17 (prueba sin secretos + producción con Vault y AVISOS_TAREAS_SECRET en Vercel; control en 0) | **requiere pg_net.** `fn_tareas_push_pendiente()` + proceso `hex-tareas-push` (minutos 1, 6, 11…): llama a `/api/cron/avisos-tareas` con la clave del Vault (`hex_app_url`, `hex_avisos_secret`); sin secretos (prueba) no hace nada |
| 299 | `299_tareas_v2_notificaciones.sql` | ✅ aplicada | 2026-10-17 (prueba + producción) | Etapa 7: temas `mis_tareas` / `inicio_tareas`; cola `notificaciones_push` (uno por tipo, tarea y persona; solo el sistema) y `fn_notificaciones_generar()` (urgentes = puntual alta del turno en curso; inicio = con horario, empezó hace < 10 min) |
| 300 | `300_tareas_v2_push_cada_minuto.sql` | ✅ aplicada | 2026-10-17 (prueba + producción; control en 0) | `fn_tareas_push_pendiente` v2 (también mira la cola) y `hex-tareas-push` cada minuto: genera la cola y llama a la app |
| 301 | `301_rutina_lote_guardar.sql` | ✅ aplicada | 2026-10-18 (prueba + producción) | `fn_rutina_lote_guardar` (interna): valida y crea/actualiza la rutina por `codigo`, desactiva códigos pedidos desde la vigencia; registro con origen `carga_rutina` |
| 302 | `302_rutina_cargar_lote.sql` | ✅ aplicada | 2026-10-18 (prueba + producción) | `fn_rutina_cargar_lote` (solo service_role, la usa `scripts/cargar-rutina-3-turnos.ts`): carga en una transacción, arma el día de la vigencia, simula la semana; modo prueba deshace todo. Usada para cargar las 51 tareas de `docs/rutina-3-turnos.json` (rigen desde el 19/10) |
| 303 | `303_facturas_validacion.sql` | ✅ aplicada | 2026-10-18 (prueba + producción; test con rollback OK) | Portal de facturas: `facturas_compra.validada/validada_por/validada_at/diferencia_recepcion/renglones_diferentes` (backfill: lo cargado queda validado; directas copian `controlada`), `fn_validar_factura_compra(id, validar)` (finanzas o compras; guarda el cruce recibido vs. facturado y audita) y `fn_controlar_compra_directa` reemitida (controlar = validar). Probada en PGlite con `supabase/tests/test_facturas_validacion.sql` |
| 304 | `304_facturas_validacion_historico.sql` | ✅ aplicada | 2026-10-18 (prueba + producción) | Reabre la validación de las facturas con orden que la 303 dio por validadas (backfill, `validada_por` null) y cuya deuda sigue abierta: en "A validar" salen todas las que pasaron por recepción y Finanzas no revisó. Pagadas, directas y validadas a mano no se tocan |
| 305 | `305_facturas_validacion_revertir_304.sql` | ⏳ pendiente | — | Deshace la 304 a pedido del dueño: las facturas con orden sin validar y sin `validada_por` vuelven a validadas (a "A pagar" / "Vencida"). Queda el criterio de la 303: solo lo nuevo pasa por "A validar" |
| 306–310 | *(rama `conteo-parcial-ciclico`)* | ⏳ pendiente | — | Conteo parcial y cíclico por clase ABC + ajuste de lotes con cantidad 0. Viven en esa rama hasta que se mergee su PR |
| 311 | `311_iva_en_items_venta.sql` | ⏳ pendiente | — | Margen neto de IVA (1/10): `items_venta.iva_venta` congelada por `trg_items_venta_iva` + backfill en tandas; `fn_regimen_iva()`; `config_fiscal.condicion_iva` 'monotributo' → 'monotributista' (bug de PantallaFiscal vs. motor 109/125); índice `items_devolucion(item_venta_id)` |
| 312 | `312_fn_items_neto_helpers.sql` | ⏳ pendiente | — | (2/10) `fn_items_vendidos_neto` y `fn_items_devueltos_neto(p_desde, p_hasta, p_productos[])`: LA fórmula (bruto, neto de IVA por alícuota del ítem, costo congelado; mono/exento = bruto y costo con IVA de compra). Internas, SQL puro inlineable |
| 313 | `313_fn_ventas_diarias_v2.sql` | ⏳ pendiente | — | (3/10) por día: + `ingresos_netos`, `iva`, `devoluciones`; `costo_ventas` neto de devoluciones. Conserva los nombres viejos (la 217 sigue andando hasta la 318) |
| 314 | `314_fn_resumen_skus_v3.sql` | ⏳ pendiente | — | (4/10) `costo_ventas`/`margen_pesos`/`margen_pct` pasan a NETO de IVA y devoluciones; nuevas al final `ingresos_netos`, `iva_ventas`, `devoluciones`. `ingresos` sigue bruto (ABC, participación) |
| 315 | `315_fn_metricas_agrupadas_v2.sql` | ⏳ pendiente | — | (5/10) idem por dimensión; `margen_pct` sobre ventas netas |
| 316 | `316_fn_tablero_skus_v2.sql` | ⏳ pendiente | — | (6/10) top y góndolas con `ingresos_netos`; margen % de góndola sobre neto |
| 317 | `317_fn_tablero_estado.sql` | ⏳ pendiente | — | (7/10) solo partición: quiebres, mapeo, lotes y snapshot salen de la 217 a `fn_tablero_estado` para que la 318 sea corta de pegar |
| 318 | `318_fn_tablero_gerencial_v3.sql` | ⏳ pendiente | — | (8/10) `margen` + `ingresos_netos`, `iva`, `devoluciones`, `anterior_ingresos_netos`, `regimen`, `version 3`; margen y margen_pct netos; serie con `ingresos_netos`/`devoluciones`. Ventas (hoy/ayer/semana/mes/período) siguen siendo lo cobrado con IVA |
| 319 | `319_fn_mapa_nodo_skus_v2.sql` | ⏳ pendiente | — | (9/10) margen neto en el drill-down del mapa; nueva `ingresos_netos`. Probadas las diez en PGlite (`supabase/tests/test_margen_neto_iva.sql` es el mismo caso con rollback para la base real) |
| 320 | `320_fn_mapa_semaforo_v2.sql` | ⏳ pendiente | — | (10/10) el % de margen por nodo del mapa se calcula sobre `ingresos_netos` (con la 314 el $ ya era neto y el % dividía por bruto); cada nodo trae `ingresos_netos` |
| 321 | `321_fn_resultado_periodo.sql` | ⏳ pendiente | — | Finanzas › Tablero con el mismo margen neto que `/tablero`: `fn_resultado_periodo(p_desde, p_hasta)` (jsonb, definer, permiso `finanzas`) suma `fn_ventas_diarias` v2: `ventas_brutas` (con IVA), `tickets`, `ventas_netas` (neto de IVA y devoluciones), `iva`, `devoluciones`, `cmv` (congelado, neto de devoluciones), `estimado` y `dias[]`. `getResumenFinanciero` la usa y, si falta, cae al cálculo viejo con `neto: false` (la UI avisa). Probada en PGlite; `tests/test_resultado_periodo.sql` para la base real (rollback). **Requiere 311–313.** |
| 322 | `322_factura_margen_par_coherente.sql` | ✅ aplicada | 2026-10-29 (prueba + producción, según el dueño; en prueba verificada con `scripts/paridad-precio-sql.ts` 280/280, `scripts/paridad-margen-sql.ts` 140/140 y `scripts/auditoria-precios.ts`) | `fn_guardar_factura_compra` v25 (cuerpo de la 168, misma firma): con `p_afecta_precio_venta = false` (cliente viejo) el precio no se toca pero `margen` se re-deduce con `fn_margen_desde_precio` (y `margen_mayorista` conservando `precio_mayorista`). La app ya no tiene el switch: manda `true` siempre. ~630 líneas en un statement: pegar desde el archivo |
| 323 | `323_compra_directa_margen_par_coherente.sql` | ✅ aplicada | 2026-10-29 (prueba + producción, según el dueño) | `fn_registrar_compra_directa` (cuerpo de la 169, misma firma): mismo `elsif` con el tilde apagado; `v_base_precio` = costo de la compra o el conservado. ~510 líneas en un statement |
| 324 | `324_backfill_margen_real.sql` | ✅ aplicada | 2026-10-29 (prueba + producción, según el dueño; en prueba la auditoría deja 1 inconsistente, id 3828 con precio 0) | Backfill idempotente: a cada producto activo (no combo) con precio y costo cuyo margen guardado no reproduce el precio vigente (±0,5) le pone el margen real; ídem par mayorista. No toca `precio_venta` (sin etiquetas). Antes: `scripts/margen_desactualizado.sql`; después: `scripts/control_mig_322_324.sql` y `tests/test_margen_par_coherente.sql` |

## Dos bases de Supabase (2026-09-17)

Hay **dos proyectos** y hasta hoy este registro solo reflejaba el de prueba:

| Proyecto | Ref | Uso |
|---|---|---|
| HEX-V1 | `itpgftqnxfscdvuzcvpl` | **Producción.** Es la que usa `hola-express2004.vercel.app` y donde están las ventas reales |
| (prueba) | `ykveptiqlzdqjhfslpap` | Copia de trabajo, la del `.env.local` del repo |

El 2026-09-17 producción estaba en la **169** y se le corrieron las **170 a 206** (salteando la
178, rota, reemplazada por la 206). Ambas bases quedaron en la 206.

**Regla:** una migración no está terminada hasta correrla en las DOS. Antes de dar una fase por
cerrada, verificar contra producción, no contra la copia.
