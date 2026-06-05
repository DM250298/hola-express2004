import * as XLSX from 'xlsx'
import type { LibroIvaCompras } from '@/lib/queries/fiscal'

export interface DatosComercioLibro {
  razon_social: string
  cuit: string
}

/** 'AAAA-MM-DD' → 'DD/MM/AAAA' sin problemas de timezone. */
function fechaCorta(iso: string): string {
  const [a, m, d] = iso.split('-')
  if (!a || !m || !d) return iso
  return `${d}/${m}/${a}`
}

/** 'AAAA-MM' → 'MM/AAAA'. */
function periodoLegible(periodo: string): string {
  const [a, m] = periodo.split('-')
  return m ? `${m}/${a}` : periodo
}

/**
 * Genera y descarga el Libro IVA Compras en Excel (.xlsx), discriminado por
 * alícuota, con encabezado del comercio y fila de totales.
 */
export function exportarLibroIvaCompras(
  libro: LibroIvaCompras,
  periodo: string,
  comercio: DatosComercioLibro
): void {
  const { lineas, totales } = libro

  const encabezados = [
    'Fecha',
    'Tipo',
    'Pto vta',
    'Número',
    'CUIT',
    'Proveedor',
    'Neto 21%',
    'IVA 21%',
    'Neto 10,5%',
    'IVA 10,5%',
    'Neto 27%',
    'IVA 27%',
    'Exento/No grav.',
    'Perc. IVA',
    'Perc. IIBB',
    'Total',
    'CAE',
  ]

  const aoa: (string | number)[][] = [
    [comercio.razon_social || 'Hola Express'],
    [`CUIT: ${comercio.cuit || '—'}`],
    ['Libro IVA Compras'],
    [`Período: ${periodoLegible(periodo)}`],
    [],
    encabezados,
    ...lineas.map((l) => [
      fechaCorta(l.fecha),
      l.tipo_comprobante ?? '',
      l.punto_venta ?? '',
      l.numero_comprobante ?? '',
      l.cuit_proveedor ?? '',
      l.proveedor_nombre,
      l.neto21,
      l.iva21,
      l.neto105,
      l.iva105,
      l.neto27,
      l.iva27,
      l.exento,
      l.perc_iva,
      l.perc_iibb,
      l.total,
      l.cae ?? '',
    ]),
    [],
    [
      '',
      '',
      '',
      '',
      '',
      'TOTALES',
      totales.neto21,
      totales.iva21,
      totales.neto105,
      totales.iva105,
      totales.neto27,
      totales.iva27,
      totales.exento,
      totales.perc_iva,
      totales.perc_iibb,
      totales.total,
      '',
    ],
  ]

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [
    { wch: 11 }, // Fecha
    { wch: 5 }, // Tipo
    { wch: 8 }, // Pto vta
    { wch: 12 }, // Número
    { wch: 13 }, // CUIT
    { wch: 30 }, // Proveedor
    { wch: 12 }, // Neto 21
    { wch: 11 }, // IVA 21
    { wch: 12 }, // Neto 10,5
    { wch: 11 }, // IVA 10,5
    { wch: 12 }, // Neto 27
    { wch: 11 }, // IVA 27
    { wch: 14 }, // Exento
    { wch: 11 }, // Perc. IVA
    { wch: 11 }, // Perc. IIBB
    { wch: 13 }, // Total
    { wch: 16 }, // CAE
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Libro IVA Compras')
  XLSX.writeFile(wb, `libro_iva_compras_${periodo}.xlsx`)
}
