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
 * Tamaño de fuente del nombre según su largo, para que entre a lo ancho de la
 * etiqueta de 80mm (rollo continuo) sin desbordar. El alto es libre, así que
 * un nombre largo puede envolver a 2 líneas; sólo achicamos para que no se
 * pase de los ~72mm útiles por línea (más caracteres → fuente más chica).
 */
function tamanoNombrePt(nombre: string): number {
  const n = nombre.trim().length
  if (n <= 20) return 22
  if (n <= 34) return 18
  if (n <= 50) return 15
  return 12.5
}

/**
 * Tamaño de fuente del precio según su largo (precios largos se achican).
 * Calibrado para los ~72mm útiles de la etiqueta de 80mm en fuente monospace.
 */
function tamanoPrecioPt(texto: string): number {
  const n = texto.length
  if (n <= 7) return 46
  if (n <= 8) return 40
  if (n <= 10) return 32
  if (n <= 12) return 26
  return 22
}

/**
 * Etiqueta de precio de góndola para impresora térmica de 80mm.
 * Ancho fijo 80mm y alto automático (rollo continuo, corte entre etiquetas);
 * nombre y precio se autoajustan para no desbordar el ancho.
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
