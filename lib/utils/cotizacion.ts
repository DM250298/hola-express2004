// xlsx y jspdf pesan ~1 MB parseado cada una: se importan dinámicamente al
// momento de exportar para no engordar el chunk inicial de /compras.

export interface ItemCotizacion {
  codigo: string
  nombre: string
  cantidad: number
}

function slug(texto: string): string {
  return (
    texto
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'proveedor'
  )
}

function nombreArchivo(proveedor: string, ext: string): string {
  const f = new Date().toISOString().slice(0, 10)
  return `cotizacion-${slug(proveedor)}-${f}.${ext}`
}

/** Genera y descarga la cotización en Excel (el proveedor completa precios). */
export async function generarCotizacionExcel(
  proveedor: string,
  items: ItemCotizacion[]
): Promise<void> {
  const XLSX = await import('xlsx')
  const fecha = new Date().toLocaleDateString('es-AR')
  const aoa: (string | number)[][] = [
    ['Solicitud de cotización — ¡Hola! Express'],
    [`Proveedor: ${proveedor}`],
    [`Fecha: ${fecha}`],
    [],
    ['Código', 'Producto', 'Cantidad', 'Precio unitario', 'Subtotal'],
    ...items.map((it) => [it.codigo, it.nombre, it.cantidad, '', '']),
  ]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [
    { wch: 16 },
    { wch: 42 },
    { wch: 10 },
    { wch: 16 },
    { wch: 16 },
  ]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Cotización')
  XLSX.writeFile(wb, nombreArchivo(proveedor, 'xlsx'))
}

/** Genera y descarga la cotización en PDF (documento formal imprimible). */
export async function generarCotizacionPDF(
  proveedor: string,
  items: ItemCotizacion[]
): Promise<void> {
  const [{ default: JsPDF }, { agregarTabla }] = await Promise.all([
    import('jspdf'),
    import('./pdf'),
  ])
  const doc = new JsPDF({ unit: 'mm', format: 'a4' })

  // Banda de marca
  doc.setFillColor(57, 21, 17)
  doc.rect(0, 0, 210, 28, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(22)
  doc.setTextColor(249, 180, 76)
  doc.text('¡Hola!', 14, 17)
  doc.setFontSize(10)
  doc.setTextColor(255, 255, 255)
  doc.text('EXPRESS', 36, 17, { baseline: 'middle' })
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.text('Sistema de gestión · La Rioja, Argentina', 14, 23)

  // Título
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(57, 21, 17)
  doc.text('Solicitud de cotización', 14, 40)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(111, 58, 42)
  doc.text(`Proveedor: ${proveedor}`, 14, 47)
  doc.text(`Fecha: ${new Date().toLocaleDateString('es-AR')}`, 14, 52)

  const y = agregarTabla(
    doc,
    58,
    ['Código', 'Producto', 'Cantidad', 'Precio unit.', 'Subtotal'],
    items.map((it) => [it.codigo, it.nombre, it.cantidad, '', ''])
  )

  doc.setFontSize(9)
  doc.setTextColor(111, 58, 42)
  doc.text(
    'Complete los precios unitarios y devuelva esta cotización. ¡Gracias!',
    14,
    y + 8
  )

  doc.save(nombreArchivo(proveedor, 'pdf'))
}
