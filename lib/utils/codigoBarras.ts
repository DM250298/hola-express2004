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
