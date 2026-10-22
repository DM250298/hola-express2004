import type {
  ClaseConteo,
  ConteoPendienteRow,
  ConteoTareaResultado,
} from '@/types/database'

/**
 * Conteo cíclico (migs 306 a 309): cuánto se contó de cada clase ABC en la
 * ventana, qué falta y cómo describir una tarea parcial. Puro: sin red ni
 * estado, para poder probarlo con `npm test`. Las etiquetas de clase se
 * repiten de `CLASES_CONTEO` (tareas.ts) porque este archivo no puede
 * importar valores con alias `@/` bajo node --test.
 */

export const CLASES_CICLO: { clase: ClaseConteo; etiqueta: string }[] = [
  { clase: 'A', etiqueta: 'Clase A' },
  { clase: 'B', etiqueta: 'Clase B' },
  { clase: 'C', etiqueta: 'Clase C' },
  { clase: 'N', etiqueta: 'Sin ventas' },
]

export interface ResumenClase {
  clase: ClaseConteo
  etiqueta: string
  /** Productos de la clase (activos, con control de stock, sin combos). */
  total: number
  /** Contados en una sesión cerrada dentro de la ventana. */
  contados: number
  /** De los que faltan, los que ya están en una tarea de la sesión viva. */
  en_curso: number
  /** Los que faltan contar (incluye los en curso). */
  pendientes: number
}

/** Siempre las cuatro clases, en orden, aunque alguna no tenga productos. */
export function resumirPorClase(filas: ConteoPendienteRow[]): ResumenClase[] {
  return CLASES_CICLO.map(({ clase, etiqueta }) => {
    const propias = filas.filter((f) => f.clase_abc === clase)
    const contados = propias.filter((f) => f.contado_en_ventana).length
    const en_curso = propias.filter(
      (f) => !f.contado_en_ventana && f.en_tarea_abierta
    ).length
    return {
      clase,
      etiqueta,
      total: propias.length,
      contados,
      en_curso,
      pendientes: propias.length - contados,
    }
  })
}

/** Lo que falta contar de una clase, en orden de recorrido. */
export function pendientesDeClase(
  filas: ConteoPendienteRow[],
  clase: ClaseConteo
): ConteoPendienteRow[] {
  return filas
    .filter((f) => f.clase_abc === clase && !f.contado_en_ventana)
    .sort((a, b) => a.orden - b.orden)
}

/**
 * Cuántos proponer mandar a contar: la cantidad sugerida, pero nunca más que
 * lo que realmente se puede mandar (lo pendiente que no está ya en curso).
 */
export function cantidadSugerida(
  pendientes: number,
  enCurso: number,
  sugerida: number
): number {
  return Math.max(0, Math.min(sugerida, pendientes - enCurso))
}

/**
 * Los fragmentos que siguen a "N productos" en el resumen de una tarea
 * parcial, para unir con " · ". Vacío si la tarea es completa.
 */
export function fragmentosResumenParcial(
  r: Pick<
    ConteoTareaResultado,
    'productos' | 'pendientes' | 'ya_contados' | 'en_criterio' | 'limitado'
  >,
  dias: number | null
): string[] {
  const partes: string[] = []
  if (r.limitado) {
    partes.push('los primeros del recorrido', `de ${r.pendientes} pendientes`)
  }
  if (r.ya_contados > 0) {
    partes.push(
      `${r.ya_contados} ya ${r.ya_contados === 1 ? 'contado' : 'contados'}` +
        (dias != null ? ` en los últimos ${dias} días` : '')
    )
  }
  if ((r.limitado || r.ya_contados > 0) && r.en_criterio > r.productos) {
    partes.push(`${r.en_criterio} en el criterio`)
  }
  return partes
}

/** Entero positivo tipeado en un input, o null si no sirve ('' / '0' / '1.5'). */
export function parsearEntero(txt: string): number | null {
  const limpio = txt.trim()
  if (!/^\d+$/.test(limpio)) return null
  const n = Number(limpio)
  return n > 0 ? n : null
}
