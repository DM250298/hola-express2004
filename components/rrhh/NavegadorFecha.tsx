'use client'

import { addDays, format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { capitalizar } from './asistenciaConstantes'

interface Props {
  fecha: string
  hoy: string
  onCambio: (fecha: string) => void
  /** Formato date-fns de la etiqueta. */
  formato?: string
}

/** Navegador ‹ fecha › con botón "Hoy" (Tareas, agenda). Fechas yyyy-MM-dd. */
export function NavegadorFecha({ fecha, hoy, onCambio, formato = "EEE d 'de' MMM" }: Props) {
  const mover = (n: number) => onCambio(format(addDays(parseISO(fecha), n), 'yyyy-MM-dd'))
  return (
    <div className="flex items-center gap-1 bg-white border border-[#e4c9b0]/60 rounded-2xl px-2 py-1.5 w-fit">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => mover(-1)}
        className="h-8 w-8 p-0 text-[#6f3a2a]"
        aria-label="Día anterior"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span className="text-[#391511] font-semibold text-sm min-w-[150px] text-center tabular-nums">
        {capitalizar(format(parseISO(fecha), formato, { locale: es }))}
      </span>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => mover(1)}
        className="h-8 w-8 p-0 text-[#6f3a2a]"
        aria-label="Día siguiente"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
      {fecha !== hoy && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onCambio(hoy)}
          className="h-8 text-xs text-[#6f3a2a]"
        >
          Hoy
        </Button>
      )}
    </div>
  )
}
