/**
 * Flags de configuración de Stock.
 *
 * MOSTRAR_CONTEOS_ASIGNADOS: el flujo viejo de "Conteos de mercadería"
 * (tablas `conteos` / `conteos_items`: el gestor asigna una lista a un
 * empleado, este la cuenta y el gestor la aprueba) ya no se usa: lo reemplazó
 * el Conteo físico por zonas (`conteo_sesiones`, /inventario/conteo). Decisión
 * D7 del dueño (2026-10-13). En `false` se esconden sus entradas: la pestaña
 * Conteo de Control de stock, "Conteos asignados" del celular y la tarjeta
 * "Conteos por aprobar" de Stock. Las tablas, las queries y los componentes
 * quedan intactos: poner esto en `true` lo reactiva sin tocar datos.
 * El Conteo rápido del celular (ajuste directo) no depende de este flag.
 */
export const MOSTRAR_CONTEOS_ASIGNADOS = false

/**
 * Conteo parcial y cíclico (migs 306 a 309). Una tarea puede saltear lo
 * contado en una sesión cerrada hace menos de N días y quedarse con los
 * primeros N productos del recorrido. Estos son los valores que propone la
 * pantalla; el encargado los cambia en cada tarea.
 */
export const DIAS_SIN_CONTAR_DEFAULT = 30
export const CANTIDAD_PARCIAL_SUGERIDA = 50
