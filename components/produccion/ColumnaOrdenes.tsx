'use client'

import type { ReactNode } from 'react'
import { TarjetaOrden } from './TarjetaOrden'
import type { OrdenConProducto } from '@/lib/queries/produccion'

interface Props {
  titulo: string
  /** Texto del estado vacío, en criollo. */
  vacio: string
  ordenes: OrdenConProducto[]
  seleccionadaId: number | undefined
  onSeleccionar: (orden: OrdenConProducto) => void
  /** Acción propia de la columna (ej: generar reposición). */
  accion?: ReactNode
}

/** Una columna del tablero: un estado del circuito con sus tarjetas. */
export function ColumnaOrdenes({
  titulo,
  vacio,
  ordenes,
  seleccionadaId,
  onSeleccionar,
  accion,
}: Props) {
  return (
    <div className="bg-[#fdfaf6] border border-[#e4c9b0]/60 rounded-2xl p-2.5 space-y-2 flex flex-col min-h-[180px]">
      <div className="flex items-center justify-between gap-2 px-0.5">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-bold uppercase tracking-wide text-[#6f3a2a]">
            {titulo}
          </span>
          <span className="text-[10px] font-bold tabular-nums text-[#6f3a2a] bg-white border border-[#e4c9b0]/60 rounded-full px-1.5">
            {ordenes.length}
          </span>
        </div>
        {accion}
      </div>

      {ordenes.length === 0 ? (
        <p className="text-xs text-[#c8a58a] px-1 py-6 text-center leading-snug">
          {vacio}
        </p>
      ) : (
        <div className="space-y-2">
          {ordenes.map((o) => (
            <TarjetaOrden
              key={o.id}
              orden={o}
              seleccionada={o.id === seleccionadaId}
              onSeleccionar={onSeleccionar}
            />
          ))}
        </div>
      )}
    </div>
  )
}
