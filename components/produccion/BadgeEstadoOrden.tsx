import { cn } from '@/lib/utils'
import type { EstadoOrdenProduccion } from '@/types/database'

const CONFIG: Record<EstadoOrdenProduccion, { label: string; className: string }> = {
  borrador: {
    label: 'Borrador',
    className: 'bg-[#c8a58a]/25 text-[#6f3a2a] border-[#c8a58a]/40',
  },
  iniciada: {
    label: 'En proceso',
    className: 'bg-[#f9b44c]/20 text-[#b07d1e] border-[#f9b44c]/50',
  },
  cerrada: {
    label: 'Cerrada',
    className: 'bg-[#2f8f4e]/15 text-[#2f8f4e] border-[#2f8f4e]/30',
  },
  cancelada: {
    label: 'Cancelada',
    className: 'bg-[#c43e2c]/10 text-[#c43e2c] border-[#c43e2c]/30',
  },
}

export function BadgeEstadoOrden({ estado }: { estado: EstadoOrdenProduccion }) {
  const c = CONFIG[estado]
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
        c.className
      )}
    >
      {c.label}
    </span>
  )
}
