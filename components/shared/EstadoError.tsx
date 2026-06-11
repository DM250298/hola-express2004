'use client'

import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface Props {
  /** Mensaje en lenguaje llano. */
  mensaje?: string
  /** Acción de reintento (típicamente el refetch de la query). */
  onReintentar?: () => void
  className?: string
}

/**
 * Bloque de error de carga para distinguir "falló la consulta" de "no hay datos".
 * Sin esto, un error de red se ve igual que un estado vacío y el dueño cree
 * que no le deben plata / que no tiene nada por cobrar.
 */
export function EstadoError({
  mensaje = 'No pudimos cargar los datos. Revisá tu conexión e intentá de nuevo.',
  onReintentar,
  className,
}: Props) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-[#e4c9b0]/60 bg-[#fdfaf6] px-6 py-10 text-center',
        className
      )}
    >
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#c43e2c]/10">
        <AlertTriangle className="h-5 w-5 text-[#c43e2c]" />
      </div>
      <p className="max-w-sm text-sm text-[#6f3a2a]">{mensaje}</p>
      {onReintentar && (
        <Button
          variant="outline"
          size="sm"
          onClick={onReintentar}
          className="border-[#e4c9b0] text-[#6f3a2a]"
        >
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          Reintentar
        </Button>
      )}
    </div>
  )
}
