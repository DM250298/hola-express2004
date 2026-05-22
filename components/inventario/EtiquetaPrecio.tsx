'use client'

import { formatearMonto } from '@/lib/utils/formato'

export interface DatosEtiquetaPrecio {
  nombre: string
  codigo_barras: string | null
  precio_venta: number
}

interface Props {
  datos: DatosEtiquetaPrecio
}

/**
 * Etiqueta de precio de góndola para impresora térmica de 58mm.
 * Muestra el nombre del producto, el precio en grande y el código de barras.
 */
export function EtiquetaPrecio({ datos }: Props) {
  return (
    <div className="etiqueta-termica">
      <div className="etiqueta-precio-nombre">{datos.nombre}</div>
      <div className="etiqueta-precio-monto">
        {formatearMonto(datos.precio_venta)}
      </div>
      {datos.codigo_barras && (
        <div className="etiqueta-precio-codigo">{datos.codigo_barras}</div>
      )}
    </div>
  )
}
