'use client'

import { formatearMontoEntero } from '@/lib/utils/formato'

export interface DatosEtiquetaPrecio {
  nombre: string
  codigo_barras: string | null
  precio_venta: number
}

interface Props {
  datos: DatosEtiquetaPrecio
}

/**
 * Tamaño de fuente del nombre según su largo, para que entre en la etiqueta
 * de 58×35mm sin desbordar (más caracteres → fuente más chica).
 */
function tamanoNombrePt(nombre: string): number {
  const n = nombre.trim().length
  if (n <= 16) return 15
  if (n <= 26) return 13
  if (n <= 38) return 11
  if (n <= 52) return 9.5
  return 8
}

/** Tamaño de fuente del precio según su largo (precios largos se achican). */
function tamanoPrecioPt(texto: string): number {
  const n = texto.length
  if (n <= 8) return 30
  if (n <= 10) return 26
  if (n <= 12) return 22
  return 18
}

/**
 * Etiqueta de precio de góndola para impresora térmica de 58mm.
 * Tamaño fijo 58×35mm; nombre y precio se autoajustan para no desbordar.
 */
export function EtiquetaPrecio({ datos }: Props) {
  const precioTexto = formatearMontoEntero(datos.precio_venta)
  return (
    <div className="etiqueta-termica etiqueta-precio">
      <div
        className="etiqueta-precio-nombre"
        style={{ fontSize: `${tamanoNombrePt(datos.nombre)}pt` }}
      >
        {datos.nombre}
      </div>
      <div
        className="etiqueta-precio-monto"
        style={{ fontSize: `${tamanoPrecioPt(precioTexto)}pt` }}
      >
        {precioTexto}
      </div>
      {datos.codigo_barras && (
        <div className="etiqueta-precio-codigo">{datos.codigo_barras}</div>
      )}
    </div>
  )
}
