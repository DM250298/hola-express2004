import { AlertCircle, Check, HandCoins } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Estado de la cuenta corriente (fiado) de un deudor. No hay documentos con
 * vencimiento (a diferencia de BadgeEstadoCuenta): el libro solo tiene saldo
 * y tope.
 *  · al_dia    → saldo 0 (o a favor)
 *  · con_deuda → debe, pero con cupo disponible
 *  · sin_cupo  → debe y no tiene más crédito (o nunca se le habilitó)
 */
export type EstadoSaldoCtaCte = 'al_dia' | 'con_deuda' | 'sin_cupo'

/** Deriva el estado desde saldo + tiene_cupo (con tolerancia de centavo). */
export function estadoSaldoCtaCte(
  saldo: number,
  tieneCupo: boolean
): EstadoSaldoCtaCte {
  if (saldo <= 0.009) return 'al_dia'
  return tieneCupo ? 'con_deuda' : 'sin_cupo'
}

const CONFIG: Record<
  EstadoSaldoCtaCte,
  { etiqueta: string; clase: string; icono: React.ElementType }
> = {
  al_dia: {
    etiqueta: 'Al día',
    clase: 'bg-[#2f8f4e]/10 text-[#2f8f4e] border-[#2f8f4e]/30',
    icono: Check,
  },
  con_deuda: {
    etiqueta: 'Con deuda',
    clase: 'bg-[#f9b44c]/15 text-[#6f3a2a] border-[#f9b44c]/40',
    icono: HandCoins,
  },
  sin_cupo: {
    etiqueta: 'Sin cupo',
    clase: 'bg-[#c43e2c]/15 text-[#9e2f25] border-[#c43e2c]/40',
    icono: AlertCircle,
  },
}

interface Props {
  estado: EstadoSaldoCtaCte
  size?: 'sm' | 'md'
  className?: string
}

export function BadgeSaldoCtaCte({ estado, size = 'sm', className }: Props) {
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
