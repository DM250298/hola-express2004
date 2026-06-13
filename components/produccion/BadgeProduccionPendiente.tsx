'use client'

import { usePendientesProduccion } from '@/lib/hooks/useProduccion'
import { cn } from '@/lib/utils'

/** Badge con la cantidad de órdenes pendientes de elaborar (borradores). */
export function BadgeProduccionPendiente({ activo }: { activo?: boolean }) {
  const { data: count } = usePendientesProduccion()
  if (!count || count <= 0) return null
  return (
    <span
      className={cn(
        'ml-auto min-w-5 h-5 px-1.5 rounded-full text-[10px] font-bold flex items-center justify-center shrink-0',
        activo ? 'bg-[#391511] text-[#f9b44c]' : 'bg-[#c43e2c] text-white'
      )}
      title={`${count} producto(s) pendiente(s) de elaborar`}
    >
      {count}
    </span>
  )
}
