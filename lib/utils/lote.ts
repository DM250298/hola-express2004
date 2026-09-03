/**
 * Código de lote legible para la etiqueta de elaboración.
 *
 * Cuando el producido controla stock hay una fila en `lotes` y se imprime su
 * id, que es el mismo que se ve en Vencimientos. Pero si el producto tiene
 * `controlar_stock = false` el cierre no crea lote (`lote_id` vuelve NULL) y la
 * etiqueta igual tiene que llevar un identificador: se deriva de la orden y la
 * fecha, que son estables y únicos.
 */
export function codigoLoteDerivado(ordenId: number, fechaISO: string): string {
  const d = new Date(fechaISO)
  const anio = d.getFullYear()
  const mes = String(d.getMonth() + 1).padStart(2, '0')
  const dia = String(d.getDate()).padStart(2, '0')
  return `L${anio}${mes}${dia}-${String(ordenId).padStart(4, '0')}`
}

/** Lo que se imprime: el lote real si existe, si no el derivado de la orden. */
export function textoLote(
  loteId: number | null,
  ordenId: number,
  fechaISO: string
): string {
  return loteId != null
    ? `Lote #${loteId}`
    : codigoLoteDerivado(ordenId, fechaISO)
}
