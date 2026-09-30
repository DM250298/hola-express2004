'use client'

import { useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatearNumero } from '@/lib/utils/formato'
import {
  ETIQUETA_MUEBLE,
  ETIQUETA_TIPO,
  type ArbolUbicaciones,
  type NodoUbicacion,
} from '@/lib/queries/ubicaciones'

interface Props {
  arbol: ArbolUbicaciones
  seleccionadas: number[]
  onCambio: (ids: number[]) => void
}

/** ¿El nodo o algo que cuelga de él coincide con la búsqueda? */
function coincide(n: NodoUbicacion, texto: string): boolean {
  return (
    n.nombre.toLowerCase().includes(texto) ||
    n.hijos.some((h) => h.activo && coincide(h, texto))
  )
}

function descendientes(n: NodoUbicacion): number[] {
  return n.hijos.flatMap((h) => [h.id, ...descendientes(h)])
}

/**
 * Árbol del mapa del local con tildes. Tildar un nodo incluye todo lo que
 * cuelga de él: una góndola trae sus módulos y estantes, un sector trae sus
 * góndolas. Por eso al tildar el padre se destildan los hijos sueltos.
 */
export function SelectorAreas({ arbol, seleccionadas, onCambio }: Props) {
  const [busqueda, setBusqueda] = useState('')
  const [abiertos, setAbiertos] = useState<Set<number>>(new Set())
  const texto = busqueda.trim().toLowerCase()
  const elegidas = useMemo(() => new Set(seleccionadas), [seleccionadas])

  // La sucursal raíz no se elige: en un solo local es "todo" y no dice nada.
  const primerNivel = useMemo(
    () =>
      arbol.raices.flatMap((r) => (r.tipo === 'sucursal' ? r.hijos : [r])),
    [arbol]
  )

  function alternarAbierto(id: number) {
    setAbiertos((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  function alternar(nodo: NodoUbicacion) {
    if (elegidas.has(nodo.id)) {
      onCambio(seleccionadas.filter((id) => id !== nodo.id))
      return
    }
    const adentro = new Set(descendientes(nodo))
    onCambio([...seleccionadas.filter((id) => !adentro.has(id)), nodo.id])
  }

  function renderNodo(
    n: NodoUbicacion,
    nivel: number,
    incluidoPorPadre: boolean
  ): React.ReactNode {
    if (!n.activo) return null
    if (texto && !coincide(n, texto)) return null
    const hijos = n.hijos.filter((h) => h.activo)
    const elegido = elegidas.has(n.id)
    const marcado = elegido || incluidoPorPadre
    const abierto = texto !== '' || abiertos.has(n.id)
    const detalle = n.tipo_mueble
      ? ETIQUETA_MUEBLE[n.tipo_mueble]
      : ETIQUETA_TIPO[n.tipo]
    return (
      <li key={n.id}>
        <div
          className={cn(
            'flex items-center gap-1.5 rounded-lg py-1.5 pr-2 text-sm',
            elegido ? 'bg-[#f9b44c]/20' : 'hover:bg-[#fdfaf6]'
          )}
          style={{ paddingLeft: `${nivel * 16 + 4}px` }}
        >
          <button
            type="button"
            onClick={() => alternarAbierto(n.id)}
            className={cn(
              'shrink-0 text-[#6f3a2a]',
              hijos.length === 0 && 'invisible'
            )}
            aria-label={abierto ? `Colapsar ${n.nombre}` : `Expandir ${n.nombre}`}
          >
            {abierto ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={() => alternar(n)}
            disabled={incluidoPorPadre}
            aria-pressed={marcado}
            className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default"
          >
            <span
              className={cn(
                'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                marcado
                  ? 'border-[#f9b44c] bg-[#f9b44c]'
                  : 'border-[#c8a58a] bg-white',
                incluidoPorPadre && 'opacity-50'
              )}
            >
              {marcado && <Check className="h-3 w-3 text-[#391511]" />}
            </span>
            <span
              className={cn(
                'truncate text-[#391511]',
                elegido && 'font-semibold',
                incluidoPorPadre && 'text-[#6f3a2a]'
              )}
            >
              {n.nombre}
            </span>
            <span className="shrink-0 text-[11px] text-[#c8a58a]">{detalle}</span>
            {n.productos_total > 0 && (
              <span className="ml-auto shrink-0 rounded-full bg-[#391511]/5 px-1.5 text-[11px] tabular-nums text-[#6f3a2a]">
                {formatearNumero(n.productos_total)}
              </span>
            )}
          </button>
        </div>
        {abierto && hijos.length > 0 && (
          <ul>{hijos.map((h) => renderNodo(h, nivel + 1, marcado))}</ul>
        )}
      </li>
    )
  }

  return (
    <div className="rounded-xl border border-[#e4c9b0]/60 bg-white">
      <div className="relative border-b border-[#e4c9b0]/40 p-2">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#c8a58a]" />
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar góndola, heladera, estante…"
          className="h-8 w-full rounded-lg bg-[#fdfaf6] pl-8 pr-2 text-sm text-[#391511] focus:outline-none focus:ring-2 focus:ring-[#f9b44c]/40"
        />
      </div>
      <ul className="max-h-56 overflow-y-auto p-1.5">
        {primerNivel.map((n) => renderNodo(n, 0, false))}
      </ul>
    </div>
  )
}
