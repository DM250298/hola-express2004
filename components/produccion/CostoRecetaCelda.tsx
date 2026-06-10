'use client'

import { MontoARS } from '@/components/shared/MontoARS'
import { usePreviewCostoReceta } from '@/lib/hooks/useProduccion'

/** Costo unitario de una receta para mostrar en una celda de tabla. */
export function CostoRecetaCelda({ productoId }: { productoId: number }) {
  const { data: costo, isLoading } = usePreviewCostoReceta(productoId)
  if (isLoading) return <span className="text-[#c8a58a] text-xs">…</span>
  return <MontoARS monto={costo ?? 0} className="font-semibold text-[#391511]" />
}
