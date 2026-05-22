'use client'

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export const OPCIONES_POR_PAGINA = [25, 50, 100, 200, 1000, 2000] as const

// Centinela para "Todos": valor numérico finito alto que no choca con tamaños reales.
// Lo trato como Infinity en la lógica de slicing.
const TODOS = -1

export type PorPagina = (typeof OPCIONES_POR_PAGINA)[number] | typeof TODOS

interface Props {
  total: number
  porPagina: PorPagina
  pagina: number // 0-indexed
  onCambioPorPagina: (n: PorPagina) => void
  onCambioPagina: (n: number) => void
}

export function PaginadorTabla({
  total,
  porPagina,
  pagina,
  onCambioPorPagina,
  onCambioPagina,
}: Props) {
  const mostrandoTodos = porPagina === TODOS
  const tamano = mostrandoTodos ? total : porPagina
  const totalPaginas = mostrandoTodos ? 1 : Math.max(1, Math.ceil(total / tamano))
  const paginaActual = Math.min(pagina, totalPaginas - 1)
  const desde = mostrandoTodos ? 0 : paginaActual * tamano
  const hasta = mostrandoTodos ? total : Math.min(desde + tamano, total)

  return (
    <div className="flex items-center justify-between gap-3 flex-wrap text-sm">
      <div className="flex items-center gap-2">
        <span className="text-[#6f3a2a] text-xs">Mostrar</span>
        <Select
          value={String(porPagina)}
          onValueChange={(v) => {
            if (v === null) return
            onCambioPorPagina(Number(v) as PorPagina)
            onCambioPagina(0) // resetear a primera página al cambiar tamaño
          }}
        >
          <SelectTrigger className="h-8 w-24 border-[#e4c9b0] focus:ring-[#f9b44c] bg-white text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OPCIONES_POR_PAGINA.map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n}
              </SelectItem>
            ))}
            <SelectItem value={String(TODOS)}>Todos</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-[#6f3a2a] text-xs">por página</span>
      </div>

      <div className="flex items-center gap-2 text-[#6f3a2a] text-xs">
        <span className="tabular-nums">
          {total === 0 ? '0' : `${desde + 1}–${hasta}`} de{' '}
          <span className="font-bold text-[#391511]">{total}</span>
        </span>

        {!mostrandoTodos && totalPaginas > 1 && (
          <div className="flex items-center gap-0.5 ml-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onCambioPagina(0)}
              disabled={paginaActual === 0}
              className="h-7 w-7 p-0 text-[#6f3a2a] hover:bg-[#f9d2a2]/40 hover:text-[#391511]"
              aria-label="Primera página"
            >
              <ChevronsLeft className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onCambioPagina(paginaActual - 1)}
              disabled={paginaActual === 0}
              className="h-7 w-7 p-0 text-[#6f3a2a] hover:bg-[#f9d2a2]/40 hover:text-[#391511]"
              aria-label="Página anterior"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="px-2 tabular-nums font-semibold text-[#391511]">
              {paginaActual + 1} / {totalPaginas}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onCambioPagina(paginaActual + 1)}
              disabled={paginaActual >= totalPaginas - 1}
              className="h-7 w-7 p-0 text-[#6f3a2a] hover:bg-[#f9d2a2]/40 hover:text-[#391511]"
              aria-label="Página siguiente"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onCambioPagina(totalPaginas - 1)}
              disabled={paginaActual >= totalPaginas - 1}
              className="h-7 w-7 p-0 text-[#6f3a2a] hover:bg-[#f9d2a2]/40 hover:text-[#391511]"
              aria-label="Última página"
            >
              <ChevronsRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

/** Helper para aplicar la paginación a un array. */
export function paginarArreglo<T>(
  array: T[],
  pagina: number,
  porPagina: PorPagina
): T[] {
  if (porPagina === TODOS) return array
  const desde = pagina * porPagina
  return array.slice(desde, desde + porPagina)
}
