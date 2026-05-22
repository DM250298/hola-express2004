'use client'

import { Sparkles } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { MontoARS } from '@/components/shared/MontoARS'
import { useProductosFrecuentesTurno } from '@/lib/hooks/useVentas'
import type { ProductoFrecuente } from '@/lib/queries/ventas'
import { cn } from '@/lib/utils'

interface Props {
  turnoId: number
  onSeleccionar: (p: ProductoFrecuente) => void
}

export function GridProductosFrecuentes({ turnoId, onSeleccionar }: Props) {
  const { data: productos, isLoading } = useProductosFrecuentesTurno(turnoId)

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Sparkles className="h-3.5 w-3.5 text-[#f9b44c]" />
        <h3 className="text-[#6f3a2a] text-xs uppercase tracking-wider font-semibold">
          Frecuentes del turno
        </h3>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square rounded-xl bg-[#f9d2a2]/30" />
          ))}
        </div>
      ) : !productos || productos.length === 0 ? (
        <div className="bg-white/60 border border-dashed border-[#e4c9b0] rounded-xl p-6 text-center">
          <p className="text-[#6f3a2a] text-sm">
            Vendé el primer producto del turno y aparecerá acá.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {productos.map((p) => {
            const sinStock = p.stock_actual <= 0
            return (
              <button
                key={p.producto_id}
                type="button"
                onClick={() => !sinStock && onSeleccionar(p)}
                disabled={sinStock}
                className={cn(
                  'aspect-square rounded-xl border bg-white p-2.5 flex flex-col justify-between text-left transition-all',
                  sinStock
                    ? 'opacity-50 cursor-not-allowed border-[#e4c9b0]/60'
                    : 'border-[#e4c9b0]/60 hover:border-[#f9b44c] hover:shadow-md active:scale-95 active:bg-[#f9d2a2]/40'
                )}
              >
                <div className="text-[#391511] font-medium text-xs leading-tight line-clamp-3">
                  {p.nombre}
                </div>
                <div>
                  <div className="text-[#391511] font-bold text-sm tabular-nums">
                    <MontoARS monto={p.precio_venta} />
                  </div>
                  <div className="text-[10px] text-[#c8a58a] mt-0.5">
                    Stock: {p.stock_actual}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
