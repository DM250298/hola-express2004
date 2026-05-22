import jsPDF from 'jspdf'
import autoTable, { type UserOptions } from 'jspdf-autotable'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

// Paleta de marca (rgb)
const COLOR_CACAO: [number, number, number] = [57, 21, 17] // #391511
const COLOR_DORADO: [number, number, number] = [249, 180, 76] // #f9b44c
const COLOR_CAFE: [number, number, number] = [111, 58, 42] // #6f3a2a
const COLOR_CREMA: [number, number, number] = [253, 250, 246] // #fdfaf6

export interface OpcionesPDF {
  titulo: string
  subtitulo?: string
  desde: string
  hasta: string
  archivo: string // nombre sin extensión
}

/** Crea un documento PDF A4 con el header de marca ya pintado. */
export function crearDocumentoConHeader(opciones: OpcionesPDF): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })

  // Banda superior con color de marca
  doc.setFillColor(...COLOR_CACAO)
  doc.rect(0, 0, 210, 28, 'F')

  // Logo textual: "¡Hola!" en dorado + "Express"
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(22)
  doc.setTextColor(...COLOR_DORADO)
  doc.text('¡Hola!', 14, 17)

  doc.setFontSize(10)
  doc.setTextColor(255, 255, 255)
  doc.text('EXPRESS', 36, 17, { baseline: 'middle' })

  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.text('Sistema de gestión · La Rioja, Argentina', 14, 23)

  // Título del reporte
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(...COLOR_CACAO)
  doc.text(opciones.titulo, 14, 40)

  if (opciones.subtitulo) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(...COLOR_CAFE)
    doc.text(opciones.subtitulo, 14, 46)
  }

  // Período
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...COLOR_CAFE)
  const formatearFecha = (iso: string) =>
    format(new Date(iso), "d 'de' MMMM 'de' yyyy", { locale: es })
  doc.text(
    `Período: ${formatearFecha(opciones.desde)} al ${formatearFecha(opciones.hasta)}`,
    14,
    opciones.subtitulo ? 52 : 46
  )

  doc.text(
    `Generado: ${format(new Date(), "d/MM/yyyy 'a las' HH:mm")}`,
    14,
    opciones.subtitulo ? 57 : 51
  )

  return doc
}

/** Agrega una tabla con estilo de marca a un documento existente. */
export function agregarTabla(
  doc: jsPDF,
  startY: number,
  head: string[],
  body: (string | number)[][],
  opts: Partial<UserOptions> = {}
): number {
  autoTable(doc, {
    startY,
    head: [head],
    body,
    theme: 'striped',
    headStyles: {
      fillColor: COLOR_CACAO,
      textColor: COLOR_DORADO,
      fontSize: 9,
      fontStyle: 'bold',
    },
    bodyStyles: {
      fontSize: 8,
      textColor: COLOR_CACAO,
    },
    alternateRowStyles: {
      fillColor: COLOR_CREMA,
    },
    styles: {
      cellPadding: 2.5,
    },
    margin: { left: 14, right: 14 },
    ...opts,
  })
  // @ts-expect-error autotable adjunta esto al doc
  return (doc.lastAutoTable?.finalY as number | undefined) ?? startY + 20
}

/** Agrega un bloque de KPIs antes de una tabla. */
export function agregarBloqueKPIs(
  doc: jsPDF,
  startY: number,
  kpis: Array<{ etiqueta: string; valor: string }>
): number {
  const ancho = 182 / kpis.length
  const alto = 18
  kpis.forEach((k, i) => {
    const x = 14 + i * ancho
    doc.setFillColor(...COLOR_CREMA)
    doc.setDrawColor(...COLOR_DORADO)
    doc.setLineWidth(0.3)
    doc.roundedRect(x, startY, ancho - 2, alto, 2, 2, 'FD')

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...COLOR_CAFE)
    doc.text(k.etiqueta.toUpperCase(), x + 3, startY + 5)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(...COLOR_CACAO)
    doc.text(k.valor, x + 3, startY + 13)
  })
  return startY + alto + 4
}

export function guardarPDF(doc: jsPDF, nombreArchivo: string) {
  doc.save(`${nombreArchivo}.pdf`)
}
