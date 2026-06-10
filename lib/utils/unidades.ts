/**
 * Unidades de medida y conversión para el módulo de Producción.
 *
 * Modelo "unidad natural por producto": cada producto stockea en UNA unidad
 * (productos.unidad). Una receta puede expresar el consumo en otra unidad,
 * pero SOLO dentro de la misma dimensión física (kg↔g sí, kg↔unidad jamás).
 *
 * Los factores son constantes físicas (1 kg = 1000 g), NO una tabla editable.
 * Esta lógica se replica en SQL (fn_convertir_unidad, migración 080) para que
 * el descuento de stock y el costeo conviertan igual en el servidor.
 */

export type UnidadCanonica = 'kg' | 'g' | 'lt' | 'ml' | 'unidad'
export type Dimension = 'peso' | 'volumen' | 'conteo'

/** Dimensión física de cada unidad canónica. */
export const DIMENSION_POR_UNIDAD: Record<UnidadCanonica, Dimension> = {
  kg: 'peso',
  g: 'peso',
  lt: 'volumen',
  ml: 'volumen',
  unidad: 'conteo',
}

/** Factor a la unidad base de cada dimensión (g para peso, ml para volumen). */
const FACTOR_A_BASE: Record<UnidadCanonica, number> = {
  kg: 1000,
  g: 1,
  lt: 1000,
  ml: 1,
  unidad: 1,
}

/** Etiquetas legibles para mostrar en la UI. */
export const ETIQUETA_UNIDAD: Record<UnidadCanonica, string> = {
  kg: 'kg',
  g: 'g',
  lt: 'lt',
  ml: 'ml',
  unidad: 'u',
}

/** Lista de unidades canónicas (para selects/datalists). */
export const UNIDADES: readonly UnidadCanonica[] = ['kg', 'g', 'lt', 'ml', 'unidad']

/** True si el string es una unidad canónica conocida. */
export function esUnidadCanonica(u: string): u is UnidadCanonica {
  return u in DIMENSION_POR_UNIDAD
}

/** Dimensión de una unidad canónica. */
export function dimensionDe(u: UnidadCanonica): Dimension {
  return DIMENSION_POR_UNIDAD[u]
}

/** True si dos unidades comparten dimensión (condición para convertir). */
export function mismaDimension(a: UnidadCanonica, b: UnidadCanonica): boolean {
  return DIMENSION_POR_UNIDAD[a] === DIMENSION_POR_UNIDAD[b]
}

/**
 * Convierte una cantidad entre dos unidades de la MISMA dimensión.
 * Lanza si las unidades cruzan dimensiones (kg→unidad) o no son canónicas.
 */
export function convertir(cantidad: number, desde: UnidadCanonica, hacia: UnidadCanonica): number {
  if (!esUnidadCanonica(desde) || !esUnidadCanonica(hacia)) {
    throw new Error(`Unidad no canónica: ${desde} / ${hacia}`)
  }
  if (!mismaDimension(desde, hacia)) {
    throw new Error(`No se puede convertir de ${desde} a ${hacia}: distinta dimensión`)
  }
  return (cantidad * FACTOR_A_BASE[desde]) / FACTOR_A_BASE[hacia]
}
