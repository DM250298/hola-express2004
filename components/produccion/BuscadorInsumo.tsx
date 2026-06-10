'use client'

import { useEffect, useState } from 'react'
import { Loader2, Package, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { useProductosProduccion } from '@/lib/hooks/useProduccion'
import type { ProductoProduccion } from '@/lib/queries/produccion'
import { cn } from '@/lib/utils'

interface Props {
  /** Tipos de producto admitidos (insumo, semi_elaborado). */
  tipos: string[]
  /** IDs ya usados, para deshabilitarlos. */
  excluidos?: number[]
  onSeleccionar: (p: ProductoProduccion) => void
}

const MAX = 8

export function BuscadorInsumo({ tipos, excluidos = [], onSeleccionar }: Props) {
  const [input, setInput] = useState('')
  const [busqueda, setBusqueda] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setBusqueda(input), 200)
    return () => clearTimeout(t)
  }, [input])

  const { data: productos, isLoading } = useProductosProduccion(
    tipos,
    busqueda || undefined
  )

  const resultados = (busqueda.length > 0 ? productos ?? [] : []).slice(0, MAX)

  function elegir(p: ProductoProduccion) {
    onSeleccionar(p)
    setInput('')
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#c8a58a] pointer-events-none" />
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Buscar insumo o semi-elaborado…"
          className="pl-9 border-[#e4c9b0] focus-visible:ring-[#f9b44c] bg-white"
          autoComplete="off"
        />
      </div>

      {busqueda.length > 0 && (
        <div className="bg-white border border-[#e4c9b0]/60 rounded-xl overflow-hidden shadow-sm max-h-[240px] overflow-y-auto">
          {isLoading ? (
            <div className="p-4 flex items-center justify-center gap-2 text-[#6f3a2a] text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Buscando…
            </div>
          ) : resultados.length === 0 ? (
            <div className="p-4 text-center text-[#6f3a2a] text-sm">
              <Package className="h-5 w-5 mx-auto mb-1 text-[#c8a58a]" />
              Sin resultados. Marcá el producto como insumo o semi-elaborado en
              Configuración.
            </div>
          ) : (
            <ul className="divide-y divide-[#e4c9b0]/40">
              {resultados.map((p) => {
                const yaUsado = excluidos.includes(p.id)
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => elegir(p)}
                      disabled={yaUsado}
                      className={cn(
                        'w-full px-3 py-2 flex items-center justify-between gap-3 text-left transition-colors',
                        yaUsado
                          ? 'opacity-40 cursor-not-allowed'
                          : 'hover:bg-[#fdfaf6]'
                      )}
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-[#391511] truncate text-sm">
                          {p.nombre}
                        </div>
                        <div className="text-xs text-[#c8a58a] mt-0.5">
                          {p.tipo} · stock {p.stock_actual} {p.unidad}
                        </div>
                      </div>
                      {yaUsado && (
                        <span className="text-[10px] text-[#6f3a2a] shrink-0">
                          ya agregado
                        </span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
