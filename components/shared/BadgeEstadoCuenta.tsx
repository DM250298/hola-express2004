import { AlertCircle, Check, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { EstadoCuentaDerivado } from '@/lib/queries/finanzas'

const CONFIG: Record<
  EstadoCuentaDerivado,
  { etiqueta: string; clase: string; icono: React.ElementType }
> = {
  pendiente: {
    etiqueta: 'Pendiente',
    clase: 'bg-[#f9b44c]/15 text-[#6f3a2a] border-[#f9b44c]/40',
    icono: Clock,
  },
  vencida: {
    etiqueta: 'Vencida',
    clase: 'bg-[#c43e2c]/15 text-[#9e2f25] border-[#c43e2c]/40',
    icono: AlertCircle,
  },
  pagada: {
    etiqueta: 'Pagada',
    clase: 'bg-[#6f3a2a]/10 text-[#391511] border-[#6f3a2a]/30',
    icono: Check,
  },
}

interface Props {
  estado: EstadoCuentaDerivado
  size?: 'sm' | 'md'
  className?: string
}

export function BadgeEstadoCuenta({ estado, size = 'sm', className }: Props) {
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
