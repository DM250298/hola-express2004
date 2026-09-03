'use client'

import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { formatearFechaCortaISO, formatearNumero } from '@/lib/utils/formato'
import { textoLote } from '@/lib/utils/lote'
import type { DatosEtiquetaElaboracion } from '@/lib/queries/produccion'

export type VarianteEtiqueta = 'unidad' | 'bandeja'

/** Bloques opcionales de la etiqueta (el usuario los prende y apaga). */
export interface OpcionesEtiqueta {
  ingredientes: boolean
  alergenos: boolean
  conservacion: boolean
  elaborador: boolean
}

/**
 * Qué trae cada plantilla por defecto. En la etiqueta de la unidad la lista de
 * ingredientes se omite (no entra legible en una etiqueta chica); los alérgenos
 * sí van, porque son el dato de seguridad.
 */
export const OPCIONES_POR_VARIANTE: Record<VarianteEtiqueta, OpcionesEtiqueta> = {
  unidad: {
    ingredientes: false,
    alergenos: true,
    conservacion: true,
    elaborador: true,
  },
  bandeja: {
    ingredientes: true,
    alergenos: true,
    conservacion: true,
    elaborador: true,
  },
}

/**
 * Tamaño del nombre según su largo, calibrado a los ~72mm útiles del rollo de
 * 80mm. Función pura por cantidad de caracteres, igual que EtiquetaPrecio: no
 * hay medición del DOM en el proyecto y no hace falta.
 */
function tamanoNombrePt(nombre: string, variante: VarianteEtiqueta): number {
  const base = variante === 'bandeja' ? 17 : 15
  const n = nombre.length
  if (n <= 20) return base
  if (n <= 32) return base - 2.5
  if (n <= 46) return base - 5
  return base - 6.5
}

/** "12 UNIDADES", "1 UNIDAD", "2,5 KG" — se lee de lejos en la bandeja. */
function textoCantidad(cantidad: number, unidad: string): string {
  const numero = formatearNumero(cantidad)
  if (unidad === 'unidad' || unidad === 'u') {
    return `${numero} ${cantidad === 1 ? 'UNIDAD' : 'UNIDADES'}`
  }
  return `${numero} ${unidad.toUpperCase()}`
}

interface Props {
  datos: DatosEtiquetaElaboracion
  variante: VarianteEtiqueta
  opciones: OpcionesEtiqueta
  /** Cantidad impresa en la etiqueta de bandeja (default: lo producido). */
  cantidadPorEtiqueta?: number
}

/**
 * Etiqueta de elaboración para el rollo térmico de 80mm.
 *
 * `unidad` se pega a cada pieza; `bandeja` a la bandeja o a la bolsa de la
 * docena y suma el bloque de cantidad y la lista de ingredientes. Las dos
 * cuelgan de `.etiqueta-termica`, que en @media print corta el rollo después
 * de cada etiqueta.
 */
export function EtiquetaElaboracion({
  datos,
  variante,
  opciones,
  cantidadPorEtiqueta,
}: Props) {
  const esBandeja = variante === 'bandeja'
  const elaborado = new Date(datos.elaborado_en)
  const cantidad = cantidadPorEtiqueta ?? datos.cantidad

  return (
    <div className="etiqueta-termica etiqueta-elab">
      <div
        className="etiqueta-elab-nombre"
        style={{ fontSize: `${tamanoNombrePt(datos.producto_nombre, variante)}pt` }}
      >
        {datos.producto_nombre}
      </div>

      {esBandeja && (
        <div className="etiqueta-elab-cantidad">
          {textoCantidad(cantidad, datos.unidad)}
        </div>
      )}

      <div className="etiqueta-elab-fila">
        ELABORADO{' '}
        {format(elaborado, esBandeja ? 'dd/MM/yyyy HH:mm' : 'dd/MM HH:mm', {
          locale: es,
        })}
      </div>

      {datos.vence_el ? (
        <>
          <div className="etiqueta-elab-vence-label">CONSUMIR ANTES DE</div>
          <div className="etiqueta-elab-vence-fecha">
            {formatearFechaCortaISO(datos.vence_el)}
          </div>
        </>
      ) : (
        <div className="etiqueta-elab-vence-label">SIN FECHA DE VENCIMIENTO</div>
      )}

      {opciones.ingredientes && datos.ingredientes && (
        <div className="etiqueta-elab-bloque">
          INGREDIENTES: {datos.ingredientes}.
        </div>
      )}

      {opciones.alergenos && datos.alergenos && (
        <div className="etiqueta-elab-alergenos">CONTIENE: {datos.alergenos}.</div>
      )}

      {opciones.conservacion && datos.conservacion && (
        <div className="etiqueta-elab-conservacion">{datos.conservacion}</div>
      )}

      <div className="etiqueta-elab-pie">
        {textoLote(datos.lote_id, datos.orden_id, datos.elaborado_en)}
        {opciones.elaborador && datos.elaborado_por
          ? ` · Elab. ${datos.elaborado_por}`
          : ''}
      </div>
    </div>
  )
}
