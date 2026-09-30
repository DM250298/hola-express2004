'use client'

import { useMemo, useState } from 'react'
import { Check, Search } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Opcion {
  id: number
  nombre: string
}

interface Props {
  opciones: Opcion[]
  seleccionados: number[]
  onCambio: (ids: number[]) => void
  placeholder: string
  /** Texto cuando no hay nada para elegir. */
  vacio: string
}

/** Lista con tildes y buscador: proveedores, categorías, marcas. */
export function SelectorLista({
  opciones,
  seleccionados,
  onCambio,
  placeholder,
  vacio,
}: Props) {
  const [busqueda, setBusqueda] = useState('')
  const texto = busqueda.trim().toLowerCase()
  const elegidos = useMemo(() => new Set(seleccionados), [seleccionados])

  // Los elegidos van arriba: con 80 proveedores, si no, no se ve qué quedó tildado.
  const visibles = useMemo(() => {
    const filtradas = texto
      ? opciones.filter((o) => o.nombre.toLowerCase().includes(texto))
      : opciones
    return [...filtradas].sort(
      (a, b) => Number(elegidos.has(b.id)) - Number(elegidos.has(a.id))
    )
  }, [opciones, texto, elegidos])

  function alternar(id: number) {
    onCambio(
      elegidos.has(id)
        ? seleccionados.filter((s) => s !== id)
        : [...seleccionados, id]
    )
  }

  if (opciones.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-[#e4c9b0] px-3 py-2.5 text-xs text-[#6f3a2a]">
        {vacio}
      </p>
    )
  }

  return (
    <div className="rounded-xl border border-[#e4c9b0]/60 bg-white">
      {opciones.length > 8 && (
        <div className="relative border-b border-[#e4c9b0]/40 p-2">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#c8a58a]" />
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder={placeholder}
            className="h-8 w-full rounded-lg bg-[#fdfaf6] pl-8 pr-2 text-sm text-[#391511] focus:outline-none focus:ring-2 focus:ring-[#f9b44c]/40"
          />
        </div>
      )}
      <ul className="max-h-44 divide-y divide-[#e4c9b0]/30 overflow-y-auto">
        {visibles.length === 0 && (
          <li className="px-3 py-3 text-center text-xs text-[#6f3a2a]">
            Nada coincide con “{busqueda}”.
          </li>
        )}
        {visibles.map((o) => {
          const activo = elegidos.has(o.id)
          return (
            <li key={o.id}>
              <button
                type="button"
                onClick={() => alternar(o.id)}
                aria-pressed={activo}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors',
                  activo
                    ? 'bg-[#f9b44c]/15 font-medium text-[#391511]'
                    : 'text-[#6f3a2a] hover:bg-[#fdfaf6]'
                )}
              >
                <span
                  className={cn(
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                    activo ? 'border-[#f9b44c] bg-[#f9b44c]' : 'border-[#c8a58a]'
                  )}
                >
                  {activo && <Check className="h-3 w-3 text-[#391511]" />}
                </span>
                <span className="truncate">{o.nombre}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
