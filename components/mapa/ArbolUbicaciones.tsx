'use client'

import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Plus, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatearNumero } from '@/lib/utils/formato'
import type { ArbolUbicaciones as Arbol, NodoUbicacion } from '@/lib/queries/ubicaciones'
import type { ColorSemaforo, NodoMapa } from '@/lib/queries/mapa'

const PUNTO: Record<ColorSemaforo, string> = {
  rojo: 'bg-[#c43e2c]',
  amarillo: 'bg-[#e4a42a]',
  verde: 'bg-[#2f7d4f]',
  gris: 'bg-[#e4c9b0]',
}

/** ¿El nodo o algo que cuelga de él coincide con la búsqueda? */
function coincide(n: NodoUbicacion, texto: string): boolean {
  return n.nombre.toLowerCase().includes(texto) || n.hijos.some((h) => coincide(h, texto))
}

/**
 * Panel izquierdo del mapa: el árbol completo con buscador. Buscar abre las
 * ramas que llevan al nodo; tocar un nodo lo selecciona para el detalle.
 */
export function ArbolUbicaciones({
  arbol,
  metricas,
  seleccionado,
  onSeleccionar,
  puedeEditar,
  onAgregarSector,
}: {
  arbol: Arbol
  metricas: Map<number, NodoMapa>
  seleccionado: number | null
  onSeleccionar: (id: number) => void
  puedeEditar: boolean
  onAgregarSector: () => void
}) {
  const [busqueda, setBusqueda] = useState('')
  const [cerrados, setCerrados] = useState<Set<number>>(new Set())
  const texto = busqueda.trim().toLowerCase()

  // Ancestros del seleccionado: siempre abiertos, para que se vea dónde está.
  const ancestros = useMemo(() => {
    const porId = new Map(arbol.planas.map((u) => [u.id, u]))
    const set = new Set<number>()
    let actual = seleccionado != null ? porId.get(seleccionado) : undefined
    while (actual?.parent_id != null) {
      set.add(actual.parent_id)
      actual = porId.get(actual.parent_id)
    }
    return set
  }, [arbol, seleccionado])

  function alternar(id: number) {
    setCerrados((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  function renderNodo(n: NodoUbicacion, nivel: number): React.ReactNode {
    if (texto && !coincide(n, texto)) return null
    const m = metricas.get(n.id)
    const tieneHijos = n.hijos.length > 0
    const abierto = texto !== '' || ancestros.has(n.id) || (nivel < 3 && !cerrados.has(n.id))
    return (
      <li key={n.id}>
        <div
          className={cn(
            'flex items-center gap-1.5 rounded-lg py-1.5 pr-2 text-sm',
            seleccionado === n.id
              ? 'bg-[#f9b44c]/25 font-semibold text-[#391511]'
              : 'text-[#391511] hover:bg-[#fdfaf6]',
            !n.activo && 'opacity-50'
          )}
          style={{ paddingLeft: `${nivel * 14 + 4}px` }}
        >
          <button
            type="button"
            onClick={() => alternar(n.id)}
            className={cn('shrink-0 text-[#6f3a2a]', !tieneHijos && 'invisible')}
            aria-label={abierto ? 'Colapsar' : 'Expandir'}
          >
            {abierto ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={() => onSeleccionar(n.id)}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            <span className={cn('h-2 w-2 shrink-0 rounded-full', PUNTO[m?.semaforo ?? 'gris'])} />
            <span className="truncate">{n.nombre}</span>
            {n.productos_total > 0 && (
              <span className="ml-auto shrink-0 rounded-full bg-[#391511]/5 px-1.5 text-[11px] tabular-nums text-[#6f3a2a]">
                {formatearNumero(n.productos_total)}
              </span>
            )}
          </button>
        </div>
        {abierto && tieneHijos && (
          <ul>{n.hijos.map((h) => renderNodo(h, nivel + 1))}</ul>
        )}
      </li>
    )
  }

  return (
    <section className="flex flex-col rounded-2xl border border-[#e4c9b0]/60 bg-white p-4 shadow-sm">
      <h2 className="mb-3 font-bold text-[#391511]">Ubicaciones</h2>
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#c8a58a]" />
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar ubicación…"
          className="h-9 w-full rounded-lg border border-[#e4c9b0] bg-white pl-8 pr-2 text-sm text-[#391511] focus:outline-none focus:ring-2 focus:ring-[#f9b44c]/40"
        />
      </div>
      <ul className="max-h-[60vh] flex-1 overflow-y-auto">
        {arbol.raices.map((n) => renderNodo(n, 0))}
      </ul>
      {puedeEditar && (
        <button
          type="button"
          onClick={onAgregarSector}
          className="mt-3 flex h-10 items-center justify-center gap-1.5 rounded-xl border border-[#e4c9b0] text-sm font-semibold text-[#391511] hover:bg-[#fdfaf6]"
        >
          <Plus className="h-4 w-4" /> Agregar sector
        </button>
      )}
    </section>
  )
}
