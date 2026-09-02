'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, Loader2, Plus, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { CampoFechaVencimiento } from '@/components/shared/CampoFechaVencimiento'
import { useCategorias } from '@/lib/hooks/useCategorias'
import {
  createProducto,
  getProductoByBarcode,
  getProductos,
} from '@/lib/queries/productos'
import { aProdParaAgregar, type ProdParaAgregar } from './tipos'

interface Props {
  abierto: boolean
  /** Código escaneado que no estaba en la orden (precarga el buscador). */
  codigoInicial: string
  onCerrar: () => void
  /** Suma el producto a la recepción. El padre hace el INSERT en items_pedido. */
  onAgregar: (prod: ProdParaAgregar, cantidad: number, venc: string) => Promise<void>
}

/**
 * Buscar o dar de alta un producto que no estaba en la orden.
 *
 * Busca en TODO el catálogo (aunque el producto no sea de este proveedor) e
 * incluye los inactivos a propósito: si ya existe, aunque esté dado de baja,
 * conviene reusarlo antes que crear un duplicado — al sumarlo se reactiva.
 */
export function ModalAgregarProducto({
  abierto,
  codigoInicial,
  onCerrar,
  onAgregar,
}: Props) {
  const { data: categorias } = useCategorias()
  const [busqueda, setBusqueda] = useState('')
  const [busquedaDebounced, setBusquedaDebounced] = useState('')
  const [seleccionado, setSeleccionado] = useState<ProdParaAgregar | null>(null)
  const [codigo, setCodigo] = useState('')
  const [nombre, setNombre] = useState('')
  const [precio, setPrecio] = useState('')
  const [categoria, setCategoria] = useState('')
  const [cantidad, setCantidad] = useState('')
  const [venc, setVenc] = useState('')
  const [guardando, setGuardando] = useState(false)

  // Cada apertura arranca limpia, con el código escaneado precargado.
  useEffect(() => {
    if (!abierto) return
    setBusqueda(codigoInicial)
    setCodigo(codigoInicial)
    setSeleccionado(null)
    setNombre('')
    setPrecio('')
    setCategoria('')
    setCantidad('')
    setVenc('')
  }, [abierto, codigoInicial])

  useEffect(() => {
    const t = setTimeout(() => setBusquedaDebounced(busqueda.trim()), 250)
    return () => clearTimeout(t)
  }, [busqueda])

  // Solo con el modal abierto y ≥ 2 caracteres: no bajamos el catálogo de gusto.
  const { data: resultados, isFetching: buscando } = useQuery({
    queryKey: ['recepcion-buscar-producto', busquedaDebounced],
    queryFn: () => getProductos({ busqueda: busquedaDebounced }),
    enabled: abierto && busquedaDebounced.length >= 2,
    staleTime: 30 * 1000,
  })

  async function confirmar() {
    const cant = Number(cantidad)
    if (!Number.isFinite(cant) || cant <= 0) {
      toast.error('Poné cuántas unidades llegaron.')
      return
    }
    setGuardando(true)
    try {
      let prod: ProdParaAgregar | null = seleccionado
      // Red de seguridad: si el código ya existe, se reutiliza ese producto.
      if (!prod && codigo.trim()) {
        const encontrado = await getProductoByBarcode(codigo.trim())
        if (encontrado) prod = aProdParaAgregar(encontrado)
      }
      if (!prod) {
        if (!nombre.trim()) {
          toast.error('Buscá el producto, o poné el nombre para crearlo.')
          return
        }
        const p = Number(precio)
        if (!Number.isFinite(p) || p <= 0) {
          toast.error('Poné el precio de venta para crear el producto.')
          return
        }
        const creado = await createProducto({
          nombre: nombre.trim(),
          precio_venta: p,
          codigo_barras: codigo.trim() || null,
          categoria_id: categoria ? Number(categoria) : null,
        })
        prod = aProdParaAgregar(creado)
      }
      await onAgregar(prod, cant, venc)
      onCerrar()
    } catch (e) {
      toast.error(`No se pudo agregar: ${(e as Error).message}`)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Dialog open={abierto} onOpenChange={(v) => (v ? undefined : onCerrar())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[#391511]">
            <Plus className="h-5 w-5 text-[#f9b44c]" />
            Agregar producto
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            Buscalo en el catálogo para sumarlo como recibido, aunque no sea de
            este proveedor ni esté en el pedido. Si no existe, cargalo nuevo.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs text-[#6f3a2a]">
              Buscar producto (nombre o código)
            </Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#c8a58a]" />
              <Input
                value={busqueda}
                onChange={(e) => {
                  setBusqueda(e.target.value)
                  if (seleccionado) setSeleccionado(null)
                }}
                placeholder="Ej: gaseosa cola, 779…"
                className="h-11 border-[#e4c9b0] pl-9 focus-visible:ring-[#f9b44c]"
              />
            </div>

            {!seleccionado && busquedaDebounced.length >= 2 && (
              <div className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-[#e4c9b0]/70 bg-white">
                {buscando ? (
                  <div className="p-3 text-center">
                    <Loader2 className="mx-auto h-4 w-4 animate-spin text-[#9e6b15]" />
                  </div>
                ) : (resultados ?? []).length === 0 ? (
                  <p className="p-3 text-center text-xs text-[#6f3a2a]">
                    No hay coincidencias. Podés cargarlo como nuevo abajo.
                  </p>
                ) : (
                  <ul className="divide-y divide-[#e4c9b0]/40">
                    {(resultados ?? []).slice(0, 8).map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setSeleccionado(aProdParaAgregar(p))
                            setBusqueda('')
                            setBusquedaDebounced('')
                          }}
                          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left active:bg-[#f9d2a2]/30"
                        >
                          <span className="min-w-0">
                            <span className="flex items-center gap-1.5">
                              <span className="truncate text-sm font-medium text-[#391511]">
                                {p.nombre}
                              </span>
                              {!p.activo && (
                                <span className="shrink-0 rounded bg-[#c8a58a]/30 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[#6f3a2a]">
                                  Inactivo
                                </span>
                              )}
                            </span>
                            {p.codigo_barras && (
                              <span className="block font-mono text-[10px] text-[#c8a58a]">
                                {p.codigo_barras}
                              </span>
                            )}
                          </span>
                          <span className="shrink-0 text-[10px] text-[#6f3a2a]">
                            Stock: {p.stock_actual}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {seleccionado ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-[#2f7d4f]/30 bg-[#2f7d4f]/10 px-3 py-2">
              <span className="flex min-w-0 items-center gap-2">
                <Check className="h-4 w-4 shrink-0 text-[#2f7d4f]" />
                <span className="truncate text-sm font-medium text-[#391511]">
                  {seleccionado.nombre}
                </span>
              </span>
              <button
                type="button"
                onClick={() => setSeleccionado(null)}
                className="shrink-0 text-xs font-semibold text-[#9e6b15]"
              >
                Cambiar
              </button>
            </div>
          ) : (
            <div className="space-y-3 rounded-lg border border-dashed border-[#e4c9b0] p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#6f3a2a]">
                ¿No lo encontrás? Cargalo nuevo
              </p>
              <div>
                <Label className="text-xs text-[#6f3a2a]">
                  Nombre del producto
                </Label>
                <Input
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  placeholder="Ej: Gaseosa Cola 1.5L"
                  className="h-11 border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs text-[#6f3a2a]">Código (opc.)</Label>
                  <Input
                    inputMode="numeric"
                    value={codigo}
                    onChange={(e) => setCodigo(e.target.value)}
                    placeholder="Código de barras"
                    className="h-11 border-[#e4c9b0] font-mono focus-visible:ring-[#f9b44c]"
                  />
                </div>
                <div>
                  <Label className="text-xs text-[#6f3a2a]">
                    Precio de venta
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={precio}
                    onChange={(e) => setPrecio(e.target.value)}
                    placeholder="0"
                    className="h-11 border-[#e4c9b0] tabular-nums focus-visible:ring-[#f9b44c]"
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs text-[#6f3a2a]">Categoría (opc.)</Label>
                <select
                  value={categoria}
                  onChange={(e) => setCategoria(e.target.value)}
                  className="h-11 w-full rounded-md border border-[#e4c9b0] bg-white px-2 text-sm text-[#391511] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f9b44c]"
                >
                  <option value="">Sin categoría</option>
                  {(categorias ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs text-[#6f3a2a]">
                {seleccionado?.venta_por_peso
                  ? 'Peso que llegó (kg)'
                  : 'Unidades que llegaron'}
              </Label>
              <Input
                type="number"
                min={seleccionado?.venta_por_peso ? '0' : '1'}
                step={seleccionado?.venta_por_peso ? '0.001' : '1'}
                inputMode={seleccionado?.venta_por_peso ? 'decimal' : 'numeric'}
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value)}
                placeholder={seleccionado?.venta_por_peso ? '0,000' : '0'}
                className="h-11 border-[#e4c9b0] tabular-nums focus-visible:ring-[#f9b44c]"
              />
            </div>
            <div>
              <Label className="text-xs text-[#6f3a2a]">Vence (opc.)</Label>
              <CampoFechaVencimiento
                value={venc}
                onChange={setVenc}
                diasMinimo={seleccionado?.dias_vencimiento_minimo}
                sinAtajos
              />
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              onClick={onCerrar}
              disabled={guardando}
              className="flex-1 border-[#e4c9b0] text-[#6f3a2a]"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={confirmar}
              disabled={guardando}
              className="flex-1 bg-[#f9b44c] font-semibold text-[#391511] hover:bg-[#e4a42a]"
            >
              {guardando ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Agregando…
                </>
              ) : seleccionado ? (
                'Agregar al pedido'
              ) : (
                'Crear y agregar'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
