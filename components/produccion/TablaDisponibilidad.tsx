'use client'

import { Loader2 } from 'lucide-react'
import { Semaforo } from '@/components/shared/Semaforo'
import { formatearNumero } from '@/lib/utils/formato'
import { useDisponibilidadInsumos } from '@/lib/hooks/useProduccion'

interface Props {
  recetaId: number | undefined
  cantidad: number
}

/** Explosión de la receta: necesario vs stock por insumo, con semáforo. */
export function TablaDisponibilidad({ recetaId, cantidad }: Props) {
  const { data, isLoading } = useDisponibilidadInsumos(recetaId, cantidad)

  if (!recetaId || cantidad <= 0) {
    return (
      <p className="text-sm text-[#c8a58a]">
        Elegí una receta y la cantidad para ver la disponibilidad de insumos.
      </p>
    )
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-[#6f3a2a] py-3">
        <Loader2 className="h-4 w-4 animate-spin" />
        Calculando insumos necesarios…
      </div>
    )
  }

  if (!data || data.length === 0) {
    return <p className="text-sm text-[#c8a58a]">La receta no tiene ingredientes.</p>
  }

  return (
    <div className="rounded-lg border border-[#e4c9b0]/60 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-[#fdfaf6] text-[#6f3a2a]">
          <tr>
            <th className="text-left font-medium px-3 py-2">Insumo</th>
            <th className="text-right font-medium px-3 py-2">Necesario</th>
            <th className="text-right font-medium px-3 py-2">Stock</th>
            <th className="text-right font-medium px-3 py-2">Estado</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#e4c9b0]/30">
          {data.map((d) => (
            <tr key={d.insumo_id}>
              <td className="px-3 py-2 text-[#391511]">{d.nombre}</td>
              <td className="px-3 py-2 text-right tabular-nums text-[#6f3a2a]">
                {formatearNumero(d.necesario)} {d.unidad_stock}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-[#6f3a2a]">
                {formatearNumero(d.stock_actual)} {d.unidad_stock}
              </td>
              <td className="px-3 py-2 text-right">
                <Semaforo
                  clase={d.alcanza ? 'verde' : 'rojo'}
                  etiqueta={d.alcanza ? 'Alcanza' : 'Falta'}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
