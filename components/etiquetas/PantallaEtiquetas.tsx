'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Check, Loader2, Printer, Search, Tag } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { MontoARS } from '@/components/shared/MontoARS'
import { ModalImprimirEtiquetaPrecio } from '@/components/inventario/ModalImprimirEtiquetaPrecio'
import {
  useEtiquetasPendientes,
  useQuitarEtiqueta,
} from '@/lib/hooks/useEtiquetas'
import { getProductos } from '@/lib/queries/productos'
import { formatearFechaHora } from '@/lib/utils/formato'
import type { DatosEtiquetaPrecio } from '@/components/inventario/EtiquetaPrecio'

export function PantallaEtiquetas() {
  const { data: etiquetas, isLoading, isError } = useEtiquetasPendientes()
  const quitar = useQuitarEtiqueta()
  const [productoImprimir, setProductoImprimir] =
    useState<DatosEtiquetaPrecio | null>(null)

  // ── Buscador de la cola de pendientes ──
  const [busqueda, setBusqueda] = useState('')
  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    if (!q) return etiquetas ?? []
    return (etiquetas ?? []).filter(
      (e) =>
        e.producto_nombre.toLowerCase().includes(q) ||
        (e.codigo_barras ?? '').toLowerCase().includes(q)
    )
  }, [etiquetas, busqueda])

  // ── Buscador de catálogo (reimprimir cualquier etiqueta) ──
  const [catInput, setCatInput] = useState('')
  const [catQuery, setCatQuery] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setCatQuery(catInput), 250)
    return () => clearTimeout(t)
  }, [catInput])

  const { data: resultados, isFetching: buscando } = useQuery({
    queryKey: ['buscar-productos-etiqueta', catQuery],
    queryFn: () => getProductos({ busqueda: catQuery, activo: true }),
    enabled: catQuery.trim().length >= 2,
    staleTime: 30 * 1000,
  })

  // Imprimir NUNCA saca una etiqueta de la cola de pendientes: solo el botón
  // "Ya colocada" la marca como colocada. Por eso no le pasamos productoId al
  // modal (si lo hiciéramos, al imprimir se quitaría de pendientes).
  function abrirImpresion(
    nombre: string,
    codigoBarras: string | null,
    precioVenta: number
  ) {
    setProductoImprimir({
      nombre,
      codigo_barras: codigoBarras,
      precio_venta: precioVenta,
    })
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
      <header>
        <h1 className="text-[#391511] text-2xl font-bold">Etiquetas de precio</h1>
        <p className="text-[#6f3a2a] text-sm mt-1">
          Reimprimí etiquetas y marcá como colocadas las que cambiaron de precio.
        </p>
      </header>

      {/* ── Sección 1: Pendientes de colocar ── */}
      <section className="space-y-3">
        <h2 className="text-[#391511] font-bold">Pendientes de colocar</h2>

        {isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-20 rounded-2xl bg-[#f9d2a2]/30" />
            ))}
          </div>
        ) : isError ? (
          <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-10 text-center text-[#c43e2c] text-sm">
            No se pudieron cargar las etiquetas pendientes.
          </div>
        ) : !etiquetas || etiquetas.length === 0 ? (
          <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-10 text-center">
            <Tag className="h-6 w-6 text-[#c8a58a] mx-auto mb-2" />
            <p className="text-[#391511] font-semibold">
              No hay etiquetas pendientes
            </p>
            <p className="text-[#6f3a2a] text-sm mt-1">
              Cuando cambie el precio de un producto, va a aparecer acá para
              reimprimir la etiqueta.
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-sm text-[#6f3a2a]">
                <span className="font-bold text-[#391511]">
                  {etiquetas.length}
                </span>{' '}
                etiqueta(s) pendiente(s) de colocar
              </p>
              <div className="relative w-full sm:w-72">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#c8a58a]" />
                <Input
                  placeholder="Buscar en pendientes…"
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  className="pl-9 border-[#e4c9b0] focus-visible:ring-[#f9b44c] bg-white"
                />
              </div>
            </div>
            <ul className="space-y-2">
              {filtradas.map((e) => (
                <li
                  key={e.id}
                  className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-4 flex items-center gap-3 flex-wrap"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-[#391511]">
                      {e.producto_nombre}
                    </div>
                    <div className="text-xs text-[#6f3a2a] flex items-center gap-2 flex-wrap mt-0.5">
                      {e.codigo_barras && (
                        <span className="font-mono text-[#c8a58a]">
                          {e.codigo_barras}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1">
                        {e.precio_anterior != null && (
                          <>
                            <span className="line-through text-[#c8a58a]">
                              <MontoARS monto={e.precio_anterior} />
                            </span>
                            <ArrowRight className="h-3 w-3 text-[#c8a58a]" />
                          </>
                        )}
                        <span className="font-bold text-[#391511]">
                          <MontoARS monto={e.precio} />
                        </span>
                      </span>
                      <span className="text-[#c8a58a]">
                        · {formatearFechaHora(e.fecha)}
                      </span>
                    </div>
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      abrirImpresion(
                        e.producto_nombre,
                        e.codigo_barras,
                        e.precio
                      )
                    }
                    className="border-[#e4c9b0] text-[#6f3a2a] gap-1.5"
                  >
                    <Printer className="h-3.5 w-3.5" />
                    Imprimir
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => quitar.mutate(e.id)}
                    disabled={quitar.isPending}
                    className="bg-[#2f8f4e] hover:bg-[#267a42] text-white font-semibold gap-1.5"
                  >
                    {quitar.isPending && quitar.variables === e.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Check className="h-3.5 w-3.5" />
                    )}
                    Ya colocada
                  </Button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {/* ── Sección 2: Reimprimir cualquier etiqueta ── */}
      <section className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-5 space-y-4">
        <div>
          <h2 className="text-[#391511] font-bold">
            Reimprimir cualquier etiqueta
          </h2>
          <p className="text-[#6f3a2a] text-sm">
            Buscá cualquier producto para reimprimir su etiqueta (por ejemplo si
            se despegó). Esto <strong>no</strong> lo marca como pendiente.
          </p>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#c8a58a]" />
          <Input
            placeholder="Buscar producto por nombre o código…"
            value={catInput}
            onChange={(e) => setCatInput(e.target.value)}
            className="pl-9 border-[#e4c9b0] focus-visible:ring-[#f9b44c] bg-[#fdfaf6]"
          />
        </div>

        {catQuery.trim().length < 2 ? (
          <p className="text-sm text-[#c8a58a] text-center py-4">
            Escribí al menos 2 letras para buscar.
          </p>
        ) : buscando ? (
          <p className="text-sm text-[#6f3a2a] flex items-center gap-2 justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin" />
            Buscando…
          </p>
        ) : !resultados || resultados.length === 0 ? (
          <p className="text-sm text-[#6f3a2a] text-center py-4">
            No se encontraron productos con “{catQuery}”.
          </p>
        ) : (
          <ul className="divide-y divide-[#e4c9b0]/50 max-h-96 overflow-y-auto">
            {resultados.slice(0, 50).map((p) => (
              <li
                key={p.id}
                className="flex items-center gap-3 py-2.5 flex-wrap"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-[#391511]">{p.nombre}</div>
                  <div className="text-xs text-[#6f3a2a] flex items-center gap-2">
                    {p.codigo_barras && (
                      <span className="font-mono text-[#c8a58a]">
                        {p.codigo_barras}
                      </span>
                    )}
                    <span className="font-semibold text-[#391511]">
                      <MontoARS monto={p.precio_venta} />
                    </span>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    abrirImpresion(p.nombre, p.codigo_barras, p.precio_venta)
                  }
                  className="border-[#e4c9b0] text-[#6f3a2a] gap-1.5"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Imprimir
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ModalImprimirEtiquetaPrecio
        abierto={productoImprimir !== null}
        onCambioAbierto={(v) => {
          if (!v) setProductoImprimir(null)
        }}
        producto={productoImprimir}
      />
    </div>
  )
}
