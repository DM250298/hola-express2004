import { formatearFechaHora, formatearNumero } from '@/lib/utils/formato'
import type { MovimientoCompleto } from '@/lib/queries/movimientosStock'

/**
 * Exporta la lista de movimientos a un archivo CSV y lo descarga.
 *
 * Las cantidades van con `formatearNumero` (es-AR) y no con `String()`: los
 * productos por peso guardan decimales, y `String(4.777)` da "4.777", que
 * Excel en es-AR lee como cuatro mil setecientos setenta y siete kilos.
 */
export function exportarMovimientosCSV(movimientos: MovimientoCompleto[]) {
  const encabezados = [
    'Fecha',
    'Producto',
    'Código de barras',
    'Categoría',
    'Tipo',
    'Cantidad',
    'Unidad',
    'Stock anterior',
    'Stock nuevo',
    'Origen',
    'Turno',
    'Usuario',
  ]

  const filas = movimientos.map((m) => [
    formatearFechaHora(m.created_at),
    m.producto_nombre,
    m.producto_codigo_barras ?? '',
    m.categoria_nombre ?? '',
    m.tipo,
    formatearNumero(m.cantidad),
    m.producto_por_peso ? 'kg' : 'u.',
    formatearNumero(m.stock_anterior),
    formatearNumero(m.stock_nuevo),
    m.origen_label,
    m.turno,
    m.usuario_nombre ?? '',
  ])

  const csv = [encabezados, ...filas]
    .map((fila) =>
      fila.map((celda) => `"${celda.replace(/"/g, '""')}"`).join(',')
    )
    .join('\n')

  // BOM para que Excel detecte UTF-8
  const blob = new Blob(['﻿' + csv], {
    type: 'text/csv;charset=utf-8;',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `movimientos_stock_${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
