import { cn } from '@/lib/utils'
import type { ClaseVencimiento } from '@/lib/queries/vencimientos'

const CONFIG: Record<
  ClaseVencimiento,
  { etiqueta: string; clase: string; punto: string }
> = {
  vencido: {
    etiqueta: 'Vencido',
    clase: 'bg-[#c43e2c]/15 text-[#9e2f25] border-[#c43e2c]/40',
    punto: 'bg-[#9e2f25]',
  },
  rojo: {
    etiqueta: 'Urgente',
    clase: 'bg-[#c43e2c]/10 text-[#c43e2c] border-[#c43e2c]/30',
    punto: 'bg-[#c43e2c]',
  },
  amarillo: {
    etiqueta: 'Atención',
    clase: 'bg-[#e4a42a]/20 text-[#6f3a2a] border-[#e4a42a]/50',
    punto: 'bg-[#e4a42a]',
  },
  verde: {
    etiqueta: 'OK',
    clase: 'bg-[#f9b44c]/15 text-[#6f3a2a] border-[#f9b44c]/40',
    punto: 'bg-[#6f3a2a]',
  },
}

interface Props {
  clase: ClaseVencimiento
  etiqueta?: string
  size?: 'sm' | 'md'
  className?: string
}

export function Semaforo({ clase, etiqueta, size = 'sm', className }: Props) {
  const config = CONFIG[clase]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
        config.clase,
        size === 'md' && 'text-xs px-2.5 py-1',
        className
      )}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          config.punto,
          clase !== 'verde' && 'animate-pulse'
        )}
      />
      {etiqueta ?? config.etiqueta}
    </span>
  )
}
