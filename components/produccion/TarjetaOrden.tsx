'use client'

import { Clock } from 'lucide-react'
import { BadgeEstadoOrden } from './BadgeEstadoOrden'
import { MontoARS } from '@/components/shared/MontoARS'
import { formatearNumero } from '@/lib/utils/formato'
import { cn } from '@/lib/utils'
import type { OrdenConProducto } from '@/lib/queries/produccion'

/** "hace 40 min" / "hace 2 h" — cuánto lleva la tanda en el horno. */
function desdeHace(iso: string): string {
  const minutos = Math.max(
    0,
    Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  )
  if (minutos < 60) return `hace ${minutos} min`
  const horas = Math.floor(minutos / 60)
  if (horas < 24) return `hace ${horas} h`
  return `hace ${Math.floor(horas / 24)} d`
}

interface Props {
  orden: OrdenConProducto
  seleccionada: boolean
  onSeleccionar: (orden: OrdenConProducto) => void
}

export function TarjetaOrden({ orden, seleccionada, onSeleccionar }: Props) {
  const esAuto = orden.nota?.includes('Reposición automática')
  const esRapida = orden.nota?.includes('Elaboración rápida')
  const cantidad =
    orden.estado === 'cerrada'
      ? (orden.cantidad_producida ?? orden.cantidad_planificada)
      : orden.cantidad_planificada

  return (
    <button
      type="button"
      onClick={() => onSeleccionar(orden)}
      className={cn(
        'w-full text-left bg-white border rounded-xl p-2.5 shadow-sm transition-colors space-y-1.5',
        seleccionada
          ? 'border-[#f9b44c] ring-1 ring-[#f9b44c]/40'
          : 'border-[#e4c9b0]/60 hover:border-[#f9b44c]'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium text-[#391511] leading-snug">
          {orden.producto?.nombre ?? '—'}
        </span>
        <BadgeEstadoOrden estado={orden.estado} />
      </div>

      <div className="flex items-center justify-between gap-2 text-xs text-[#6f3a2a]">
        <span className="tabular-nums font-semibold">
          {formatearNumero(cantidad)} {orden.producto?.unidad ?? ''}
        </span>
        {orden.costo_total > 0 && (
          <MontoARS monto={orden.costo_total} className="text-[#6f3a2a]" />
        )}
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        {esAuto && (
          <span
            className="text-[9px] font-semibold uppercase tracking-wide text-[#b07d1e] bg-[#f9b44c]/20 border border-[#f9b44c]/40 rounded px-1 py-0.5"
            title="Creada automáticamente por stock bajo el mínimo"
          >
            Auto
          </span>
        )}
        {esRapida && (
          <span
            className="text-[9px] font-semibold uppercase tracking-wide text-[#2f8f4e] bg-[#2f8f4e]/10 border border-[#2f8f4e]/30 rounded px-1 py-0.5"
            title="Elaborada en un paso"
          >
            Rápida
          </span>
        )}
        {orden.estado === 'iniciada' && orden.fecha_inicio && (
          <span className="inline-flex items-center gap-1 text-[10px] text-[#c45e14]">
            <Clock className="h-3 w-3" />
            {desdeHace(orden.fecha_inicio)}
          </span>
        )}
      </div>
    </button>
  )
}
