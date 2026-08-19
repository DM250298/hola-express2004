// Exportador genérico de tablas filtradas a Excel / PDF con la marca.
// Lo usan Stock, Centro de Compras, Vencimientos y Conteo físico (el Ranking
// ABC tiene el suyo en exportarAbc.ts, anterior a este helper). xlsx y jspdf
// pesan ~1 MB parseado cada una: se importan dinámicamente al momento de
// exportar (mismo criterio que lib/utils/cotizacion.ts).

export interface ColumnaExport {
  titulo: string
  /** Ancho de columna en Excel (caracteres). */
  wch?: number
  /** Ancho de columna en el PDF (mm); sin definir, autotable reparte. */
  pdfAncho?: number
  align?: 'left' | 'right' | 'center'
}

export interface OpcionesExportTabla {
  titulo: string
  subtitulo?: string
  /** Slug base del archivo; la fecha y la extensión se agregan solas. */
  archivo: string
  columnas: ColumnaExport[]
  /** Valores CRUDOS para Excel (números sin formatear, para seguir operando). */
  filas: (string | number)[][]
  /** Valores ya formateados para el PDF; si falta, se usan las mismas filas. */
  filasPdf?: (string | number)[][]
  /** KPIs del encabezado del PDF (máx 4 para que entren). */
  kpis?: { etiqueta: string; valor: string }[]
  /** Período opcional para el header del PDF (ISO). */
  desde?: string
  hasta?: string
}

function slugArchivo(base: string, ext: string): string {
  const f = new Date().toISOString().slice(0, 10)
  const limpio = base
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
  return `${limpio || 'export'}-${f}${ext ? `.${ext}` : ''}`
}

export async function exportarTablaExcel(o: OpcionesExportTabla): Promise<void> {
  const XLSX = await import('xlsx')
  const aoa: (string | number)[][] = [
    [`${o.titulo} — ¡Hola! Express`],
    ...(o.subtitulo ? [[o.subtitulo]] : []),
    [`Generado: ${new Date().toLocaleDateString('es-AR')}`],
    [],
    o.columnas.map((c) => c.titulo),
    ...o.filas,
  ]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = o.columnas.map((c) => ({ wch: c.wch ?? 14 }))
  const wb = XLSX.utils.book_new()
  // El nombre de hoja tolera hasta 31 caracteres.
  XLSX.utils.book_append_sheet(wb, ws, o.titulo.slice(0, 31))
  XLSX.writeFile(wb, slugArchivo(o.archivo, 'xlsx'))
}

export async function exportarTablaPDF(o: OpcionesExportTabla): Promise<void> {
  const { crearDocumentoConHeader, agregarTabla, agregarBloqueKPIs, guardarPDF } =
    await import('./pdf')

  const doc = crearDocumentoConHeader({
    titulo: o.titulo,
    subtitulo: o.subtitulo,
    desde: o.desde,
    hasta: o.hasta,
    archivo: slugArchivo(o.archivo, ''),
  })

  let y = o.desde && o.hasta ? 63 : 56
  if (o.kpis && o.kpis.length > 0) {
    y = agregarBloqueKPIs(doc, y, o.kpis.slice(0, 4)) + 2
  }

  const columnStyles: Record<
    number,
    { cellWidth?: number; halign?: 'left' | 'right' | 'center' }
  > = {}
  o.columnas.forEach((c, i) => {
    if (c.pdfAncho != null || c.align) {
      columnStyles[i] = {
        ...(c.pdfAncho != null ? { cellWidth: c.pdfAncho } : {}),
        ...(c.align ? { halign: c.align } : {}),
      }
    }
  })

  agregarTabla(
    doc,
    y,
    o.columnas.map((c) => c.titulo),
    o.filasPdf ?? o.filas,
    { columnStyles }
  )

  guardarPDF(doc, slugArchivo(o.archivo, ''))
}
