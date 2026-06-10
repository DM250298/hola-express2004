'use client'

import { Loader2 } from 'lucide-react'
import { MontoARS } from '@/components/shared/MontoARS'
import { usePreviewCostoReceta } from '@/lib/hooks/useProduccion'

interface Props {
  productoId: number | undefined
  unidad: string
  /** Margen objetivo para sugerir precio (porcentaje). */
  margenObjetivo?: number
}

/**
 * Costo unitario teórico de la receta (recursivo, vía fn_costo_receta).
 * Refleja la receta GUARDADA — se actualiza al guardar.
 */
export function PanelCostoReceta({ productoId, unidad, margenObjetivo = 55 }: Props) {
  const { data: costo, isLoading } = usePreviewCostoReceta(productoId)

  const costoUnit = costo ?? 0
  const precioSugerido =
    costoUnit > 0 ? costoUnit / (1 - margenObjetivo / 100) : 0

  return (
    <div className="rounded-xl border border-[#e4c9b0]/60 bg-[#fdfaf6] p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-[#6f3a2a]">
          Costo teórico
        </span>
        {isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-[#c8a58a]" />}
      </div>

      {!productoId || costoUnit === 0 ? (
        <p className="text-sm text-[#c8a58a]">
          Guardá la receta para calcular el costo.
        </p>
      ) : (
        <div className="space-y-1">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-[#6f3a2a]">Por {unidad}</span>
            <span className="text-lg font-bold text-[#391511]">
              <MontoARS monto={costoUnit} />
            </span>
          </div>
          <div className="flex items-baseline justify-between text-xs text-[#6f3a2a]">
            <span>Precio sugerido ({margenObjetivo}% margen)</span>
            <MontoARS monto={precioSugerido} className="font-semibold" />
          </div>
        </div>
      )}
    </div>
  )
}
