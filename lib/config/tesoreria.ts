/**
 * Flags de configuración de Tesorería / Caja fuerte.
 *
 * MOSTRAR_REMESAS: el dueño no deposita efectivo en el banco por ahora, así que
 * el circuito de remesas (botón "Depositar en el banco", KPI "Depositado" y card
 * "Remesas recientes") se oculta de la UI. El código y el RPC `fn_generar_remesa`
 * quedan intactos: poner esto en `true` reactiva todo sin tocar datos.
 */
export const MOSTRAR_REMESAS = false
