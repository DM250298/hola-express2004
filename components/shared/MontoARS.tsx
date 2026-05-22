import { formatearMonto } from '@/lib/utils/formato'
import { cn } from '@/lib/utils'

interface Props {
  monto: number
  className?: string
}

export function MontoARS({ monto, className }: Props) {
  return (
    <span className={cn('tabular-nums', className)}>
      {formatearMonto(monto)}
    </span>
  )
}
