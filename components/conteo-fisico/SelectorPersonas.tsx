'use client'

import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Persona {
  id: string
  nombre: string
}

interface Props {
  personas: Persona[]
  seleccionadas: string[]
  onCambio: (ids: string[]) => void
  /** true = se elige una sola (zona libre: sin lista no hay qué repartir). */
  unica?: boolean
}

/**
 * Quién cuenta. El orden en que se tildan importa: con varias personas la
 * lista se reparte en tramos del recorrido, y el primer tramo es de la primera.
 */
export function SelectorPersonas({
  personas,
  seleccionadas,
  onCambio,
  unica = false,
}: Props) {
  function alternar(id: string) {
    if (seleccionadas.includes(id)) {
      onCambio(seleccionadas.filter((s) => s !== id))
    } else {
      onCambio(unica ? [id] : [...seleccionadas, id])
    }
  }

  if (personas.length === 0) {
    return (
      <p className="text-xs text-[#6f3a2a]">No hay usuarios activos para asignar.</p>
    )
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {personas.map((p) => {
        const posicion = seleccionadas.indexOf(p.id)
        const activo = posicion >= 0
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => alternar(p.id)}
            aria-pressed={activo}
            className={cn(
              'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm transition-colors',
              activo
                ? 'border-[#f9b44c] bg-[#f9b44c]/25 font-medium text-[#391511]'
                : 'border-[#e4c9b0] bg-white text-[#6f3a2a] hover:border-[#f9b44c]'
            )}
          >
            {activo &&
              (unica || seleccionadas.length === 1 ? (
                <Check className="h-3 w-3" />
              ) : (
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#391511] text-[10px] font-bold text-white">
                  {posicion + 1}
                </span>
              ))}
            {p.nombre}
          </button>
        )
      })}
    </div>
  )
}
