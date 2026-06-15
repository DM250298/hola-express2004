'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Loader2, Package, Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { MontoARS } from '@/components/shared/MontoARS'
import { ImagenProductoPOS } from './ImagenProductoPOS'
import { useProductos } from '@/lib/hooks/useProductos'
import { getProductoByBarcode } from '@/lib/queries/productos'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import type { ProductoConRelaciones } from '@/lib/queries/productos'

interface Props {
  onSeleccionar: (p: ProductoConRelaciones) => void
}

export interface BuscadorProductoRef {
  focus: () => void
}

const MAX_RESULTADOS_VISIBLES = 8

/**
 * Detección heurística de lectura de scanner USB:
 * los scanners suelen tipear el código completo en <50ms y terminar con Enter.
 * Si recibimos Enter sobre un input con solo dígitos y largo razonable,
 * lo tratamos como barcode y buscamos directo.
 */
function pareceBarcode(valor: string): boolean {
  return /^\d{6,14}$/.test(valor.trim())
}

export const BuscadorProducto = forwardRef<BuscadorProductoRef, Props>(
  function BuscadorProducto({ onSeleccionar }, ref) {
    const [busquedaInput, setBusquedaInput] = useState('')
    const [busqueda, setBusqueda] = useState('')
    const [indiceSeleccionado, setIndiceSeleccionado] = useState(0)
    const inputRef = useRef<HTMLInputElement>(null)

    useImperativeHandle(ref, () => ({
      focus: () => inputRef.current?.focus(),
    }))

    // Debounce de 200ms
    useEffect(() => {
      const t = setTimeout(() => setBusqueda(busquedaInput), 200)
      return () => clearTimeout(t)
    }, [busquedaInput])

    // Focus automático al montar
    useEffect(() => {
      inputRef.current?.focus()
    }, [])

    // Reset selección al cambiar la búsqueda
    useEffect(() => {
      setIndiceSeleccionado(0)
    }, [busqueda])

    const { data: productos, isLoading } = useProductos({
      busqueda: busqueda || undefined,
      activo: true,
      solo_vendibles: true,
    })

    const resultados = (busqueda.length > 0 ? productos ?? [] : []).slice(
      0,
      MAX_RESULTADOS_VISIBLES
    )

    function agregarProducto(p: ProductoConRelaciones) {
      if (!p.activo) {
        toast.error(`"${p.nombre}" está inactivo.`)
        return
      }
      if (p.no_ofrecer_ventas) {
        toast.error(`"${p.nombre}" no está disponible para la venta.`)
        return
      }
      if (p.pendiente_precio) {
        toast.error(
          `"${p.nombre}" todavía no tiene precio cargado. Cargá la factura o completá el precio para poder venderlo.`
        )
        return
      }
      if (p.stock_actual <= 0) {
        toast.error(`"${p.nombre}" sin stock.`)
        return
      }
      onSeleccionar(p)
      setBusquedaInput('')
      inputRef.current?.focus()
    }

    async function handleEnter() {
      const valor = busquedaInput.trim()
      if (!valor) return

      // 1. Si parece barcode (scanner), buscar directo en BD
      if (pareceBarcode(valor)) {
        try {
          const producto = await getProductoByBarcode(valor, true)
          if (producto) {
            agregarProducto(producto)
            return
          } else {
            toast.error(`Código ${valor} no encontrado.`)
          }
        } catch {
          toast.error('Error buscando por código.')
        }
        return
      }

      // 2. Si hay resultados visibles, agregar el seleccionado
      if (resultados.length > 0) {
        const p = resultados[Math.min(indiceSeleccionado, resultados.length - 1)]
        agregarProducto(p)
      }
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
      if (e.key === 'Enter') {
        e.preventDefault()
        handleEnter()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        setBusquedaInput('')
      } else if (e.key === 'ArrowDown' && resultados.length > 0) {
        e.preventDefault()
        setIndiceSeleccionado((i) =>
          Math.min(i + 1, resultados.length - 1)
        )
      } else if (e.key === 'ArrowUp' && resultados.length > 0) {
        e.preventDefault()
        setIndiceSeleccionado((i) => Math.max(0, i - 1))
      }
    }

    const mostrandoResultados = busqueda.length > 0

    return (
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-[#c8a58a] pointer-events-none" />
          <Input
            ref={inputRef}
            value={busquedaInput}
            onChange={(e) => setBusquedaInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Buscar producto o escanear código… (F2)"
            className="pl-10 pr-10 h-12 text-base border-[#e4c9b0] focus-visible:ring-[#f9b44c] bg-white"
            autoComplete="off"
          />
          {busquedaInput && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setBusquedaInput('')
                inputRef.current?.focus()
              }}
              className="absolute right-1 top-1/2 -translate-y-1/2 h-9 w-9 text-[#6f3a2a] hover:bg-[#f9d2a2]/40"
              aria-label="Limpiar"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>

        {mostrandoResultados && (
          <div className="bg-white border border-[#e4c9b0]/60 rounded-xl overflow-hidden shadow-sm max-h-[280px] overflow-y-auto">
            {isLoading ? (
              <div className="p-6 flex items-center justify-center gap-2 text-[#6f3a2a] text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Buscando…
              </div>
            ) : resultados.length === 0 ? (
              <div className="p-6 text-center text-[#6f3a2a] text-sm">
                <Package className="h-5 w-5 mx-auto mb-1 text-[#c8a58a]" />
                No se encontraron productos.
              </div>
            ) : (
              <ul className="divide-y divide-[#e4c9b0]/40">
                {resultados.map((p, idx) => {
                  const sinPrecio = p.pendiente_precio
                  const sinStock = p.stock_actual <= 0
                  const deshabilitado = sinStock || sinPrecio
                  const seleccionado = idx === indiceSeleccionado
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => agregarProducto(p)}
                        onMouseEnter={() => setIndiceSeleccionado(idx)}
                        disabled={deshabilitado}
                        className={cn(
                          'w-full px-4 py-3 flex items-center justify-between gap-3 text-left transition-colors border-l-4',
                          deshabilitado
                            ? 'opacity-50 cursor-not-allowed border-transparent'
                            : seleccionado
                            ? 'bg-[#f9d2a2]/40 border-[#f9b44c]'
                            : 'border-transparent hover:bg-[#fdfaf6]'
                        )}
                      >
                        <ImagenProductoPOS
                          url={p.imagen_url}
                          nombre={p.nombre}
                          className="h-10 w-10 rounded-lg border border-[#e4c9b0]/60"
                          iconClassName="h-4 w-4"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-[#391511] truncate">
                            {p.nombre}
                          </div>
                          <div className="text-xs text-[#c8a58a] font-mono mt-0.5 flex items-center gap-2">
                            {p.codigo_barras && <span>{p.codigo_barras}</span>}
                            <span
                              className={
                                sinStock
                                  ? 'text-[#c43e2c] font-semibold'
                                  : p.stock_actual < p.stock_minimo
                                  ? 'text-[#c43e2c]'
                                  : 'text-[#6f3a2a]'
                              }
                            >
                              Stock: {p.stock_actual}
                            </span>
                          </div>
                        </div>
                        <div className="text-right shrink-0 flex items-center gap-2">
                          {sinPrecio ? (
                            <span className="text-[10px] font-bold uppercase tracking-wide text-[#c43e2c] bg-[#c43e2c]/12 px-2 py-1 rounded">
                              Sin precio
                            </span>
                          ) : (
                            <div className="font-bold text-[#391511] tabular-nums">
                              <MontoARS monto={p.precio_venta} />
                              {p.venta_por_peso && (
                                <span className="text-[10px] text-[#6f3a2a] font-normal ml-0.5">/kg</span>
                              )}
                            </div>
                          )}
                          {seleccionado && !deshabilitado && (
                            <span className="text-[10px] font-bold uppercase tracking-wide text-[#6f3a2a] bg-[#f9b44c] px-1.5 py-0.5 rounded">
                              ↵
                            </span>
                          )}
                        </div>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
            {resultados.length > 0 && (
              <div className="px-3 py-1.5 bg-[#fdfaf6] border-t border-[#e4c9b0]/40 text-[10px] text-[#6f3a2a] text-center">
                Usá <kbd className="px-1 py-0.5 bg-white border border-[#e4c9b0] rounded text-[9px]">↑↓</kbd>{' '}
                para navegar ·{' '}
                <kbd className="px-1 py-0.5 bg-white border border-[#e4c9b0] rounded text-[9px]">↵</kbd>{' '}
                para agregar
              </div>
            )}
          </div>
        )}
      </div>
    )
  }
)
