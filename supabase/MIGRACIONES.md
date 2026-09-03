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

Ninguna.


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

## Próximo número libre: **166**

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
