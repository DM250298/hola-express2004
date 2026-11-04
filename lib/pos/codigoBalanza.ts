// ╔══════════════════════════════════════════════════════════════════════╗
// ║  Etiquetas de balanza (mig 326)                                        ║
// ║                                                                        ║
// ║  La balanza del mostrador imprime un EAN-13 por pieza pesada:          ║
// ║    "20" + PLU (5 dígitos) + gramos (5 dígitos) + dígito verificador.   ║
// ║  Ej: 2000001002704 → PLU 1, 270 g. El código NO trae el precio: el     ║
// ║  POS cobra el precio_venta (por kg) del producto que tiene ese PLU.    ║
// ║                                                                        ║
// ║  Lógica pura, sin imports con alias: la corre `node --test`            ║
// ║  (lib/pos/codigoBalanza.test.ts).                                      ║
// ╚══════════════════════════════════════════════════════════════════════╝

/**
 * Prefijo que imprime la balanza del local. Los EAN-13 que empiezan con 2
 * son de uso interno (no los asigna GS1), así que no chocan con los códigos
 * de fábrica. Si se cambia la balanza y usa otro prefijo (21–29), es acá.
 */
export const PREFIJO_BALANZA = '20'

export interface EtiquetaBalanza {
  /** Número de PLU del producto en la balanza (1..99999). */
  plu: number
  /** Peso leído de la etiqueta, en kg con 3 decimales (gramos / 1000). */
  kg: number
}

/** true si los 13 dígitos cierran con el dígito verificador EAN-13. */
export function validarDigitoEan13(codigo: string): boolean {
  if (!/^\d{13}$/.test(codigo)) return false
  let suma = 0
  for (let i = 0; i < 12; i++) {
    const d = codigo.charCodeAt(i) - 48
    suma += i % 2 === 0 ? d : d * 3
  }
  const esperado = (10 - (suma % 10)) % 10
  return esperado === codigo.charCodeAt(12) - 48
}

/**
 * Lee una etiqueta de balanza. Devuelve null si no lo es: no son 13 dígitos,
 * no empieza con el prefijo, el verificador no cierra, PLU 0 o 0 gramos
 * (el ejemplo del import de Excel, 2000000000015, tiene PLU 0 y se rechaza).
 */
export function parsearCodigoBalanza(codigo: string): EtiquetaBalanza | null {
  const cod = codigo.trim()
  if (!/^\d{13}$/.test(cod)) return null
  if (!cod.startsWith(PREFIJO_BALANZA)) return null
  if (!validarDigitoEan13(cod)) return null
  const plu = Number(cod.slice(2, 7))
  const gramos = Number(cod.slice(7, 12))
  if (plu < 1 || gramos < 1) return null
  return { plu, kg: gramos / 1000 }
}

/** Lo mínimo que hace falta de un producto para resolver un escaneo. */
export interface CandidatoEscaneo {
  codigo_barras: string | null
  codigo_barras_2: string | null
  plu_balanza: number | null
}

export interface EleccionEscaneo<T> {
  producto: T
  /** kg de la etiqueta; null si el código era un código fijo del producto. */
  kg: number | null
}

/**
 * Entre los candidatos que devolvió la consulta (por código exacto o por PLU),
 * elige el producto. Gana el que tiene ese código EXACTO como principal o
 * secundario (kg null: es un código fijo que casualmente empieza con 20); si
 * no, el que tiene el PLU de la etiqueta (kg de la etiqueta). Genérico para
 * usarlo igual online (Supabase) y offline (snapshot en IndexedDB).
 */
export function elegirProductoEscaneado<T extends CandidatoEscaneo>(
  candidatos: T[],
  codigo: string,
  etiqueta: EtiquetaBalanza | null
): EleccionEscaneo<T> | null {
  const cod = codigo.trim()
  const exacto = candidatos.find(
    (c) => c.codigo_barras === cod || c.codigo_barras_2 === cod
  )
  if (exacto) return { producto: exacto, kg: null }
  if (!etiqueta) return null
  const porPlu = candidatos.find((c) => c.plu_balanza === etiqueta.plu)
  return porPlu ? { producto: porPlu, kg: etiqueta.kg } : null
}

/** Tope del PLU: la etiqueta lo imprime con 5 dígitos. */
export const PLU_MAXIMO = 99999

/**
 * Valida lo tipeado en un campo de PLU (ficha, POS, celular; mig 327). Acepta
 * espacios alrededor y ceros a la izquierda ("00004" → 4, como lo imprime la
 * etiqueta).
 */
export function validarPluTexto(
  valor: string
): { plu: number; error?: undefined } | { plu?: undefined; error: string } {
  const t = valor.trim()
  if (!t) return { error: 'Poné el número de PLU.' }
  if (!/^\d+$/.test(t)) {
    return { error: 'El PLU es un número entero, sin letras ni comas.' }
  }
  const n = Number(t)
  if (n < 1 || n > PLU_MAXIMO) {
    return { error: `El PLU va de 1 a ${PLU_MAXIMO}.` }
  }
  return { plu: n }
}
