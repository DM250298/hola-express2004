'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  AlertTriangle,
  ChevronLeft,
  Clock,
  CreditCard,
  FileSpreadsheet,
  FileText,
  Loader2,
  Plus,
  Search,
  Send,
  Sparkles,
  Trash2,
  Truck,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { MontoARS } from '@/components/shared/MontoARS'
import { DrawerProducto } from '@/components/configuracion/productos/DrawerProducto'
import { formatearMonto } from '@/lib/utils/formato'
import {
  generarCotizacionExcel,
  generarCotizacionPDF,
} from '@/lib/utils/cotizacion'
import { useProveedores } from '@/lib/hooks/useProveedores'
import { useProductos } from '@/lib/hooks/useProductos'
import {
  useActualizarPedido,
  useCrearPedido,
  usePedidoDetalle,
  useProductosSugeridos,
} from '@/lib/hooks/usePedidos'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { parsearDiasCondicionPago } from '@/lib/queries/pedidos'
import { tomarHandoffReposicion } from '@/lib/compras/handoffReposicion'
import { cn } from '@/lib/utils'
import type { ProveedorRow } from '@/types/database'

const SIN_PROVEEDOR = '__sin_proveedor__'
const SIN_TERMINOS = '__sin_terminos__'

/** Opciones de términos de pago para la orden (ver migración 115). */
const TERMINOS_PAGO = [
  'Pago inmediato',
  '7 días',
  '15 días',
  '21 días',
  '30 días',
  '45 días',
] as const

interface ItemFormulario {
  producto_id: number
  nombre: string
  codigo_barras: string | null
  cantidad_pedida: number
  precio_costo: number
}

interface Props {
  /** Si viene, el formulario edita esa orden (borrador o enviada) en vez de crear una nueva. */
  pedidoId?: number
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

/**
 * Mapea la condición de pago del proveedor a una de las opciones de términos
 * (por cantidad de días), para pre-seleccionarla al elegir proveedor. Si no
 * matchea ninguna, devuelve '' (queda "Sin especificar").
 */
function terminoDesdeCondicion(condicion: string | null | undefined): string {
  if (!condicion) return ''
  const dias = parsearDiasCondicionPago(condicion)
  const porDias: Record<number, string> = {
    0: 'Pago inmediato',
    7: '7 días',
    15: '15 días',
    21: '21 días',
    30: '30 días',
    45: '45 días',
  }
  return porDias[dias] ?? ''
}

/**
 * Input de cantidad que SÍ se puede vaciar mientras se edita (el número no
 * vuelve a "1" solo). Mantiene su propio texto local: sólo confirma al padre
 * un entero válido ≥ 1, y al perder el foco vacío clampea a 1. Además
 * selecciona todo al enfocarse, así con un click se reemplaza el valor.
 */
function CantidadInput({
  value,
  onCommit,
}: {
  value: number
  onCommit: (n: number) => void
}) {
  const [raw, setRaw] = useState(String(value))

  // Sincroniza cuando el valor cambia DESDE AFUERA (ej. sumar el mismo
  // sugerido). Sólo pisa el texto si difiere de lo tipeado, para no saltar a la
  // forma canónica mientras se escribe (ceros a la izquierda). Con el campo
  // vacío `value` no cambia, así que este efecto no corre y el vacío se respeta.
  useEffect(() => {
    if (Number(raw) !== value) setRaw(String(value))
    // Sólo depende de `value`: `raw` se lee del render donde `value` cambió.
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Input
      type="number"
      inputMode="numeric"
      min="1"
      step="1"
      value={raw}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => {
        const v = e.target.value
        setRaw(v)
        const n = Number(v)
        if (v !== '' && Number.isFinite(n) && n >= 1) {
          onCommit(Math.floor(n))
        }
      }}
      onBlur={() => {
        const n = Math.max(1, Math.floor(Number(raw) || 0))
        setRaw(String(n))
        onCommit(n)
      }}
      className="h-9 tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
    />
  )
}

export function FormularioNuevoPedido({ pedidoId }: Props) {
  const router = useRouter()
  const esEdicion = pedidoId != null
  const { data: usuario } = useUsuario()
  const { data: proveedores } = useProveedores()
  const crearPedido = useCrearPedido()
  const actualizarPedido = useActualizarPedido()

  // Carga de la orden a editar (solo en modo edición).
  const {
    data: pedidoEdicion,
    isLoading: cargandoEdicion,
    isError: errorEdicion,
  } = usePedidoDetalle(esEdicion ? pedidoId : undefined)

  const [proveedorIdStr, setProveedorIdStr] = useState<string>(SIN_PROVEEDOR)
  const [fechaEntrega, setFechaEntrega] = useState<string>('')
  const [terminosPago, setTerminosPago] = useState<string>('')
  const [items, setItems] = useState<ItemFormulario[]>([])
  const [busqueda, setBusqueda] = useState('')
  const [nuevoProductoAbierto, setNuevoProductoAbierto] = useState(false)
  // Evita que el prefill de edición (o el auto-cálculo de fecha) pise lo que el
  // usuario ya tocó: sólo corre una vez.
  const prefillHecho = useRef(false)
  // El handoff de Reposición deja sólo el id del proveedor; marca que hay que
  // auto-completar fecha/términos cuando ese proveedor termine de cargar.
  const autoFillProveedor = useRef(false)

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

  // Pre-carga desde Reposición (handoff). Solo en modo "nuevo".
  useEffect(() => {
    if (esEdicion) return
    const handoff = tomarHandoffReposicion()
    if (!handoff) return
    setProveedorIdStr(String(handoff.proveedor_id))
    setItems(handoff.items)
    autoFillProveedor.current = true
  }, [esEdicion])

  // Auto-completa fecha de entrega y términos cuando el proveedor del handoff
  // termina de cargar (el handoff sólo dejó el id). Corre una sola vez y no
  // aplica al modo edición (ahí el prefill ya trae fecha/términos guardados).
  useEffect(() => {
    if (!autoFillProveedor.current || !proveedor) return
    autoFillProveedor.current = false
    setFechaEntrega(
      proveedor.dias_entrega != null ? sumarDias(proveedor.dias_entrega) : ''
    )
    setTerminosPago(terminoDesdeCondicion(proveedor.condicion_pago))
  }, [proveedor])

  // Prefill de la orden a editar (una sola vez, cuando llegan los datos).
  useEffect(() => {
    if (!esEdicion || prefillHecho.current || !pedidoEdicion) return
    prefillHecho.current = true
    setProveedorIdStr(String(pedidoEdicion.proveedor_id))
    setFechaEntrega(pedidoEdicion.fecha_entrega_esperada ?? '')
    setTerminosPago(pedidoEdicion.terminos_pago ?? '')
    setItems(
      pedidoEdicion.items.map((it) => ({
        producto_id: it.producto_id,
        nombre: it.producto?.nombre ?? 'Producto',
        codigo_barras: it.producto?.codigo_barras ?? null,
        cantidad_pedida: it.cantidad_pedida,
        precio_costo: it.precio_costo,
      }))
    )
  }, [esEdicion, pedidoEdicion])

  const total = useMemo(
    () => items.reduce((acc, it) => acc + it.cantidad_pedida * it.precio_costo, 0),
    [items]
  )

  // Etiquetas para que el Select muestre el NOMBRE del proveedor (no el id
  // crudo "32") y el término elegido en el trigger.
  const itemsProveedor = useMemo(() => {
    const r: Record<string, string> = {
      [SIN_PROVEEDOR]: 'Seleccionar proveedor…',
    }
    for (const p of proveedores ?? []) r[String(p.id)] = p.nombre
    return r
  }, [proveedores])

  const itemsTerminos = useMemo(() => {
    const r: Record<string, string> = { [SIN_TERMINOS]: 'Sin especificar' }
    for (const t of TERMINOS_PAGO) r[t] = t
    return r
  }, [])

  function elegirProveedor(v: string | null) {
    const nuevo = v ?? SIN_PROVEEDOR
    // Cambiar de proveedor a mano reinicia el pedido.
    setProveedorIdStr(nuevo)
    setItems([])
    setBusqueda('')
    // Auto-cálculo de fecha de entrega + términos según el proveedor elegido.
    const prov = proveedores?.find((p) => String(p.id) === nuevo)
    setFechaEntrega(
      prov?.dias_entrega != null ? sumarDias(prov.dias_entrega) : ''
    )
    setTerminosPago(terminoDesdeCondicion(prov?.condicion_pago))
  }

  function agregarItem(
    producto: {
      id: number
      nombre: string
      codigo_barras: string | null
      precio_costo: number
    },
    cantidad = 1
  ) {
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

  const guardando = crearPedido.isPending || actualizarPedido.isPending

  function guardar(estado: 'borrador' | 'enviado') {
    if (!usuario || !proveedorId || items.length === 0 || guardando) return

    const itemsPayload = items.map((it) => ({
      producto_id: it.producto_id,
      cantidad_pedida: Math.max(1, Math.floor(it.cantidad_pedida) || 1),
      precio_costo: it.precio_costo,
    }))

    if (esEdicion && pedidoId != null) {
      actualizarPedido.mutate(
        {
          pedido_id: pedidoId,
          proveedor_id: proveedorId,
          fecha_entrega_esperada: fechaEntrega || null,
          terminos_pago: terminosPago || null,
          estado,
          items: itemsPayload,
        },
        { onSuccess: () => router.push(`/pedidos/${pedidoId}`) }
      )
      return
    }

    crearPedido.mutate(
      {
        proveedor_id: proveedorId,
        usuario_id: usuario.id,
        fecha_entrega_esperada: fechaEntrega || null,
        terminos_pago: terminosPago || null,
        estado,
        items: itemsPayload,
      },
      {
        onSuccess: (pedido) => {
          router.push(`/pedidos/${pedido.id}`)
        },
      }
    )
  }

  const puedeCotizar = !!proveedor && items.length > 0

  async function descargarCotizacion(tipo: 'excel' | 'pdf') {
    if (!puedeCotizar || !proveedor) return
    const itemsCot = items.map((it) => ({
      codigo: it.codigo_barras ?? '',
      nombre: it.nombre,
      cantidad: it.cantidad_pedida,
    }))
    try {
      if (tipo === 'excel') {
        await generarCotizacionExcel(proveedor.nombre, itemsCot)
      } else {
        await generarCotizacionPDF(proveedor.nombre, itemsCot)
      }
    } catch {
      toast.error('No se pudo generar la cotización.')
    }
  }

  const productosFiltrados = useMemo(() => {
    if (!busqueda.trim() || !productos) return []
    const idsEnPedido = new Set(items.map((it) => it.producto_id))
    return productos.filter((p) => !idsEnPedido.has(p.id)).slice(0, 6)
  }, [busqueda, productos, items])

  const puedeGuardar = !!proveedorId && items.length > 0 && !guardando

  // ─── Guards del modo edición ──────────────────────────────────────────
  if (esEdicion) {
    if (cargandoEdicion) {
      return (
        <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
          <Skeleton className="h-6 w-32 bg-[#f9d2a2]/30" />
          <Skeleton className="h-28 rounded-2xl bg-[#f9d2a2]/30" />
          <Skeleton className="h-64 rounded-2xl bg-[#f9d2a2]/30" />
        </div>
      )
    }
    if (errorEdicion || !pedidoEdicion) {
      return (
        <div className="p-12 text-center">
          <p className="text-[#391511] font-semibold">Orden no encontrada</p>
          <Link
            href="/compras"
            className="text-[#c43e2c] text-sm hover:underline mt-1 inline-block"
          >
            Volver a compras
          </Link>
        </div>
      )
    }
    const editable =
      pedidoEdicion.estado === 'borrador' || pedidoEdicion.estado === 'enviado'
    if (!editable) {
      return (
        <div className="p-12 text-center max-w-md mx-auto">
          <AlertTriangle className="h-10 w-10 text-[#c8a58a] mx-auto mb-3" />
          <p className="text-[#391511] font-semibold">
            Esta orden ya no se puede editar
          </p>
          <p className="text-[#6f3a2a] text-sm mt-1">
            Solo se pueden editar órdenes en borrador o enviadas (no recibidas).
          </p>
          <Link
            href={`/pedidos/${pedidoId}`}
            className="text-[#c43e2c] text-sm hover:underline mt-2 inline-block"
          >
            Ver la orden
          </Link>
        </div>
      )
    }
    // Esperando el prefill (un tick): evita el flash del formulario vacío.
    if (!prefillHecho.current) {
      return (
        <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
          <Skeleton className="h-6 w-32 bg-[#f9d2a2]/30" />
          <Skeleton className="h-28 rounded-2xl bg-[#f9d2a2]/30" />
          <Skeleton className="h-64 rounded-2xl bg-[#f9d2a2]/30" />
        </div>
      )
    }
  }

  const estadoOriginal = pedidoEdicion?.estado
  const tituloPagina = esEdicion
    ? `Editar orden #${pedidoId}`
    : 'Nueva orden de compra'

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
        <h1 className="text-[#391511] text-2xl font-bold mt-1">{tituloPagina}</h1>
      </div>

      {/* Bloque 1: Proveedor + fecha + términos de pago */}
      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-5 shadow-sm space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium">
              Proveedor <span className="text-[#c43e2c]">*</span>
            </Label>
            <Select
              items={itemsProveedor}
              value={proveedorIdStr}
              onValueChange={elegirProveedor}
            >
              <SelectTrigger className="w-full border-[#e4c9b0] focus:ring-[#f9b44c]">
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
              disabled={!proveedorId}
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c] tabular-nums"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium">Términos de pago</Label>
            <Select
              items={itemsTerminos}
              value={terminosPago || SIN_TERMINOS}
              disabled={!proveedorId}
              onValueChange={(v) =>
                setTerminosPago(v && v !== SIN_TERMINOS ? v : '')
              }
            >
              <SelectTrigger className="w-full border-[#e4c9b0] focus:ring-[#f9b44c]">
                <SelectValue placeholder="Sin especificar" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SIN_TERMINOS}>Sin especificar</SelectItem>
                {TERMINOS_PAGO.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
                {terminosPago || proveedor.condicion_pago || 'sin definir'}
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

      {/* Bloque 2: Buscador + items (primero, como pidió el usuario) */}
      {proveedorId && (
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
            {busqueda.trim() && (
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
                {/* Alta al vuelo: crea el producto (queda sin precio hasta la
                    factura) y lo agrega al pedido. */}
                <button
                  type="button"
                  onClick={() => setNuevoProductoAbierto(true)}
                  className="w-full px-3 py-2.5 flex items-center gap-2 hover:bg-[#f9b44c]/10 text-left border-t border-[#e4c9b0]/60 text-[#9e6b15] font-medium"
                >
                  <Plus className="h-4 w-4 shrink-0" />
                  <span className="truncate text-sm">
                    Crear producto nuevo «{busqueda.trim()}»
                  </span>
                </button>
              </div>
            )}
          </div>

          {items.length === 0 ? (
            <div className="text-center py-8 text-[#6f3a2a] text-sm">
              Agregá productos al pedido usando el buscador o los sugeridos de
              abajo.
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
                      <CantidadInput
                        value={it.cantidad_pedida}
                        onCommit={(n) =>
                          actualizarItem(it.producto_id, { cantidad_pedida: n })
                        }
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

      {/* Bloque 3: Sugeridos (debajo de los productos del pedido) */}
      {proveedorId && sugeridos && sugeridos.length > 0 && (
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
                  onClick={() => agregarItem(s, s.cantidad_sugerida)}
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
                    <div className="text-xs text-[#6f3a2a]">
                      {yaEnPedido ? 'En el pedido' : 'Sugerido'}
                    </div>
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

      {/* Botones */}
      <div className="flex flex-wrap gap-2 justify-between items-center sticky bottom-4">
        {/* Cotización para el proveedor (Excel / PDF) */}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => descargarCotizacion('excel')}
            disabled={!puedeCotizar}
            className="border-[#e4c9b0] text-[#6f3a2a] hover:bg-[#fdfaf6] gap-1.5 bg-white disabled:opacity-40"
          >
            <FileSpreadsheet className="h-4 w-4" />
            Cotización Excel
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => descargarCotizacion('pdf')}
            disabled={!puedeCotizar}
            className="border-[#e4c9b0] text-[#6f3a2a] hover:bg-[#fdfaf6] gap-1.5 bg-white disabled:opacity-40"
          >
            <FileText className="h-4 w-4" />
            Cotización PDF
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          {esEdicion ? (
            <>
              <Button
                onClick={() => guardar((estadoOriginal as 'borrador' | 'enviado') ?? 'borrador')}
                disabled={!puedeGuardar}
                variant={estadoOriginal === 'enviado' ? 'default' : 'outline'}
                className={
                  estadoOriginal === 'enviado'
                    ? 'bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold'
                    : 'border-[#e4c9b0] text-[#6f3a2a] hover:bg-[#fdfaf6] bg-white'
                }
              >
                {guardando ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Guardando…
                  </>
                ) : (
                  'Guardar cambios'
                )}
              </Button>
              {estadoOriginal === 'borrador' && (
                <Button
                  onClick={() => guardar('enviado')}
                  disabled={!puedeGuardar}
                  className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5"
                >
                  <Send className="h-4 w-4" />
                  Marcar como enviado
                </Button>
              )}
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => guardar('borrador')}
                disabled={!puedeGuardar}
                className="border-[#e4c9b0] text-[#6f3a2a] hover:bg-[#fdfaf6] bg-white"
              >
                {guardando ? (
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
                {guardando ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Enviando…
                  </>
                ) : (
                  'Crear y marcar como enviado'
                )}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Alta de producto al vuelo: prellena el nombre escrito y el proveedor
          del pedido. Si no se carga precio queda "pendiente de precio" (no se
          puede vender hasta cargar la factura). Al crearse se suma al pedido. */}
      <DrawerProducto
        abierto={nuevoProductoAbierto}
        onCambioAbierto={setNuevoProductoAbierto}
        producto={null}
        nombreInicial={busqueda.trim()}
        proveedorIdInicial={proveedorId ?? null}
        onCreado={(prod) => {
          agregarItem({
            id: prod.id,
            nombre: prod.nombre,
            codigo_barras: prod.codigo_barras,
            precio_costo: prod.precio_costo ?? 0,
          })
          setNuevoProductoAbierto(false)
        }}
      />
    </div>
  )
}
