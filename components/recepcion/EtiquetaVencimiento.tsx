'use client'

import { formatearFechaCorta } from '@/lib/utils/formato'

export interface DatosEtiqueta {
  producto_nombre: string
  codigo_barras: string | null
  fecha_vencimiento: string // ISO yyyy-MM-dd
  fecha_ingreso?: string // ISO opcional
  lote_id?: number | null
}

interface Props {
  datos: DatosEtiqueta
}

/**
 * Una etiqueta individual de 58mm de ancho.
 * El layout está calibrado para impresoras térmicas comunes (Xprinter,
 * Epson TM-T20, Sat-thermal de 58mm). El alto se ajusta al contenido.
 *
 * Importante: el render es siempre en HTML estructurado para que en el
 * @media print el navegador imprima cada etiqueta con un corte de papel
 * (page-break-after: always).
 */
export function EtiquetaVencimiento({ datos }: Props) {
  const fechaIngresoTexto = datos.fecha_ingreso
    ? formatearFechaCorta(datos.fecha_ingreso)
    : formatearFechaCorta(new Date().toISOString())

  return (
    <div className="etiqueta-termica">
      {/* Producto */}
      <div className="etiqueta-producto">{datos.producto_nombre}</div>

      {/* Código de barras como texto monoespaciado.
          Si en el futuro se necesita el barcode visual, agregar JsBarcode acá. */}
      {datos.codigo_barras && (
        <div className="etiqueta-codigo">{datos.codigo_barras}</div>
      )}

      {/* Bloque destacado: VENCIMIENTO */}
      <div className="etiqueta-vence-label">VENCE</div>
      <div className="etiqueta-vence-fecha">
        {formatearFechaCorta(datos.fecha_vencimiento)}
      </div>

      {/* Pie con lote e ingreso */}
      <div className="etiqueta-pie">
        {datos.lote_id != null && (
          <>Lote #{datos.lote_id} · </>
        )}
        Ing {fechaIngresoTexto}
      </div>
    </div>
  )
}
