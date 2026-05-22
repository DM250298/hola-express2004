import { AlertTriangle, Circle, XOctagon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { EstadoStock } from '@/lib/queries/inventario'

const CONFIG: Record<
  EstadoStock,
  { etiqueta: string; clase: string; icono: React.ElementType }
> = {
  normal: {
    etiqueta: 'Normal',
    clase: 'bg-[#f9b44c]/15 text-[#6f3a2a] border-[#f9b44c]/40',
    icono: Circle,
  },
  bajo: {
    etiqueta: 'Bajo',
    clase: 'bg-[#e4a42a]/20 text-[#6f3a2a] border-[#e4a42a]/50',
    icono: AlertTriangle,
  },
  critico: {
    etiqueta: 'Crítico',
    clase: 'bg-[#c43e2c]/15 text-[#9e2f25] border-[#c43e2c]/40',
    icono: XOctagon,
  },
}

interface Props {
  estado: EstadoStock
  size?: 'sm' | 'md'
  className?: string
}

export function BadgeEstadoStock({ estado, size = 'sm', className }: Props) {
  const { etiqueta, clase, icono: Icono } = CONFIG[estado]
  const dimIcono = size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
        clase,
        size === 'md' && 'text-xs px-2.5 py-1',
        className
      )}
    >
      <Icono className={dimIcono} />
      {etiqueta}
    </span>
  )
}
