import jsPDF from 'jspdf'
import { agregarTabla, guardarPDF } from './pdf'
import { formatearMonto, formatearFechaCorta } from './formato'
import type {
  LiquidacionReciboRow,
  LiquidacionRenglonRow,
} from '@/types/database'

// Paleta de marca (reusada de pdf.ts, que no las exporta).
const CACAO: [number, number, number] = [57, 21, 17]
const DORADO: [number, number, number] = [249, 180, 76]
const CAFE: [number, number, number] = [111, 58, 42]

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

export interface DatosComercio {
  razonSocial: string
  cuit: string | null
  condicionIva?: string | null
}

export interface ReciboPDFArgs {
  recibo: LiquidacionReciboRow
  renglones: LiquidacionRenglonRow[]
  empleado: {
    nombre: string
    apellido: string | null
    legajo: string
    cuil: string | null
    dni: string | null
    puesto: string | null
  } | null
  periodo: string
  fechaPago: string | null
  comercio: DatosComercio
}

/** "2026-06" → "Junio 2026". */
function nombrePeriodo(periodo: string): string {
  const [anio, mes] = periodo.split('-')
  return `${MESES[Number(mes) - 1] ?? mes} ${anio}`
}

function condicionIvaLabel(c?: string | null): string {
  if (!c) return ''
  const map: Record<string, string> = {
    responsable_inscripto: 'Responsable Inscripto',
    monotributo: 'Monotributo',
    exento: 'Exento',
  }
  return map[c] ?? c
}

/** Genera y descarga el recibo de sueldo de un empleado (A4, comprobante interno). */
export function generarReciboSueldoPDF(args: ReciboPDFArgs): void {
  const { recibo, renglones, empleado, periodo, fechaPago, comercio } = args
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })

  // Banda de marca
  doc.setFillColor(...CACAO)
  doc.rect(0, 0, 210, 26, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.setTextColor(...DORADO)
  doc.text('¡Hola!', 14, 16)
  doc.setFontSize(9)
  doc.setTextColor(255, 255, 255)
  doc.text('EXPRESS', 34, 16, { baseline: 'middle' })
  doc.setFontSize(7)
  doc.setFont('helvetica', 'normal')
  doc.text('Sistema de gestión · La Rioja, Argentina', 14, 21)

  // Título + período
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  doc.setTextColor(...CACAO)
  doc.text('Recibo de sueldo', 14, 38)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(...CAFE)
  doc.text(`Período: ${nombrePeriodo(periodo)}`, 196, 38, { align: 'right' })

  // Empleador (izquierda) + Empleado (derecha)
  const y0 = 48
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...CAFE)
  doc.text('EMPLEADOR', 14, y0)
  doc.text('EMPLEADO', 110, y0)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...CACAO)
  doc.text(comercio.razonSocial || 'Hola Express', 14, y0 + 5)
  const nombreCompleto =
    [empleado?.nombre, empleado?.apellido].filter(Boolean).join(' ') ||
    `Empleado #${recibo.empleado_id}`
  doc.text(nombreCompleto, 110, y0 + 5)

  doc.setFontSize(8)
  doc.setTextColor(...CAFE)
  const lineaEmpleador = [
    comercio.cuit ? `CUIT ${comercio.cuit}` : null,
    condicionIvaLabel(comercio.condicionIva),
  ]
    .filter(Boolean)
    .join(' · ')
  if (lineaEmpleador) doc.text(lineaEmpleador, 14, y0 + 10)

  const idDoc = empleado?.cuil
    ? `CUIL ${empleado.cuil}`
    : empleado?.dni
      ? `DNI ${empleado.dni}`
      : ''
  doc.text(
    [`Legajo ${empleado?.legajo ?? '—'}`, idDoc].filter(Boolean).join(' · '),
    110,
    y0 + 10
  )
  if (empleado?.puesto) doc.text(empleado.puesto, 110, y0 + 15)

  // Resumen de asistencia
  let y = 70
  doc.setDrawColor(...DORADO)
  doc.setLineWidth(0.2)
  doc.line(14, y, 196, y)
  y += 5
  doc.setFontSize(8)
  doc.setTextColor(...CAFE)
  doc.text(
    `Días trabajados: ${recibo.dias_trabajados}  ·  Tardanzas: ${recibo.tardanzas}  ·  ` +
      `Ausencias: ${recibo.dias_ausente_injust}  ·  HE 50%: ${recibo.he50_horas} h  ·  ` +
      `HE 100%: ${recibo.he100_horas} h`,
    14,
    y
  )
  if (recibo.presentismo_perdido) {
    y += 4
    doc.setTextColor(196, 62, 44)
    doc.text(
      'Presentismo no liquidado (excede tardanzas/ausencias permitidas).',
      14,
      y
    )
  }

  // Tabla de conceptos (haberes / descuentos)
  const body = renglones.map((r) => [
    r.descripcion,
    r.clase === 'haber' ? formatearMonto(r.monto) : '',
    r.clase === 'descuento' ? formatearMonto(r.monto) : '',
  ])
  let finalY = agregarTabla(doc, y + 6, ['Concepto', 'Haberes', 'Descuentos'], body, {
    columnStyles: {
      1: { halign: 'right' },
      2: { halign: 'right' },
    },
  })

  // Totales
  finalY += 7
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...CAFE)
  doc.text('Total remunerativo', 150, finalY, { align: 'right' })
  doc.text(formatearMonto(recibo.total_remunerativo), 196, finalY, { align: 'right' })
  finalY += 5
  doc.text('Total descuentos', 150, finalY, { align: 'right' })
  doc.text(formatearMonto(recibo.total_descuentos), 196, finalY, { align: 'right' })
  finalY += 8
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(...CACAO)
  doc.text('NETO A COBRAR', 150, finalY, { align: 'right' })
  doc.text(formatearMonto(recibo.neto), 196, finalY, { align: 'right' })

  // Conformidad + firma
  finalY += 22
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...CAFE)
  doc.text(`Recibí conforme la suma de ${formatearMonto(recibo.neto)}.`, 14, finalY)
  if (fechaPago) {
    doc.text(`Fecha de pago: ${formatearFechaCorta(fechaPago)}`, 14, finalY + 5)
  }
  doc.setDrawColor(...CAFE)
  doc.line(120, finalY, 196, finalY)
  doc.text('Firma y aclaración del empleado', 158, finalY + 4, { align: 'center' })

  // Pie
  doc.setFontSize(7)
  doc.setTextColor(...CAFE)
  doc.text(
    'Comprobante interno de pago de haberes. No reemplaza el recibo de ley.',
    14,
    287
  )

  const slug =
    nombreCompleto
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || `empleado-${recibo.empleado_id}`
  guardarPDF(doc, `recibo-${slug}-${periodo}`)
}
