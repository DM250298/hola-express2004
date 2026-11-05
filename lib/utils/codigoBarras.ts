/** Prefijo del código que genera la base cuando el producto se da de alta sin uno (mig 065). */
const PREFIJO_AUTOGENERADO = 'HEX-'

/**
 * `true` si el código es el placeholder que genera la secuencia de la base
 * (`HEX-000123`) en vez de un código real del envase. Esos no se pueden
 * escanear en góndola, así que la UI los muestra como "sin código".
 */
export function esCodigoAutogenerado(codigo: string | null): boolean {
  return !codigo || codigo.startsWith(PREFIJO_AUTOGENERADO)
}

/**
 * Estado del código de un producto (mig 328):
 * - `real`: tiene un código de envase (no es el `HEX-…`).
 * - `pendiente`: sigue con el `HEX-…` y nadie decidió nada → la recepción
 *   NO lo deja recibir hasta cargarle el código o marcar que no lleva.
 * - `no_lleva`: alguien marcó "No tiene código de barras" (pan, verdura
 *   suelta), o es un pesable con PLU de balanza, o tiene el EAN secundario
 *   cargado: se identifica igual, así que la recepción no lo frena.
 */
export type EstadoCodigo = 'real' | 'pendiente' | 'no_lleva'

/**
 * Lo que mira `estadoCodigo`. Los flags son opcionales a propósito: una fila
 * anterior a la 328 (snapshot offline, un select sin la columna) viene sin
 * ellos y se trata como "no marcado" (`false`).
 */
export interface ProductoParaEstadoCodigo {
  codigo_barras: string | null
  sin_codigo_barras?: boolean | null
  plu_balanza?: number | null
  codigo_barras_2?: string | null
}

/** Misma regla que `trg_items_pedido_exige_codigo` (mig 328). El código real manda sobre el flag. */
export function estadoCodigo(p: ProductoParaEstadoCodigo): EstadoCodigo {
  if (!esCodigoAutogenerado(p.codigo_barras)) return 'real'
  if (
    p.sin_codigo_barras === true ||
    p.plu_balanza != null ||
    !!p.codigo_barras_2?.trim()
  ) {
    return 'no_lleva'
  }
  return 'pendiente'
}

/**
 * Texto corto para mostrar en lugar del código: el código mismo si es real,
 * qué lo identifica si no lleva (PLU o EAN secundario), "No lleva código" si
 * se marcó a mano, y "Sin código" si está pendiente.
 */
export function etiquetaCodigo(p: ProductoParaEstadoCodigo): string {
  switch (estadoCodigo(p)) {
    case 'real':
      return p.codigo_barras ?? ''
    case 'no_lleva':
      if (p.plu_balanza != null) return `PLU ${p.plu_balanza}`
      if (p.codigo_barras_2?.trim()) return p.codigo_barras_2.trim()
      return 'No lleva código'
    case 'pendiente':
      return 'Sin código'
  }
}

/** Prefijo con el que corta `trg_items_pedido_exige_codigo` (mig 328). */
export const PREFIJO_ERROR_CODIGO_PENDIENTE = 'CODIGO_PENDIENTE:'

/**
 * Traduce el error del trigger a un texto para el mostrador. Devuelve `null`
 * si el mensaje no es ese error (el caller muestra el suyo).
 */
export function traducirErrorCodigoPendiente(mensaje: string): string | null {
  const i = mensaje.indexOf(PREFIJO_ERROR_CODIGO_PENDIENTE)
  if (i < 0) return null
  const nombre = mensaje.slice(i + PREFIJO_ERROR_CODIGO_PENDIENTE.length).trim()
  const quien = nombre ? `"${nombre}"` : 'ese producto'
  return `No se puede recibir ${quien} sin código de barras. Cargale el código o marcá que no lleva, y volvé a confirmar.`
}
