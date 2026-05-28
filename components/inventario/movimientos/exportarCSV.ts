import { formatearFechaHora } from '@/lib/utils/formato'
import type { MovimientoCompleto } from '@/lib/queries/movimientosStock'

/**
 * Exporta la lista de movimientos a un archivo CSV y lo descarga.
 */
export function exportarMovimientosCSV(movimientos: MovimientoCompleto[]) {
  const encabezados = [
    'Fecha',
    'Producto',
    'Código de barras',
    'Categoría',
    'Tipo',
    'Cantidad',
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
    String(m.cantidad),
    String(m.stock_anterior),
    String(m.stock_nuevo),
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
