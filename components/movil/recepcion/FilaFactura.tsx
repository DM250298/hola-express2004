'use client'

import { AlertTriangle, Calendar, ChevronDown, ChevronUp } from 'lucide-react'
import { aTipeo } from '@/lib/utils/fechaCorta'
import { formatearCantidad } from '@/lib/utils/formato'
import type { CargaRenglon } from '@/lib/recepcion/borrador'
import type { ItemEstado } from './tipos'
import { cn } from '@/lib/utils'

interface Props {
  item: ItemEstado
  carga: CargaRenglon | undefined
  /** N° de renglón en el papel, continuando desde las facturas anteriores. */
  renglon: number
  /** Lo ya recibido: base + las otras facturas de esta entrega. */
  yaTotal: number
  /** Resaltado del último escaneo. */
  activo: boolean
  primero: boolean
  ultimo: boolean
  onEditar: () => void
  onMover: (direccion: -1 | 1) => void
}

/**
 * Renglón que ya está en el papel de la factura. Es una fila COMPACTA de solo
 * lectura: se toca para corregirla en la hoja de carga.
 *
 * Antes cada renglón era una tarjeta con dos inputs, y con 40 renglones la
 * pantalla era una pared imposible de leer. Compacta entran 8 o 10 de una, que
 * es lo que hace que reordenar con las flechas sea usable: se ve a dónde va.
 */
export function FilaFactura({
  item,
  carga,
  renglon,
  yaTotal,
  activo,
  primero,
  ultimo,
  onEditar,
  onMover,
}: Props) {
  const cantidad = Number(carga?.cantidad) || 0
  const sinCantidad = cantidad <= 0
  const sinFecha = !carga?.fecha_vencimiento && !carga?.sin_vencimiento
  const diferencia = yaTotal + cantidad - item.cantidad_pedida

  return (
    <li
      className={cn(
        'flex items-stretch gap-2 rounded-xl border bg-white p-2 shadow-sm transition',
        activo
          ? 'border-[#f9b44c] ring-2 ring-[#f9b44c]/40'
          : sinCantidad
            ? 'border-[#e4a42a]/70 bg-[#f9b44c]/10'
            : 'border-[#e4c9b0]/70'
      )}
    >
      <button
        type="button"
        onClick={onEditar}
        className="flex min-w-0 flex-1 items-center gap-2 text-left active:opacity-70"
      >
        <span
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums',
            sinCantidad
              ? 'bg-[#e4a42a] text-white'
              : 'bg-[#f9b44c] text-[#391511]'
          )}
        >
          {renglon}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-[#391511]">
            {item.nombre}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
            {sinCantidad ? (
              <span className="font-semibold text-[#9e6b15]">
                Falta la cantidad
              </span>
            ) : (
              <span className="font-semibold tabular-nums text-[#391511]">
                {formatearCantidad(cantidad, item.venta_por_peso)}
                {item.venta_por_peso ? ' kg' : ' u.'}
              </span>
            )}

            {carga?.sin_vencimiento ? (
              <span className="text-[#6f3a2a]">no vence</span>
            ) : carga?.fecha_vencimiento ? (
              <span className="flex items-center gap-0.5 tabular-nums text-[#6f3a2a]">
                <Calendar className="h-3 w-3" />
                {aTipeo(carga.fecha_vencimiento)}
              </span>
            ) : (
              <span className="flex items-center gap-0.5 text-[#9e6b15]">
                <Calendar className="h-3 w-3" />
                sin fecha
              </span>
            )}

            {!sinCantidad && diferencia !== 0 && !Number.isNaN(diferencia) && (
              <span
                className={cn(
                  'tabular-nums',
                  diferencia > 0 ? 'text-[#9e6b15]' : 'text-[#c43e2c]'
                )}
              >
                {diferencia > 0 ? '+' : '−'}
                {formatearCantidad(Math.abs(diferencia), item.venta_por_peso)} vs.
                pedido
              </span>
            )}
          </span>
        </span>

        {(sinCantidad || sinFecha) && (
          <AlertTriangle className="h-4 w-4 shrink-0 text-[#e4a42a]" />
        )}
      </button>

      {/* Orden del papel. Aparecen en TODOS los renglones de la factura, tengan
          cantidad o no: poder acomodar uno recién escaneado antes de cargarlo
          es justamente lo que faltaba. */}
      <div className="flex shrink-0 flex-col justify-between gap-1">
        <button
          type="button"
          onClick={() => onMover(-1)}
          disabled={primero}
          aria-label={`Subir ${item.nombre} un lugar`}
          className="flex h-7 w-9 items-center justify-center rounded-md border border-[#e4c9b0] bg-[#fdfaf6] text-[#9e6b15] active:scale-95 disabled:opacity-25"
        >
          <ChevronUp className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onMover(1)}
          disabled={ultimo}
          aria-label={`Bajar ${item.nombre} un lugar`}
          className="flex h-7 w-9 items-center justify-center rounded-md border border-[#e4c9b0] bg-[#fdfaf6] text-[#9e6b15] active:scale-95 disabled:opacity-25"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>
    </li>
  )
}
