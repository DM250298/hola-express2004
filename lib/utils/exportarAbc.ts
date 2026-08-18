// Exportación del ranking ABC (Excel / PDF) respetando el filtro activo.
// xlsx y jspdf pesan ~1 MB parseado cada una: se importan dinámicamente al
// momento de exportar para no engordar el chunk inicial de /inventario
// (mismo criterio que lib/utils/cotizacion.ts).

/** Fila a exportar: espeja las columnas visibles de TablaABC. */
export interface FilaAbcExport {
  clase: string
  nombre: string
  codigo_barras: string | null
  categoria_nombre: string | null
  ingresos: number
  unidades_vendidas: number
  porcentaje_ingreso: number
  porcentaje_acumulado: number
  stock_actual: number
}

function etiquetaFiltro(filtro: string): string {
  return filtro === 'todas' ? 'Todas las clases' : `Clase ${filtro}`
}

function nombreArchivo(filtro: string, ext: string): string {
  const f = new Date().toISOString().slice(0, 10)
  const sufijo = filtro === 'todas' ? 'todas' : `clase-${filtro.toLowerCase()}`
  return `ranking-abc-${sufijo}-${f}.${ext}`
}

/** Excel con los productos filtrados (números crudos, para seguir operando). */
export async function generarAbcExcel(
  filas: FilaAbcExport[],
  filtro: string,
  dias: number
): Promise<void> {
  const XLSX = await import('xlsx')
  const aoa: (string | number)[][] = [
    ['Ranking ABC de ventas — ¡Hola! Express'],
    [`${etiquetaFiltro(filtro)} · últimos ${dias} días`],
    [`Generado: ${new Date().toLocaleDateString('es-AR')}`],
    [],
    [
      '#',
      'Clase',
      'Código',
      'Producto',
      'Categoría',
      'Ingresos',
      'Uds. vendidas',
      '% Ingreso',
      '% Acumulado',
      'Stock',
    ],
    ...filas.map((p, i) => [
      i + 1,
      p.clase,
      p.codigo_barras ?? '',
      p.nombre,
      p.categoria_nombre ?? '',
      Math.round(p.ingresos * 100) / 100,
      p.unidades_vendidas,
      Math.round(p.porcentaje_ingreso * 100) / 100,
      Math.round(p.porcentaje_acumulado * 10) / 10,
      p.stock_actual,
    ]),
  ]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [
    { wch: 5 },
    { wch: 6 },
    { wch: 16 },
    { wch: 44 },
    { wch: 18 },
    { wch: 14 },
    { wch: 13 },
    { wch: 10 },
    { wch: 12 },
    { wch: 12 },
  ]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Ranking ABC')
  XLSX.writeFile(wb, nombreArchivo(filtro, 'xlsx'))
}

/** PDF con encabezado de marca, KPIs y la tabla filtrada (imprimible). */
export async function generarAbcPDF(
  filas: FilaAbcExport[],
  filtro: string,
  dias: number
): Promise<void> {
  const { crearDocumentoConHeader, agregarTabla, agregarBloqueKPIs, guardarPDF } =
    await import('./pdf')

  const hasta = new Date()
  const desde = new Date()
  desde.setDate(desde.getDate() - dias)

  // guardarPDF agrega la extensión: acá va el nombre pelado.
  const base = nombreArchivo(filtro, 'pdf').replace(/\.pdf$/, '')

  const doc = crearDocumentoConHeader({
    titulo: 'Ranking ABC de ventas',
    subtitulo: `${etiquetaFiltro(filtro)} · por ingresos de los últimos ${dias} días`,
    desde: desde.toISOString(),
    hasta: hasta.toISOString(),
    archivo: base,
  })

  const totalIngresos = filas.reduce((s, p) => s + p.ingresos, 0)
  const enteroARS = new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  })
  const numero = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 3 })

  const y = agregarBloqueKPIs(doc, 63, [
    { etiqueta: 'Productos', valor: numero.format(filas.length) },
    { etiqueta: 'Ingresos del período', valor: enteroARS.format(totalIngresos) },
    { etiqueta: 'Filtro', valor: etiquetaFiltro(filtro) },
  ])

  agregarTabla(
    doc,
    y + 2,
    ['#', 'Cl.', 'Producto', 'Categoría', 'Ingresos', 'Uds.', '% Ing.', '% Ac.', 'Stock'],
    filas.map((p, i) => [
      i + 1,
      p.clase,
      p.codigo_barras ? `${p.nombre}\n${p.codigo_barras}` : p.nombre,
      p.categoria_nombre ?? '—',
      enteroARS.format(p.ingresos),
      numero.format(p.unidades_vendidas),
      `${p.porcentaje_ingreso.toFixed(2)} %`,
      `${p.porcentaje_acumulado.toFixed(1)} %`,
      numero.format(p.stock_actual),
    ]),
    {
      columnStyles: {
        0: { cellWidth: 9, halign: 'right' },
        1: { cellWidth: 8, halign: 'center', fontStyle: 'bold' },
        2: { cellWidth: 52 },
        3: { cellWidth: 24 },
        4: { cellWidth: 24, halign: 'right' },
        5: { cellWidth: 16, halign: 'right' },
        6: { cellWidth: 15, halign: 'right' },
        7: { cellWidth: 14, halign: 'right' },
        8: { cellWidth: 18, halign: 'right' },
      },
    }
  )

  guardarPDF(doc, base)
}
