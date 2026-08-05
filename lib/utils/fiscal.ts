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
    case 'consumidor_final':
      return 'C'
    default:
      return 'A'
  }
}

/**
 * ¿Ese tipo de comprobante discrimina IVA (o sea, da crédito fiscal)?
 * Solo A y M. Una B, C o X NO discrimina: cargarle IVA 21% inventa un crédito
 * fiscal que no existe y ensucia el Libro IVA con una fila contradictoria.
 */
export function discriminaIva(tipo: string): boolean {
  return tipo === 'A' || tipo === 'M'
}
