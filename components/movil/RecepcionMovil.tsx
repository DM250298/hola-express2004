'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  Calendar,
  ChevronLeft,
  Loader2,
  PackageCheck,
  Plus,
  ShieldCheck,
} from 'lucide-react'
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
import { ModalClaveSupervisor } from '@/components/compras/ModalClaveSupervisor'
import { EscanerCamara } from './EscanerCamara'
import {
  useActualizarEstadoPedido,
  usePedidoDetalle,
  useRecibirPedido,
} from '@/lib/hooks/usePedidos'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { useCategorias } from '@/lib/hooks/useCategorias'
import { agregarItemPedido, parsearDiasCondicionPago } from '@/lib/queries/pedidos'
import { createProducto, getProductoByBarcode } from '@/lib/queries/productos'
import { formatearFechaCorta } from '@/lib/utils/formato'

interface ItemEstado {
  item_id: number
  producto_id: number
  nombre: string
  codigo_barras: string | null
  cantidad_pedida: number
  /** Lo ya recibido en entregas anteriores (acumulado en la DB). */
  ya_recibido: number
  /** Costo de la línea (no se muestra en pantalla, pero viaja en la recepción). */
  precio_costo: number
  /** Lo que se recibe en ESTA entrega (input controlado). */
  cantidad_recibida: string
  fecha_vencimiento: string
  dias_vencimiento_minimo: number | null
}

interface Props {
  pedidoId: number
}

/**
 * Recepción de un pedido desde el teléfono: escaneo con cámara (cada lectura
 * suma 1 al producto, editable), fecha de vencimiento opcional por ítem, clave
 * de supervisor si se recibe de más, y registro atómico vía `fn_recibir_pedido`.
 * No muestra precios/costos. Permite agregar un producto que no estaba en la
 * orden (creándolo si hace falta).
 */
export function RecepcionMovil({ pedidoId }: Props) {
  const router = useRouter()
  const { data: usuario } = useUsuario()
  const { data: pedido, isLoading } = usePedidoDetalle(pedidoId)
  const { data: categorias } = useCategorias()
  const recibir = useRecibirPedido()
  const cambiarEstado = useActualizarEstadoPedido()

  const [itemsEstado, setItemsEstado] = useState<ItemEstado[]>([])
  const [aceptaPorDebajoMin, setAceptaPorDebajoMin] = useState(false)
  const [excesoAutorizado, setExcesoAutorizado] = useState(false)
  const [autorizadoPor, setAutorizadoPor] = useState<string | null>(null)
  const [modalSupervisorAbierto, setModalSupervisorAbierto] = useState(false)
  const cerrarTrasRecepcion = useRef(false)

  // Alta de producto que no está en el pedido
  const [ultimoNoEncontrado, setUltimoNoEncontrado] = useState('')
  const [modalNuevoAbierto, setModalNuevoAbierto] = useState(false)
  const [nuevoCodigo, setNuevoCodigo] = useState('')
  const [nuevoNombre, setNuevoNombre] = useState('')
  const [nuevoPrecio, setNuevoPrecio] = useState('')
  const [nuevoCategoria, setNuevoCategoria] = useState('')
  const [nuevoCantidad, setNuevoCantidad] = useState('')
  const [nuevoVenc, setNuevoVenc] = useState('')
  const [guardandoNuevo, setGuardandoNuevo] = useState(false)

  useEffect(() => {
    if (!pedido) return
    setItemsEstado(
      pedido.items.map((it) => ({
        item_id: it.id,
        producto_id: it.producto_id,
        nombre: it.producto?.nombre ?? 'Producto eliminado',
        codigo_barras: it.producto?.codigo_barras ?? null,
        cantidad_pedida: it.cantidad_pedida,
        ya_recibido: it.cantidad_recibida ?? 0,
        precio_costo: it.precio_costo,
        cantidad_recibida: '',
        fecha_vencimiento: '',
        dias_vencimiento_minimo: it.producto?.dias_vencimiento_minimo ?? null,
      }))
    )
    setAceptaPorDebajoMin(false)
    setExcesoAutorizado(false)
    setAutorizadoPor(null)
  }, [pedido])

  function actualizarItem(
    item_id: number,
    cambios: Partial<Pick<ItemEstado, 'cantidad_recibida' | 'fecha_vencimiento'>>
  ) {
    setItemsEstado((prev) =>
      prev.map((it) => (it.item_id === item_id ? { ...it, ...cambios } : it))
    )
  }

  /** Escaneo: suma 1 a la cantidad recibida del producto con ese código. */
  function alEscanear(codigo: string) {
    const item = itemsEstado.find((it) => it.codigo_barras === codigo)
    if (!item) {
      setUltimoNoEncontrado(codigo)
      toast.error('No está en el pedido. Tocá "Agregar producto" para sumarlo.')
      return
    }
    const actual = Number(item.cantidad_recibida) || 0
    actualizarItem(item.item_id, { cantidad_recibida: String(actual + 1) })
    toast.success(`${item.nombre} · ${actual + 1}`)
  }

  /** Total de unidades de esta entrega (habilita el botón; no usa plata). */
  const totalUnidades = useMemo(
    () =>
      itemsEstado.reduce(
        (acc, it) => acc + (Number(it.cantidad_recibida) || 0),
        0
      ),
    [itemsEstado]
  )

  const condicionDias = parsearDiasCondicionPago(
    pedido?.proveedor_completo?.condicion_pago
  )
  const fechaVencimientoCuenta = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() + condicionDias)
    return d.toISOString().slice(0, 10)
  }, [condicionDias])

  const hayErrores = itemsEstado.some(
    (it) =>
      it.cantidad_recibida !== '' &&
      (Number.isNaN(Number(it.cantidad_recibida)) ||
        Number(it.cantidad_recibida) < 0)
  )

  const itemsConExceso = useMemo(
    () =>
      itemsEstado.filter(
        (it) =>
          it.ya_recibido + (Number(it.cantidad_recibida) || 0) >
          it.cantidad_pedida
      ),
    [itemsEstado]
  )
  const requiereSupervisor = itemsConExceso.length > 0 && !excesoAutorizado

  const esParcial = useMemo(() => {
    const pedidoTotal = itemsEstado.reduce(
      (acc, it) => acc + it.cantidad_pedida,
      0
    )
    const recibidoTotal = itemsEstado.reduce(
      (acc, it) => acc + it.ya_recibido + (Number(it.cantidad_recibida) || 0),
      0
    )
    return recibidoTotal < pedidoTotal
  }, [itemsEstado])

  const itemsPorDebajoMinimo = useMemo(() => {
    return itemsEstado.flatMap((it) => {
      const min = it.dias_vencimiento_minimo
      if (min == null || !it.fecha_vencimiento) return []
      const cant = Number(it.cantidad_recibida) || 0
      if (cant <= 0) return []
      const hoy = new Date()
      hoy.setHours(0, 0, 0, 0)
      const venc = new Date(`${it.fecha_vencimiento}T00:00:00`)
      const dias = Math.floor(
        (venc.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24)
      )
      if (dias >= min) return []
      return [{ ...it, diasReales: dias, diasMinimo: min }]
    })
  }, [itemsEstado])

  const requiereAceptacion =
    itemsPorDebajoMinimo.length > 0 && !aceptaPorDebajoMin
  const procesando = recibir.isPending || cambiarEstado.isPending
  const accionDeshabilitada =
    procesando || hayErrores || totalUnidades <= 0 || requiereAceptacion

  function confirmar(cerrarPedido: boolean) {
    if (!usuario || hayErrores || !pedido?.proveedor) return
    cerrarTrasRecepcion.current = cerrarPedido
    if (requiereSupervisor) {
      setModalSupervisorAbierto(true)
      return
    }
    ejecutarRecepcion(cerrarPedido)
  }

  function ejecutarRecepcion(cerrarPedido: boolean) {
    if (!usuario || !pedido?.proveedor) return
    recibir.mutate(
      {
        pedido_id: pedido.id,
        proveedor_id: pedido.proveedor.id,
        usuario_id: usuario.id,
        condicion_pago_dias: condicionDias,
        items: itemsEstado.map((it) => ({
          item_id: it.item_id,
          producto_id: it.producto_id,
          cantidad_recibida: Math.max(0, Number(it.cantidad_recibida) || 0),
          precio_costo: it.precio_costo,
          fecha_vencimiento: it.fecha_vencimiento || null,
        })),
      },
      {
        onSuccess: (resultado) => {
          if (cerrarPedido && resultado.es_parcial) {
            cambiarEstado.mutate({ id: pedido.id, estado: 'recibido' })
          }
          router.push('/movil/recepcion')
        },
      }
    )
  }

  async function guardarNuevoProducto() {
    const cant = Number(nuevoCantidad)
    if (!Number.isFinite(cant) || cant <= 0) {
      toast.error('Poné cuántas unidades llegaron.')
      return
    }
    setGuardandoNuevo(true)
    try {
      const cod = nuevoCodigo.trim()
      let prod: { id: number; nombre: string; codigo_barras: string | null } | null =
        null
      // Si el código ya existe en el catálogo, se usa ese producto.
      if (cod) prod = await getProductoByBarcode(cod)
      if (!prod) {
        if (!nuevoNombre.trim()) {
          toast.error('Poné el nombre del producto.')
          setGuardandoNuevo(false)
          return
        }
        const precio = Number(nuevoPrecio)
        if (!Number.isFinite(precio) || precio <= 0) {
          toast.error('Poné el precio de venta.')
          setGuardandoNuevo(false)
          return
        }
        prod = await createProducto({
          nombre: nuevoNombre.trim(),
          precio_venta: precio,
          codigo_barras: cod || null,
          categoria_id: nuevoCategoria ? Number(nuevoCategoria) : null,
        })
      }

      if (itemsEstado.some((it) => it.producto_id === prod!.id)) {
        toast.info(`${prod.nombre} ya está en la lista.`)
      } else {
        const nuevoItem = await agregarItemPedido({
          pedido_id: pedidoId,
          producto_id: prod.id,
          cantidad: cant,
          precio_costo: 0,
        })
        setItemsEstado((prev) => [
          ...prev,
          {
            item_id: nuevoItem.id,
            producto_id: prod!.id,
            nombre: prod!.nombre,
            codigo_barras: prod!.codigo_barras,
            cantidad_pedida: cant,
            ya_recibido: 0,
            precio_costo: 0,
            cantidad_recibida: String(cant),
            fecha_vencimiento: nuevoVenc,
            dias_vencimiento_minimo: null,
          },
        ])
        toast.success(`${prod.nombre} agregado al pedido`)
      }

      setModalNuevoAbierto(false)
      setNuevoCodigo('')
      setNuevoNombre('')
      setNuevoPrecio('')
      setNuevoCategoria('')
      setNuevoCantidad('')
      setNuevoVenc('')
      setUltimoNoEncontrado('')
    } catch (e) {
      toast.error(`No se pudo agregar: ${(e as Error).message}`)
    } finally {
      setGuardandoNuevo(false)
    }
  }

  function abrirNuevoProducto() {
    setNuevoCodigo(ultimoNoEncontrado)
    setModalNuevoAbierto(true)
  }

  if (isLoading) {
    return (
      <div className="mx-auto max-w-md px-4 py-10 text-center">
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-[#9e6b15]" />
        <p className="mt-2 text-sm text-[#6f3a2a]">Cargando el pedido…</p>
      </div>
    )
  }

  if (!pedido) {
    return (
      <div className="mx-auto max-w-md px-4 py-10 text-center">
        <p className="font-semibold text-[#391511]">No se encontró el pedido.</p>
        <Link
          href="/movil/recepcion"
          className="mt-2 inline-block text-sm font-medium text-[#9e6b15]"
        >
          Volver a la lista
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-md px-4 py-4 pb-40">
      <header className="mb-3">
        <Link
          href="/movil/recepcion"
          className="flex items-center gap-1 text-sm font-medium text-[#6f3a2a]"
        >
          <ChevronLeft className="h-4 w-4" /> Volver
        </Link>
        <h1 className="mt-1 flex items-center gap-2 text-xl font-extrabold text-[#391511]">
          <PackageCheck className="h-5 w-5 text-[#f9b44c]" />
          Pedido #{pedido.id}
        </h1>
        <p className="text-sm text-[#6f3a2a]">
          {pedido.proveedor?.nombre ?? 'Proveedor'} · cuenta vence el{' '}
          {formatearFechaCorta(fechaVencimientoCuenta)}
        </p>
      </header>

      <div className="mb-4">
        <EscanerCamara
          onDetectado={alEscanear}
          ayuda="Cada escaneo suma 1 unidad al producto"
        />
      </div>

      {excesoAutorizado && autorizadoPor && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-[#2f7d4f]/30 bg-[#2f7d4f]/10 px-3 py-2 text-xs text-[#2f7d4f]">
          <ShieldCheck className="h-4 w-4 shrink-0" />
          Exceso autorizado por <span className="font-semibold">{autorizadoPor}</span>.
        </div>
      )}

      <ul className="space-y-2">
        {itemsEstado.map((it) => {
          const cantNum = Number(it.cantidad_recibida) || 0
          const diferencia = it.ya_recibido + cantNum - it.cantidad_pedida
          return (
            <li
              key={it.item_id}
              className="rounded-2xl border border-[#e4c9b0]/70 bg-white p-3 shadow-sm"
            >
              <div className="min-w-0">
                <p className="font-medium text-[#391511]">{it.nombre}</p>
                <p className="text-xs text-[#6f3a2a]">
                  Pedido:{' '}
                  <span className="font-semibold tabular-nums">
                    {it.cantidad_pedida}
                  </span>
                  {it.ya_recibido > 0 && (
                    <>
                      {' '}
                      · ya recibido{' '}
                      <span className="font-semibold tabular-nums">
                        {it.ya_recibido}
                      </span>
                    </>
                  )}
                </p>
              </div>

              <div className="mt-2 grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a]">
                    Recibido
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    step="1"
                    inputMode="numeric"
                    value={it.cantidad_recibida}
                    onChange={(e) =>
                      actualizarItem(it.item_id, {
                        cantidad_recibida: e.target.value,
                      })
                    }
                    placeholder="0"
                    className="h-12 border-[#e4c9b0] text-lg tabular-nums focus-visible:ring-[#f9b44c]"
                  />
                  {diferencia !== 0 && !Number.isNaN(diferencia) && cantNum > 0 && (
                    <p
                      className={
                        diferencia > 0
                          ? 'mt-0.5 text-[10px] text-[#9e6b15]'
                          : 'mt-0.5 text-[10px] text-[#c43e2c]'
                      }
                    >
                      {diferencia > 0 ? '+' : ''}
                      {diferencia} vs. pedido
                    </p>
                  )}
                </div>
                <div>
                  <Label className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-[#6f3a2a]">
                    <Calendar className="h-3 w-3" />
                    Vence (opc.)
                  </Label>
                  <Input
                    type="date"
                    value={it.fecha_vencimiento}
                    onChange={(e) =>
                      actualizarItem(it.item_id, {
                        fecha_vencimiento: e.target.value,
                      })
                    }
                    className="h-12 border-[#e4c9b0] tabular-nums focus-visible:ring-[#f9b44c]"
                  />
                </div>
              </div>
            </li>
          )
        })}
      </ul>

      {/* Agregar producto que no estaba en el pedido */}
      <button
        type="button"
        onClick={abrirNuevoProducto}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[#e4c9b0] bg-white/60 px-3 py-3 text-sm font-semibold text-[#9e6b15] transition active:scale-[0.99]"
      >
        <Plus className="h-4 w-4" />
        Agregar producto que no está en el pedido
      </button>

      {itemsPorDebajoMinimo.length > 0 && (
        <div className="mt-3 space-y-2 rounded-2xl border-2 border-[#c43e2c]/40 bg-[#c43e2c]/10 p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[#c43e2c]" />
            <p className="text-xs text-[#391511]">
              {itemsPorDebajoMinimo.length} producto
              {itemsPorDebajoMinimo.length === 1 ? '' : 's'} con vencimiento por
              debajo del mínimo configurado.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm font-medium text-[#391511]">
            <input
              type="checkbox"
              checked={aceptaPorDebajoMin}
              onChange={(e) => setAceptaPorDebajoMin(e.target.checked)}
              className="h-4 w-4 accent-[#c43e2c]"
            />
            Acepto recibir igual
          </label>
        </div>
      )}

      {/* Barra de acción fija abajo */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-[#e4c9b0]/60 bg-[#fdfaf6]/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-md items-center justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a]">
              {itemsEstado.some((it) => it.ya_recibido > 0)
                ? 'Esta entrega'
                : 'A recibir'}
            </div>
            <div className="text-xl font-extrabold tabular-nums text-[#391511]">
              {totalUnidades} u.
            </div>
          </div>
          {esParcial && totalUnidades > 0 ? (
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => confirmar(false)}
                disabled={accionDeshabilitada}
                className="h-12 border-[#e4a42a]/60 text-[#9e6b15]"
              >
                Parcial
              </Button>
              <Button
                type="button"
                onClick={() => confirmar(true)}
                disabled={accionDeshabilitada}
                className="h-12 bg-[#f9b44c] font-semibold text-[#391511] hover:bg-[#e4a42a]"
              >
                Cerrar
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              onClick={() => confirmar(false)}
              disabled={accionDeshabilitada}
              className="h-12 bg-[#f9b44c] px-6 font-semibold text-[#391511] hover:bg-[#e4a42a]"
            >
              {procesando ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  …
                </>
              ) : (
                'Confirmar'
              )}
            </Button>
          )}
        </div>
      </div>

      <ModalClaveSupervisor
        abierto={modalSupervisorAbierto}
        onCambioAbierto={setModalSupervisorAbierto}
        motivo={`Se está recibiendo más cantidad de la pedida en ${itemsConExceso.length} producto(s). Un encargado debe autorizarlo.`}
        onAutorizado={(nombre) => {
          setExcesoAutorizado(true)
          setAutorizadoPor(nombre)
          ejecutarRecepcion(cerrarTrasRecepcion.current)
        }}
      />

      {/* Modal: agregar / crear producto que no está en el pedido */}
      <Dialog open={modalNuevoAbierto} onOpenChange={setModalNuevoAbierto}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[#391511]">
              <Plus className="h-5 w-5 text-[#f9b44c]" />
              Agregar producto
            </DialogTitle>
            <DialogDescription className="text-[#6f3a2a]">
              Si el código ya existe, se usa ese producto. Si no, se crea uno
              nuevo y se suma a este pedido.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <Label className="text-xs text-[#6f3a2a]">
                Código de barras (opcional)
              </Label>
              <Input
                inputMode="numeric"
                value={nuevoCodigo}
                onChange={(e) => setNuevoCodigo(e.target.value)}
                placeholder="Escaneá o escribí el código…"
                className="h-11 border-[#e4c9b0] font-mono focus-visible:ring-[#f9b44c]"
              />
            </div>
            <div>
              <Label className="text-xs text-[#6f3a2a]">Nombre del producto</Label>
              <Input
                value={nuevoNombre}
                onChange={(e) => setNuevoNombre(e.target.value)}
                placeholder="Ej: Gaseosa Cola 1.5L"
                className="h-11 border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs text-[#6f3a2a]">Precio de venta</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={nuevoPrecio}
                  onChange={(e) => setNuevoPrecio(e.target.value)}
                  placeholder="0"
                  className="h-11 border-[#e4c9b0] tabular-nums focus-visible:ring-[#f9b44c]"
                />
              </div>
              <div>
                <Label className="text-xs text-[#6f3a2a]">Categoría (opc.)</Label>
                <select
                  value={nuevoCategoria}
                  onChange={(e) => setNuevoCategoria(e.target.value)}
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
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs text-[#6f3a2a]">Unidades que llegaron</Label>
                <Input
                  type="number"
                  min="1"
                  step="1"
                  inputMode="numeric"
                  value={nuevoCantidad}
                  onChange={(e) => setNuevoCantidad(e.target.value)}
                  placeholder="0"
                  className="h-11 border-[#e4c9b0] tabular-nums focus-visible:ring-[#f9b44c]"
                />
              </div>
              <div>
                <Label className="text-xs text-[#6f3a2a]">Vence (opc.)</Label>
                <Input
                  type="date"
                  value={nuevoVenc}
                  onChange={(e) => setNuevoVenc(e.target.value)}
                  className="h-11 border-[#e4c9b0] tabular-nums focus-visible:ring-[#f9b44c]"
                />
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                onClick={() => setModalNuevoAbierto(false)}
                disabled={guardandoNuevo}
                className="flex-1 border-[#e4c9b0] text-[#6f3a2a]"
              >
                Cancelar
              </Button>
              <Button
                type="button"
                onClick={guardarNuevoProducto}
                disabled={guardandoNuevo}
                className="flex-1 bg-[#f9b44c] font-semibold text-[#391511] hover:bg-[#e4a42a]"
              >
                {guardandoNuevo ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Agregando…
                  </>
                ) : (
                  'Agregar al pedido'
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
