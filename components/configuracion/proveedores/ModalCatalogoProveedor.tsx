'use client'

import { useMemo, useState } from 'react'
import { Loader2, Package, Plus, Search, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { MontoARS } from '@/components/shared/MontoARS'
import {
  useCatalogoProveedor,
  useAgregarAlCatalogo,
  useActualizarItemCatalogo,
  useQuitarDelCatalogo,
} from '@/lib/hooks/useCatalogoProveedor'
import { useProductos } from '@/lib/hooks/useProductos'
import type { ProveedorRow } from '@/types/database'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  proveedor: ProveedorRow | null
}

export function ModalCatalogoProveedor({
  abierto,
  onCambioAbierto,
  proveedor,
}: Props) {
  const proveedorId = proveedor?.id
  const { data: catalogo, isLoading } = useCatalogoProveedor(
    abierto ? proveedorId : undefined
  )
  const agregar = useAgregarAlCatalogo(proveedorId)
  const actualizar = useActualizarItemCatalogo(proveedorId)
  const quitar = useQuitarDelCatalogo(proveedorId)

  const [busqueda, setBusqueda] = useState('')
  const { data: productos } = useProductos({
    activo: true,
    busqueda: busqueda || undefined,
  })

  const idsEnCatalogo = useMemo(
    () => new Set((catalogo ?? []).map((c) => c.producto_id)),
    [catalogo]
  )

  const resultados = useMemo(() => {
    if (!busqueda.trim() || !productos) return []
    return productos.filter((p) => !idsEnCatalogo.has(p.id)).slice(0, 6)
  }, [busqueda, productos, idsEnCatalogo])

  // Edición local de costos por item
  const [costos, setCostos] = useState<Record<number, string>>({})

  function guardarCosto(id: number, valorActual: number) {
    const raw = costos[id]
    if (raw === undefined) return
    const n = Number(raw)
    if (Number.isNaN(n) || n < 0 || n === valorActual) return
    actualizar.mutate({ id, datos: { costo: n } })
  }

  return (
    <Dialog open={abierto} onOpenChange={onCambioAbierto}>
      <DialogContent className="sm:max-w-2xl p-0 gap-0 overflow-hidden max-h-[90vh] flex flex-col">
        <DialogHeader className="px-6 py-4 border-b border-[#e4c9b0]/60 bg-[#fdfaf6] shrink-0">
          <DialogTitle className="text-[#391511] text-lg flex items-center gap-2">
            <Package className="h-5 w-5 text-[#f9b44c]" />
            Catálogo · {proveedor?.nombre}
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            Productos que este proveedor surte, con su costo. Solo estos
            aparecen al armar una orden de compra.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Buscador para agregar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#c8a58a]" />
            <Input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar producto para agregar al catálogo…"
              className="pl-9 border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
            />
            {busqueda && resultados.length > 0 && (
              <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-[#e4c9b0] rounded-xl shadow-lg max-h-64 overflow-y-auto">
                {resultados.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      if (proveedorId == null) return
                      agregar.mutate({
                        proveedor_id: proveedorId,
                        producto_id: p.id,
                        costo: p.precio_costo ?? 0,
                      })
                      setBusqueda('')
                    }}
                    className="w-full px-3 py-2 flex items-center justify-between gap-2 hover:bg-[#fdfaf6] text-left border-b border-[#e4c9b0]/40 last:border-b-0"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-[#391511] text-sm truncate">
                        {p.nombre}
                      </div>
                      {p.codigo_barras && (
                        <div className="text-xs text-[#c8a58a] font-mono">
                          {p.codigo_barras}
                        </div>
                      )}
                    </div>
                    <Plus className="h-4 w-4 text-[#f9b44c] shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Lista del catálogo */}
          {isLoading ? (
            <div className="flex items-center justify-center py-10 text-[#6f3a2a]">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : !catalogo || catalogo.length === 0 ? (
            <div className="text-center py-10 text-[#6f3a2a] text-sm">
              Este proveedor todavía no tiene productos en su catálogo. Buscá
              arriba para agregarlos.
            </div>
          ) : (
            <ul className="divide-y divide-[#e4c9b0]/40">
              {catalogo.map((c) => (
                <li
                  key={c.id}
                  className="py-2.5 flex items-center gap-3 flex-wrap"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-[#391511] text-sm">
                      {c.producto_nombre}
                    </div>
                    {c.codigo_barras && (
                      <div className="text-xs text-[#c8a58a] font-mono">
                        {c.codigo_barras}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] uppercase tracking-wider text-[#6f3a2a]">
                      Costo
                    </span>
                    <div className="relative">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[#c8a58a] text-xs">
                        $
                      </span>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        defaultValue={c.costo}
                        onChange={(e) =>
                          setCostos((prev) => ({
                            ...prev,
                            [c.id]: e.target.value,
                          }))
                        }
                        onBlur={() => guardarCosto(c.id, c.costo)}
                        className="h-8 w-28 pl-5 tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
                      />
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => quitar.mutate(c.id)}
                    className="text-[#c8a58a] hover:bg-[#c43e2c]/10 hover:text-[#c43e2c]"
                    aria-label="Quitar del catálogo"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-[#e4c9b0]/60 bg-[#fdfaf6] px-6 py-3 flex items-center justify-between shrink-0">
          <span className="text-sm text-[#6f3a2a]">
            <span className="font-bold text-[#391511]">
              {catalogo?.length ?? 0}
            </span>{' '}
            producto(s) en el catálogo
          </span>
          <Button
            variant="outline"
            onClick={() => onCambioAbierto(false)}
            className="border-[#e4c9b0] text-[#6f3a2a]"
          >
            Cerrar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
