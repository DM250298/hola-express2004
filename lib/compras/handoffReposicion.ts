/**
 * Handoff de Reposición → editor de orden de compra.
 *
 * La pestaña Reposición no crea más un borrador suelto: arma la selección
 * (proveedor + items sugeridos) y la deja en `sessionStorage` para que
 * `FormularioNuevoPedido` la levante pre-cargada. Así hay UNA sola pantalla
 * para armar la orden, y el usuario revisa y la crea/envía desde ahí.
 */

const HANDOFF_KEY = 'compras:handoff-reposicion'

/** Item pre-cargado en el editor. Coincide con `ItemFormulario` del editor. */
export interface ItemHandoffReposicion {
  producto_id: number
  nombre: string
  codigo_barras: string | null
  cantidad_pedida: number
  precio_costo: number
}

export interface HandoffReposicion {
  proveedor_id: number
  items: ItemHandoffReposicion[]
}

/** Guarda la selección de Reposición antes de navegar al editor. */
export function guardarHandoffReposicion(handoff: HandoffReposicion): void {
  try {
    sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(handoff))
  } catch {
    // sessionStorage no disponible: el editor simplemente arranca vacío.
  }
}

/**
 * Levanta la selección pendiente (una sola vez) y la borra del storage,
 * para que un refresh posterior no la vuelva a cargar.
 */
export function tomarHandoffReposicion(): HandoffReposicion | null {
  try {
    const raw = sessionStorage.getItem(HANDOFF_KEY)
    if (!raw) return null
    sessionStorage.removeItem(HANDOFF_KEY)
    return JSON.parse(raw) as HandoffReposicion
  } catch {
    return null
  }
}
