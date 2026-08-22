/**
 * Helpers fiscales compartidos. Puros (sin React ni Supabase) para que los
 * puedan importar tanto los modales de carga de factura como la capa de datos.
 *
 * Nacieron duplicados en components/finanzas/ModalEditarFactura.tsx, que por
 * ahora conserva sus definiciones locales: migrarle los imports es un refactor
 * mecánico aparte, sin efecto funcional.
 */

/** Deja solo los dígitos: los CUIT se guardan pelados, sin guiones ni puntos. */
export function soloDigitos(s: string): string {
  return s.replace(/\D/g, '')
}

/** Valida un CUIT argentino: 11 dígitos + dígito verificador. */
export function cuitValido(s: string): boolean {
  const d = soloDigitos(s)
  if (d.length !== 11) return false
  const mult = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
  const suma = mult.reduce((acc, m, i) => acc + m * Number(d[i]), 0)
  const resto = suma % 11
  const verif = resto === 0 ? 0 : resto === 1 ? 9 : 11 - resto
  return verif === Number(d[10])
}

/**
 * Letra de comprobante que suele emitir un proveedor según su condición frente
 * al IVA (el receptor, Hola Express, es responsable inscripto). Es solo un
 * default editable: el que carga puede cambiarlo si la factura dice otra.
 */
export function tipoDesdeCondicionIva(cond: string | null | undefined): string {
  switch (cond) {
    case 'responsable_inscripto':
      return 'A'
    case 'monotributo':
    case 'exento':
      return 'C'
    case 'consumidor_final':
      // Un consumidor final no emite factura: lo que entrega es un ticket o
      // un recibo sin datos fiscales → X (antes sugería C, incoherente).
      return 'X'
    default:
      return 'A'
  }
}

/**
 * Tipos de comprobante de COMPRA, lista única para las tres puertas de carga
 * (Cargar factura, Compra directa, Controlar compra). X = ticket / recibo sin
 * datos fiscales: no discrimina IVA, no exige pto/número/CUIT y no entra al
 * Libro IVA. La E (exportación) se quitó: la emite un exportador a un cliente
 * del exterior, no aplica a una compra local.
 */
export const TIPOS_COMPROBANTE_COMPRA = [
  { valor: 'A', etiqueta: 'Factura A' },
  { valor: 'B', etiqueta: 'Factura B' },
  { valor: 'C', etiqueta: 'Factura C' },
  { valor: 'M', etiqueta: 'Factura M' },
  { valor: 'X', etiqueta: 'X · ticket / sin datos fiscales' },
] as const

/** Record value → label para el `items` del Select de base-ui. */
export const TIPOS_COMPROBANTE_COMPRA_ITEMS: Record<string, string> =
  Object.fromEntries(TIPOS_COMPROBANTE_COMPRA.map((t) => [t.valor, t.etiqueta]))

/**
 * ¿El tipo exige los datos fiscales (pto. venta, número y CUIT)? Todo menos X.
 * Con el tipo vacío también se exigen: obliga a elegir uno.
 */
export function exigeDatosFiscales(tipo: string | null | undefined): boolean {
  return tipo !== 'X'
}

/** Punto de venta AFIP: 1 a 5 dígitos. */
export function puntoVentaValido(s: string): boolean {
  return /^\d{1,5}$/.test(s.trim())
}

/** Número de comprobante AFIP: 1 a 8 dígitos. */
export function numeroComprobanteValido(s: string): boolean {
  return /^\d{1,8}$/.test(s.trim())
}

/**
 * Formato canónico AFIP (00001 / 00012345). Se normaliza ANTES de guardar:
 * el índice único de comprobantes y los anti-duplicados comparan texto exacto,
 * así que "1-1234" y "0001-00001234" serían dos facturas distintas. Devuelve
 * '' si no hay dígitos (el caller decide si eso es un faltante).
 */
export function normalizarPuntoVenta(s: string | null | undefined): string {
  const d = soloDigitos(s ?? '')
  return d ? d.padStart(5, '0') : ''
}

export function normalizarNumeroComprobante(s: string | null | undefined): string {
  const d = soloDigitos(s ?? '')
  return d ? d.padStart(8, '0') : ''
}

/**
 * ¿Ese tipo de comprobante discrimina IVA (o sea, da crédito fiscal)?
 * Solo A y M. Una B, C o X NO discrimina: cargarle IVA 21% inventa un crédito
 * fiscal que no existe y ensucia el Libro IVA con una fila contradictoria.
 */
export function discriminaIva(tipo: string): boolean {
  return tipo === 'A' || tipo === 'M'
}
