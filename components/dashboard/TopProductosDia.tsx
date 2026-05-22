'use client'

import { Package, Trophy } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { MontoARS } from '@/components/shared/MontoARS'
import { useTopProductosDia } from '@/lib/hooks/useDashboard'

const MEDALLA_COLORS = ['#f9b44c', '#c8a58a', '#a07b65', '#6f3a2a', '#6f3a2a']

export function TopProductosDia() {
  const { data, isLoading, isError } = useTopProductosDia()

  return (
    <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <Trophy className="h-4 w-4 text-[#f9b44c]" />
        <h2 className="text-[#391511] font-bold">Top 5 del día</h2>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton
              key={i}
              className="h-12 w-full rounded-lg bg-[#f9d2a2]/30"
            />
          ))}
        </div>
      ) : isError ? (
        <p className="text-[#c43e2c] text-sm">No se pudo cargar el top.</p>
      ) : !data || data.length === 0 ? (
        <div className="py-8 text-center">
          <Package className="h-6 w-6 text-[#c8a58a] mx-auto mb-2" />
          <p className="text-[#6f3a2a] text-sm">Sin ventas registradas hoy.</p>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {data.map((p, i) => (
            <li
              key={p.producto_id}
              className="flex items-center gap-3 p-2 rounded-lg hover:bg-[#fdfaf6]"
            >
              <div
                className="shrink-0 h-7 w-7 rounded-full flex items-center justify-center text-xs font-extrabold text-white"
                style={{ backgroundColor: MEDALLA_COLORS[i] ?? '#6f3a2a' }}
              >
                {i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-[#391511] text-sm truncate">
                  {p.nombre}
                </div>
                <div className="text-xs text-[#6f3a2a] tabular-nums">
                  {p.unidades} {p.unidades === 1 ? 'unidad' : 'unidades'}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="font-bold text-[#391511] tabular-nums text-sm">
                  <MontoARS monto={p.total_vendido} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
