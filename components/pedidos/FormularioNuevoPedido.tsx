'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  AlertTriangle,
  ChevronLeft,
  Clock,
  CreditCard,
  Loader2,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Truck,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { MontoARS } from '@/components/shared/MontoARS'
import { formatearMonto } from '@/lib/utils/formato'
import { useProveedores } from '@/lib/hooks/useProveedores'
import { useProductos } from '@/lib/hooks/useProductos'
import {
  useCrearPedido,
  useProductosSugeridos,
} from '@/lib/hooks/usePedidos'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { cn } from '@/lib/utils'
import type { ProveedorRow } from '@/types/database'

const SIN_PROVEEDOR = '__sin_proveedor__'

interface ItemFormulario {
  producto_id: number
  nombre: string
  codigo_barras: string | null
  cantidad_pedida: number
  precio_costo: number
}

function hoyIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function sumarDias(dias: number): string {
  const d = new Date()
  d.setDate(d.getDate() + dias)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function FormularioNuevoPedido() {
  const router = useRouter()
  const { data: usuario } = useUsuario()
  const { data: proveedores } = useProveedores()
  const crearPedido = useCrearPedido()

  const [proveedorIdStr, setProveedorIdStr] = useState<string>(SIN_PROVEEDOR)
  const [fechaEntrega, setFechaEntrega] = useState<string>('')
  const [items, setItems] = useState<ItemFormulario[]>([])
  const [busqueda, setBusqueda] = useState('')

  const proveedorId =
    proveedorIdStr === SIN_PROVEEDOR ? undefined : Number(proveedorIdStr)
  const proveedor: ProveedorRow | undefined = proveedorId
    ? proveedores?.find((p) => p.id === proveedorId)
    : undefined

  const { data: sugeridos } = useProductosSugeridos(proveedorId)
  const { data: productos } = useProductos({
    activo: true,
    busqueda: busqueda || undefined,
  })

  // Auto-calcular fecha de entrega al elegir proveedor
  useEffect(() => {
    if (proveedor?.dias_entrega != null) {
      setFechaEntrega(sumarDias(proveedor.dias_entrega))
    } else if (proveedor) {
      setFechaEntrega('')
    }
  }, [proveedor])

  // Al cambiar de proveedor: limpiar items
  useEffect(() => {
    setItems([])
    setBusqueda('')
  }, [proveedorIdStr])

  const total = useMemo(
    () => items.reduce((acc, it) => acc + it.cantidad_pedida * it.precio_costo, 0),
    [items]
  )

  function agregarItem(producto: {
    id: number
    nombre: string
    codigo_barras: string | null
    precio_costo: number
  }, cantidad = 1) {
    setItems((prev) => {
      const existente = prev.find((it) => it.producto_id === producto.id)
      if (existente) {
        return prev.map((it) =>
          it.producto_id === producto.id
            ? { ...it, cantidad_pedida: it.cantidad_pedida + cantidad }
            : it
        )
      }
      return [
        ...prev,
        {
          producto_id: producto.id,
          nombre: producto.nombre,
          codigo_barras: producto.codigo_barras,
          cantidad_pedida: cantidad,
          precio_costo: producto.precio_costo,
        },
      ]
    })
    setBusqueda('')
  }

  function agregarTodosSugeridos() {
    if (!sugeridos) return
    setItems((prev) => {
      const idsExistentes = new Set(prev.map((it) => it.producto_id))
      const nuevos = sugeridos
        .filter((s) => !idsExistentes.has(s.id))
        .map((s) => ({
          producto_id: s.id,
          nombre: s.nombre,
          codigo_barras: s.codigo_barras,
          cantidad_pedida: s.cantidad_sugerida,
          precio_costo: s.precio_costo,
        }))
      return [...prev, ...nuevos]
    })
  }

  function actualizarItem(
    producto_id: number,
    cambios: Partial<Pick<ItemFormulario, 'cantidad_pedida' | 'precio_costo'>>
  ) {
    setItems((prev) =>
      prev.map((it) =>
        it.producto_id === producto_id ? { ...it, ...cambios } : it
      )
    )
  }

  function eliminarItem(producto_id: number) {
    setItems((prev) => prev.filter((it) => it.producto_id !== producto_id))
  }

  function guardar(estado: 'borrador' | 'enviado') {
    if (!usuario || !proveedorId) return
    if (items.length === 0) return

    crearPedido.mutate(
      {
        proveedor_id: proveedorId,
        usuario_id: usuario.id,
        fecha_entrega_esperada: fechaEntrega || null,
        estado,
        items: items.map((it) => ({
          producto_id: it.producto_id,
          cantidad_pedida: it.cantidad_pedida,
          precio_costo: it.precio_costo,
        })),
      },
      {
        onSuccess: (pedido) => {
          router.push(`/pedidos/${pedido.id}`)
        },
      }
    )
  }

  const productosFiltrados = useMemo(() => {
    if (!busqueda.trim() || !productos) return []
    const idsEnPedido = new Set(items.map((it) => it.producto_id))
    return productos.filter((p) => !idsEnPedido.has(p.id)).slice(0, 6)
  }, [busqueda, productos, items])

  const puedeGuardar = !!proveedorId && items.length > 0 && !crearPedido.isPending

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div>
        <Link
          href="/compras"
          className="inline-flex items-center gap-1 text-sm text-[#6f3a2a] hover:text-[#391511] transition-colors"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Compras
        </Link>
        <h1 className="text-[#391511] text-2xl font-bold mt-1">Nueva orden de compra</h1>
      </div>

      {/* Bloque 1: Proveedor + fecha */}
      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-5 shadow-sm space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium">
              Proveedor <span className="text-[#c43e2c]">*</span>
            </Label>
            <Select value={proveedorIdStr} onValueChange={(v) => setProveedorIdStr(v ?? SIN_PROVEEDOR)}>
              <SelectTrigger className="border-[#e4c9b0] focus:ring-[#f9b44c]">
                <SelectValue placeholder="Seleccionar proveedor…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SIN_PROVEEDOR} disabled>
                  Seleccionar proveedor…
                </SelectItem>
                {proveedores?.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium">
              Fecha de entrega esperada
            </Label>
            <Input
              type="date"
              value={fechaEntrega}
              min={hoyIso()}
              onChange={(e) => setFechaEntrega(e.target.value)}
              disabled={!proveedor}
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c] tabular-nums"
            />
          </div>
        </div>

        {proveedor && (
          <div className="flex flex-wrap gap-3 text-xs pt-3 border-t border-[#e4c9b0]/40">
            <div className="inline-flex items-center gap-1.5 text-[#6f3a2a]">
              <Clock className="h-3.5 w-3.5 text-[#f9b44c]" />
              <span>Entrega: </span>
              <span className="font-semibold text-[#391511]">
                {proveedor.dias_entrega != null
                  ? `${proveedor.dias_entrega} días`
                  : 'sin definir'}
              </span>
            </div>
            <div className="inline-flex items-center gap-1.5 text-[#6f3a2a]">
              <CreditCard className="h-3.5 w-3.5 text-[#f9b44c]" />
              <span>Pago: </span>
              <span className="font-semibold text-[#391511]">
                {proveedor.condicion_pago ?? 'sin definir'}
              </span>
            </div>
            {proveedor.telefono && (
              <div className="inline-flex items-center gap-1.5 text-[#6f3a2a]">
                <Truck className="h-3.5 w-3.5 text-[#f9b44c]" />
                <span>{proveedor.telefono}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bloque 2: Sugeridos */}
      {proveedor && sugeridos && sugeridos.length > 0 && (
        <div className="bg-[#f9b44c]/8 border border-[#f9b44c]/40 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-[#f9b44c]" />
              <h3 className="text-[#391511] font-semibold">
                Sugeridos del proveedor
              </h3>
              <span className="text-xs text-[#6f3a2a]">
                · {sugeridos.length} bajo stock mínimo
              </span>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={agregarTodosSugeridos}
              className="border-[#f9b44c]/60 bg-white text-[#391511] hover:bg-[#f9b44c]/15 gap-1.5"
            >
              <Plus className="h-3.5 w-3.5" />
              Agregar todos
            </Button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {sugeridos.map((s) => {
              const yaEnPedido = items.some((it) => it.producto_id === s.id)
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() =>
                    agregarItem(s, s.cantidad_sugerida)
                  }
                  disabled={yaEnPedido}
                  className={cn(
                    'flex items-center justify-between gap-2 bg-white border rounded-xl px-3 py-2 text-left transition-all',
                    yaEnPedido
                      ? 'border-[#6f3a2a]/30 opacity-50 cursor-not-allowed'
                      : 'border-[#e4c9b0]/60 hover:border-[#f9b44c] hover:shadow-sm'
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-[#391511] text-sm truncate">
                      {s.nombre}
                    </div>
                    <div className="text-xs text-[#6f3a2a] mt-0.5 inline-flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3 text-[#e4a42a]" />
                      Stock {s.stock_actual} / mín {s.stock_minimo}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-xs text-[#6f3a2a]">Sugerido</div>
                    <div className="font-bold text-[#391511] tabular-nums">
                      {s.cantidad_sugerida}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Bloque 3: Buscador + items */}
      {proveedor && (
        <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-5 shadow-sm space-y-3">
          <h3 className="text-[#391511] font-semibold">Productos del pedido</h3>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#c8a58a]" />
            <Input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar producto por nombre o código…"
              className="pl-9 border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
            />
            {busqueda && productosFiltrados.length > 0 && (
              <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-[#e4c9b0] rounded-xl shadow-lg max-h-64 overflow-y-auto">
                {productosFiltrados.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => agregarItem(p)}
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
                    <div className="text-xs text-[#6f3a2a] tabular-nums">
                      <MontoARS monto={p.precio_costo} />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {items.length === 0 ? (
            <div className="text-center py-8 text-[#6f3a2a] text-sm">
              Agregá productos al pedido usando el buscador o los sugeridos.
            </div>
          ) : (
            <ul className="divide-y divide-[#e4c9b0]/40">
              {items.map((it) => {
                const subtotal = it.cantidad_pedida * it.precio_costo
                return (
                  <li
                    key={it.producto_id}
                    className="py-3 grid grid-cols-12 gap-2 items-center"
                  >
                    <div className="col-span-12 sm:col-span-5">
                      <div className="font-medium text-[#391511] text-sm">
                        {it.nombre}
                      </div>
                      {it.codigo_barras && (
                        <div className="text-xs text-[#c8a58a] font-mono mt-0.5">
                          {it.codigo_barras}
                        </div>
                      )}
                    </div>
                    <div className="col-span-4 sm:col-span-2">
                      <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a]">
                        Cantidad
                      </Label>
                      <Input
                        type="number"
                        min="1"
                        step="1"
                        value={it.cantidad_pedida}
                        onChange={(e) =>
                          actualizarItem(it.producto_id, {
                            cantidad_pedida: Math.max(
                              1,
                              Number(e.target.value) || 0
                            ),
                          })
                        }
                        className="h-9 tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
                      />
                    </div>
                    <div className="col-span-4 sm:col-span-2">
                      <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a]">
                        Precio costo
                      </Label>
                      <div className="relative">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[#c8a58a] text-xs">
                          $
                        </span>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={it.precio_costo}
                          onChange={(e) =>
                            actualizarItem(it.producto_id, {
                              precio_costo: Math.max(
                                0,
                                Number(e.target.value) || 0
                              ),
                            })
                          }
                          className="h-9 pl-5 tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
                        />
                      </div>
                    </div>
                    <div className="col-span-3 sm:col-span-2 text-right">
                      <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] block">
                        Subtotal
                      </Label>
                      <div className="font-bold text-[#391511] tabular-nums">
                        <MontoARS monto={subtotal} />
                      </div>
                    </div>
                    <div className="col-span-1 text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => eliminarItem(it.producto_id)}
                        className="text-[#c8a58a] hover:bg-[#c43e2c]/10 hover:text-[#c43e2c]"
                        aria-label="Quitar"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          {items.length > 0 && (
            <div className="border-t border-[#e4c9b0]/60 pt-3 flex items-baseline justify-between">
              <span className="text-[#6f3a2a] text-sm font-medium uppercase tracking-wider">
                Total
              </span>
              <span className="text-[#391511] text-3xl font-extrabold tabular-nums">
                {formatearMonto(total)}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Botones */}
      <div className="flex flex-wrap gap-2 justify-end sticky bottom-4">
        <Button
          variant="outline"
          onClick={() => guardar('borrador')}
          disabled={!puedeGuardar}
          className="border-[#e4c9b0] text-[#6f3a2a] hover:bg-[#fdfaf6]"
        >
          {crearPedido.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Guardando…
            </>
          ) : (
            'Guardar como borrador'
          )}
        </Button>
        <Button
          onClick={() => guardar('enviado')}
          disabled={!puedeGuardar}
          className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold"
        >
          {crearPedido.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Enviando…
            </>
          ) : (
            'Crear y marcar como enviado'
          )}
        </Button>
      </div>
    </div>
  )
}
