'use client'

import { Barcode, Plus } from 'lucide-react'
import { esCodigoAutogenerado } from '@/lib/utils/codigoBarras'
import { formatearCantidad } from '@/lib/utils/formato'
import type { ItemEstado } from './tipos'

interface Props {
  item: ItemEstado
  /** Lo ya recibido: base + las otras facturas de esta entrega. */
  yaTotal: number
  puedeEditarCodigo: boolean
  onCargar: () => void
  onEditarCodigo: () => void
}

/**
 * Renglón del pedido que todavía no entró a la factura en curso.
 *
 * No tiene inputs: el único gesto es "Cargar", que lo mete en el papel y abre
 * la hoja. Así la sección de abajo es una lista para buscar, no una segunda
 * pared de campos.
 */
export function FilaPendiente({
  item,
  yaTotal,
  puedeEditarCodigo,
  onCargar,
  onEditarCodigo,
}: Props) {
  const sinCodigo = esCodigoAutogenerado(item.codigo_barras)

  return (
    <li className="flex items-center gap-2 rounded-xl border border-[#e4c9b0]/60 bg-white/70 p-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-[#391511]">
          {item.nombre}
          {item.venta_por_peso && (
            <span className="ml-1.5 rounded bg-[#f9b44c]/20 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[#9e6b15]">
              Por kg
            </span>
          )}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-[#6f3a2a]">
          <span className="tabular-nums">
            Pedido {formatearCantidad(item.cantidad_pedida, item.venta_por_peso)}
          </span>
          {yaTotal > 0 && (
            <span className="tabular-nums text-[#2f7d4f]">
              ya recibido {formatearCantidad(yaTotal, item.venta_por_peso)}
            </span>
          )}
          {/* Un producto dado de alta al vuelo queda con el HEX-… autogenerado y
              no se puede escanear: el encargado le pone el código acá mismo. */}
          {sinCodigo && puedeEditarCodigo && (
            <button
              type="button"
              onClick={onEditarCodigo}
              className="flex items-center gap-1 rounded bg-[#c43e2c]/10 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[#c43e2c]"
            >
              <Barcode className="h-2.5 w-2.5" />
              Sin código
            </button>
          )}
        </p>
      </div>

      <button
        type="button"
        onClick={onCargar}
        className="flex h-10 shrink-0 items-center gap-1 rounded-lg border border-[#e4a42a]/60 bg-[#f9b44c]/20 px-3 text-xs font-bold text-[#391511] active:scale-95"
      >
        <Plus className="h-3.5 w-3.5" />
        Cargar
      </button>
    </li>
  )
}
