import { Check, FileText, Send, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { EstadoPedido } from '@/types/database'

const CONFIG: Record<
  EstadoPedido,
  { etiqueta: string; clase: string; icono: React.ElementType }
> = {
  borrador: {
    etiqueta: 'Borrador',
    clase: 'bg-[#c8a58a]/25 text-[#6f3a2a] border-[#c8a58a]/50',
    icono: FileText,
  },
  enviado: {
    etiqueta: 'Enviado',
    clase: 'bg-[#f9b44c]/20 text-[#6f3a2a] border-[#f9b44c]/50',
    icono: Send,
  },
  recibido: {
    etiqueta: 'Recibido',
    clase: 'bg-[#6f3a2a]/10 text-[#391511] border-[#6f3a2a]/30',
    icono: Check,
  },
  cancelado: {
    etiqueta: 'Cancelado',
    clase: 'bg-[#c43e2c]/10 text-[#9e2f25] border-[#c43e2c]/30',
    icono: X,
  },
}

interface Props {
  estado: EstadoPedido
  size?: 'sm' | 'md'
  className?: string
}

export function BadgeEstadoPedido({ estado, size = 'sm', className }: Props) {
  const { etiqueta, clase, icono: Icono } = CONFIG[estado]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
        clase,
        size === 'md' && 'text-xs px-2.5 py-1',
        className
      )}
    >
      <Icono className={size === 'md' ? 'h-3.5 w-3.5' : 'h-3 w-3'} />
      {etiqueta}
    </span>
  )
}
