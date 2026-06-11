'use client'

import type { ReactNode } from 'react'
import { HelpCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover'

interface Props {
  /** Explicación en lenguaje llano (lo que entiende el dueño, no el contador). */
  children: ReactNode
  /** Ejemplo concreto opcional; se muestra resaltado abajo. */
  ejemplo?: string
  /** Clase extra para el ícono disparador. */
  className?: string
  /** Etiqueta accesible del botón de ayuda. */
  titulo?: string
}

/**
 * Ícono de ayuda (?) que al tocarlo muestra una explicación en criollo.
 * Reemplaza la jerga contable/financiera dispersa por el módulo.
 */
export function AyudaContextual({
  children,
  ejemplo,
  className,
  titulo = 'Qué significa',
}: Props) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={titulo}
            className={cn(
              'inline-flex items-center justify-center align-middle text-[#c8a58a] transition-colors hover:text-[#f9b44c] focus-visible:text-[#f9b44c] focus-visible:outline-none',
              className
            )}
          />
        }
      >
        <HelpCircle className="h-3.5 w-3.5" />
      </PopoverTrigger>
      <PopoverContent className="border border-[#e4c9b0]/60">
        <div className="space-y-1.5">
          <div className="leading-snug text-[#6f3a2a]">{children}</div>
          {ejemplo && (
            <p className="rounded bg-[#f9b44c]/15 px-2 py-1 text-xs font-medium text-[#391511]">
              {ejemplo}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
