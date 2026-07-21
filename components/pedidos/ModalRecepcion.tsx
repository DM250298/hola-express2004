'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Calendar,
  Loader2,
  PackageCheck,
  Plus,
  ScanLine,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { MontoARS } from '@/components/shared/MontoARS'
import { ModalClaveSupervisor } from '@/components/compras/ModalClaveSupervisor'
import { GaleriaComprobantes } from '@/components/compras/GaleriaComprobantes'
import { DrawerProducto } from '@/components/configuracion/productos/DrawerProducto'
import { useActualizarEstadoPedido, useRecibirPedido } from '@/lib/hooks/usePedidos'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { tienePermiso } from '@/lib/permisos'
import { agregarItemPedido, parsearDiasCondicionPago } from '@/lib/queries/pedidos'
import type { PedidoCompleto } from '@/lib/queries/pedidos'
import type { ProductoRow } from '@/types/database'
import { formatearFechaCorta, formatearMonto } from '@/lib/utils/formato'
import {
  ModalImprimirEtiquetas,
  type ItemParaEtiqueta,
} from '@/components/recepcion/ModalImprimirEtiquetas'

interface ItemEstado {
  item_id: number
  producto_id: number
  nombre: string
  codigo_barras: string | null
  cantidad_pedida: number
  /** Lo ya recibido en entregas anteriores (acumulado en la DB). */
  ya_recibido: number
  precio_costo: number
  /** Lo que se recibe en ESTA entrega (se suma a `ya_recibido`). */
  cantidad_recibida: string
  fecha_vencimiento: string
  dias_vencimiento_minimo: number | null
  /** Producto agregado al vuelo (no estaba en la orden): se exime del control
   *  de exceso vs. lo pedido. */
  no_pedido?: boolean
}

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  pedido: PedidoCompleto
}

export function ModalRecepcion({ abierto, onCambioAbierto, pedido }: Props) {
  const { data: usuario } = useUsuario()
  // El mostrador (cajero/fiambrero) no ve costos: se ocultan los importes de
  // costo de la recepción aunque el dato exista para calcular el stock.
  const puedeVerCosto = tienePermiso(usuario?.permisos, 'costos')
  const recibir = useRecibirPedido()
  const cambiarEstado = useActualizarEstadoPedido()
  // Recuerda si el operador eligió "cerrar pedido" mientras se valida el
  // supervisor (el flujo de exceso pasa por el modal de clave).
  const cerrarTrasRecepcion = useRef(false)
  const [itemsEstado, setItemsEstado] = useState<ItemEstado[]>([])
  const [itemsParaEtiquetar, setItemsParaEtiquetar] = useState<ItemParaEtiqueta[]>([])
  const [modalEtiquetasAbierto, setModalEtiquetasAbierto] = useState(false)
  // Alta al vuelo de un producto que llegó y no estaba en la orden.
  const [nuevoProductoAbierto, setNuevoProductoAbierto] = useState(false)
  const [agregandoNoPedido, setAgregandoNoPedido] = useState(false)

  const [aceptaPorDebajoMin, setAceptaPorDebajoMin] = useState(false)

  // Escaneo guiado
  const [codigoScan, setCodigoScan] = useState('')
  const refScan = useRef<HTMLInputElement>(null)

  // Autorización de supervisor para recibir más de lo pedido
  const [excesoAutorizado, setExcesoAutorizado] = useState(false)
  const [autorizadoPor, setAutorizadoPor] = useState<string | null>(null)
  const [modalSupervisorAbierto, setModalSupervisorAbierto] = useState(false)

  useEffect(() => {
    if (abierto) {
      setItemsEstado(
        pedido.items.map((it) => {
          const yaRecibido = it.cantidad_recibida ?? 0
          return {
            item_id: it.id,
            producto_id: it.producto_id,
            nombre: it.producto?.nombre ?? 'Producto eliminado',
            codigo_barras: it.producto?.codigo_barras ?? null,
            cantidad_pedida: it.cantidad_pedida,
            ya_recibido: yaRecibido,
            precio_costo: it.precio_costo,
            // Arranca vacío: el operador ingresa o escanea lo que realmente
            // bajó del camión (evita confirmar de más por inercia).
            cantidad_recibida: '',
            fecha_vencimiento: '',
            dias_vencimiento_minimo:
              it.producto?.dias_vencimiento_minimo ?? null,
          }
        })
      )
      setAceptaPorDebajoMin(false)
      setExcesoAutorizado(false)
      setAutorizadoPor(null)
      setCodigoScan('')
    }
  }, [abierto, pedido])

  /** Escaneo: suma 1 a la cantidad recibida del producto con ese código. */
  function procesarScan(codigo: string) {
    const cod = codigo.trim()
    if (!cod) return
    const item = itemsEstado.find((it) => it.codigo_barras === cod)
    setCodigoScan('')
    refScan.current?.focus()
    if (!item) {
      toast.error('Ese código no pertenece a este pedido.')
      return
    }
    const actual = Number(item.cantidad_recibida) || 0
    actualizarItem(item.item_id, { cantidad_recibida: String(actual + 1) })
    toast.success(`${item.nombre} · ${actual + 1}`)
  }

  function actualizarItem(
    item_id: number,
    cambios: Partial<Pick<ItemEstado, 'cantidad_recibida' | 'fecha_vencimiento'>>
  ) {
    setItemsEstado((prev) =>
      prev.map((it) => (it.item_id === item_id ? { ...it, ...cambios } : it))
    )
  }

  /**
   * Suma a la recepción un producto que llegó y no estaba en la orden. Se crea
   * una línea en el pedido (cantidad pedida = 1 como placeholder, la real es la
   * recibida) y se marca `no_pedido` para eximirla del control de exceso.
   */
  async function agregarProductoNoPedido(prod: ProductoRow) {
    setNuevoProductoAbierto(false)
    if (itemsEstado.some((it) => it.producto_id === prod.id)) {
      toast.info(`${prod.nombre} ya está en la lista.`)
      return
    }
    setAgregandoNoPedido(true)
    try {
      const nuevoItem = await agregarItemPedido({
        pedido_id: pedido.id,
        producto_id: prod.id,
        cantidad: 1,
        precio_costo: prod.precio_costo ?? 0,
      })
      setItemsEstado((prev) => [
        ...prev,
        {
          item_id: nuevoItem.id,
          producto_id: prod.id,
          nombre: prod.nombre,
          codigo_barras: prod.codigo_barras,
          cantidad_pedida: Number(nuevoItem.cantidad_pedida) || 1,
          ya_recibido: 0,
          precio_costo: prod.precio_costo ?? 0,
          cantidad_recibida: '',
          fecha_vencimiento: '',
          dias_vencimiento_minimo: prod.dias_vencimiento_minimo ?? null,
          no_pedido: true,
        },
      ])
      toast.success(`${prod.nombre} agregado a la recepción`)
    } catch (e) {
      toast.error(
        `No se pudo agregar: ${e instanceof Error ? e.message : 'error'}`
      )
    } finally {
      setAgregandoNoPedido(false)
    }
  }

  const totalRecibido = useMemo(
    () =>
      itemsEstado.reduce((acc, it) => {
        const cant = Number(it.cantidad_recibida) || 0
        return acc + cant * it.precio_costo
      }, 0),
    [itemsEstado]
  )

  // Los términos de pago de la ORDEN mandan; si la orden no los tiene, cae a
  // la condición de pago del proveedor (comportamiento previo).
  const condicionPagoTexto =
    pedido.terminos_pago ?? pedido.proveedor_completo?.condicion_pago ?? null
  const condicionDias = parsearDiasCondicionPago(condicionPagoTexto)
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

  /** Items donde el ACUMULADO supera lo pedido (requiere supervisor). */
  const itemsConExceso = useMemo(
    () =>
      itemsEstado.filter(
        (it) =>
          !it.no_pedido &&
          it.ya_recibido + (Number(it.cantidad_recibida) || 0) >
            it.cantidad_pedida
      ),
    [itemsEstado]
  )
  const hayExceso = itemsConExceso.length > 0
  const requiereSupervisor = hayExceso && !excesoAutorizado

  /** ¿Hay alguna entrega previa? (recepción sucesiva sobre un parcial) */
  const hayRecepcionPrevia = useMemo(
    () => itemsEstado.some((it) => it.ya_recibido > 0),
    [itemsEstado]
  )

  /** ¿Queda faltante tras esta entrega? (acumulado < lo pedido en total) */
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

  /** Items que tienen fecha de vencimiento por debajo del mínimo configurado. */
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

  const hayPorDebajoMinimo = itemsPorDebajoMinimo.length > 0
  const requiereAceptacion = hayPorDebajoMinimo && !aceptaPorDebajoMin

  const procesando = recibir.isPending || cambiarEstado.isPending
  const accionDeshabilitada =
    procesando || hayErrores || totalRecibido <= 0 || requiereAceptacion

  function confirmar(cerrarPedido: boolean) {
    if (!usuario || hayErrores) return
    if (!pedido.proveedor) return

    cerrarTrasRecepcion.current = cerrarPedido

    // Recibir más de lo pedido exige autorización de un supervisor
    if (requiereSupervisor) {
      setModalSupervisorAbierto(true)
      return
    }

    ejecutarRecepcion(cerrarPedido)
  }

  function ejecutarRecepcion(cerrarPedido: boolean) {
    if (!usuario || !pedido.proveedor) return

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
          // Si eligió cerrar y la recepción quedó parcial, forzamos el pedido
          // a 'recibido' (el proveedor no trae el faltante). La deuda ya quedó
          // con lo efectivamente recibido.
          if (cerrarPedido && resultado.es_parcial) {
            cambiarEstado.mutate({ id: pedido.id, estado: 'recibido' })
          }
          // Alertar variaciones de costo por encima del umbral configurado
          if (resultado.variaciones && resultado.variaciones.length > 0) {
            const nombres = resultado.variaciones
              .map((v) => {
                const it = itemsEstado.find(
                  (i) => i.producto_id === v.producto_id
                )
                return `${it?.nombre ?? 'Producto'} (+${v.variacion_pct}%)`
              })
              .join(', ')
            toast.warning(
              `Subas de costo detectadas: ${nombres}. Revisá si conviene remarcar el precio (pestaña Costos).`,
              { duration: 8000 }
            )
          }
          // Recolectar items con fecha de vencimiento — son los que pueden
          // imprimir etiqueta. Productos sin vencimiento no se etiquetan.
          const conVencimiento: ItemParaEtiqueta[] = itemsEstado
            .filter((it) => {
              if (!it.fecha_vencimiento) return false
              const cant = Math.max(0, Number(it.cantidad_recibida) || 0)
              return cant > 0
            })
            .map((it) => ({
              producto_id: it.producto_id,
              producto_nombre: it.nombre,
              codigo_barras:
                pedido.items.find((p) => p.id === it.item_id)?.producto
                  ?.codigo_barras ?? null,
              fecha_vencimiento: it.fecha_vencimiento,
              cantidad_recibida: Math.max(0, Number(it.cantidad_recibida) || 0),
            }))

          if (conVencimiento.length > 0) {
            setItemsParaEtiquetar(conVencimiento)
            setModalEtiquetasAbierto(true)
            // No cerramos el modal de recepción todavía — queda atrás del de
            // etiquetas. Cuando se cierre el de etiquetas, cerramos los dos.
          } else {
            onCambioAbierto(false)
          }
        },
      }
    )
  }

  function cerrarTodo(v: boolean) {
    setModalEtiquetasAbierto(v)
    if (!v) {
      // Al cerrar el modal de etiquetas, también cerramos el de recepción
      onCambioAbierto(false)
    }
  }

  return (
    <Dialog
      open={abierto}
      onOpenChange={(v) => !recibir.isPending && onCambioAbierto(v)}
    >
      <DialogContent className="sm:max-w-3xl p-0 gap-0 overflow-hidden max-h-[90vh] flex flex-col">
        <DialogHeader className="px-6 py-4 border-b border-[#e4c9b0]/60 bg-[#fdfaf6] shrink-0">
          <DialogTitle className="text-[#391511] text-lg flex items-center gap-2">
            <PackageCheck className="h-5 w-5 text-[#f9b44c]" />
            Registrar recepción · Pedido #{pedido.id}
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            Confirmá las cantidades recibidas. Opcionalmente cargá fecha de
            vencimiento para crear un lote.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Resumen del pedido */}
          <div className="bg-[#fdfaf6] border border-[#e4c9b0]/60 rounded-xl p-3 grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                Proveedor
              </div>
              <div className="font-semibold text-[#391511] truncate">
                {pedido.proveedor?.nombre ?? '—'}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                Condición de pago
              </div>
              <div className="font-semibold text-[#391511]">
                {condicionPagoTexto ?? 'Contado'}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                Cuenta vencerá el
              </div>
              <div className="font-semibold text-[#391511] tabular-nums">
                {formatearFechaCorta(fechaVencimientoCuenta)}
              </div>
            </div>
          </div>

          {/* Escaneo guiado */}
          <div className="bg-[#f9b44c]/8 border border-[#f9b44c]/40 rounded-xl p-3">
            <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold flex items-center gap-1 mb-1.5">
              <ScanLine className="h-3.5 w-3.5 text-[#f9b44c]" />
              Escaneá los productos que bajan del camión
            </Label>
            <Input
              ref={refScan}
              value={codigoScan}
              onChange={(e) => setCodigoScan(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  procesarScan(codigoScan)
                }
              }}
              placeholder="Escaneá o escribí el código de barras y Enter…"
              disabled={recibir.isPending}
              className="h-10 border-[#e4c9b0] focus-visible:ring-[#f9b44c] bg-white font-mono"
            />
            <p className="text-[10px] text-[#6f3a2a] mt-1">
              Cada escaneo suma 1 unidad al producto correspondiente. También
              podés ajustar las cantidades a mano abajo.
            </p>
          </div>

          {/* Comprobante: escanear/subir foto de la factura o el remito */}
          <GaleriaComprobantes
            pedidoId={pedido.id}
            usuarioId={usuario?.id ?? null}
          />

          {/* Aviso de autorización de supervisor concedida */}
          {excesoAutorizado && autorizadoPor && (
            <div className="flex items-center gap-2 text-xs text-[#2f7d4f] bg-[#2f7d4f]/10 border border-[#2f7d4f]/30 rounded-lg px-3 py-2">
              <ShieldCheck className="h-4 w-4 shrink-0" />
              Exceso de cantidad autorizado por{' '}
              <span className="font-semibold">{autorizadoPor}</span>.
            </div>
          )}

          {/* Agregar un producto que llegó y no estaba en la orden */}
          <button
            type="button"
            onClick={() => setNuevoProductoAbierto(true)}
            disabled={recibir.isPending || agregandoNoPedido}
            className="w-full flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[#e4c9b0] bg-white px-3 py-2.5 text-sm font-medium text-[#9e6b15] transition-colors hover:border-[#f9b44c] hover:bg-[#f9b44c]/8 disabled:opacity-50"
          >
            {agregandoNoPedido ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Agregar producto que no estaba en la orden
          </button>

          {/* Items */}
          <ul className="space-y-3">
            {itemsEstado.map((it) => {
              const cantNum = Number(it.cantidad_recibida) || 0
              // La diferencia se mide sobre el acumulado (ya recibido + ahora)
              const diferencia = it.ya_recibido + cantNum - it.cantidad_pedida
              const min = it.dias_vencimiento_minimo
              let diasReales: number | null = null
              let debajoMinimo = false
              if (min != null && it.fecha_vencimiento && cantNum > 0) {
                const hoy = new Date()
                hoy.setHours(0, 0, 0, 0)
                const venc = new Date(`${it.fecha_vencimiento}T00:00:00`)
                diasReales = Math.floor(
                  (venc.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24)
                )
                debajoMinimo = diasReales < min
              }
              return (
                <li
                  key={it.item_id}
                  className={
                    debajoMinimo
                      ? 'bg-white border-2 border-[#c43e2c]/60 rounded-xl p-3 space-y-2'
                      : 'bg-white border border-[#e4c9b0]/60 rounded-xl p-3 space-y-2'
                  }
                >
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-[#391511] flex items-center gap-2 flex-wrap">
                        {it.nombre}
                        {it.no_pedido && (
                          <span className="text-[9px] uppercase tracking-wider font-semibold text-[#9e6b15] bg-[#f9b44c]/20 rounded-full px-1.5 py-0.5">
                            Extra (no pedido)
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-[#6f3a2a] mt-0.5">
                        {it.no_pedido ? (
                          <>Llegó sin estar en la orden</>
                        ) : (
                          <>
                            Pedido:{' '}
                            <span className="font-semibold text-[#391511] tabular-nums">
                              {it.cantidad_pedida}
                            </span>
                            {puedeVerCosto && (
                              <>
                                {' '}
                                · ${' '}
                                <span className="tabular-nums">
                                  {it.precio_costo.toFixed(2)}
                                </span>{' '}
                                c/u
                              </>
                            )}
                          </>
                        )}
                      </div>
                      {it.ya_recibido > 0 && (
                        <div className="text-[11px] text-[#9e6b15] mt-0.5">
                          Ya recibido:{' '}
                          <span className="font-semibold tabular-nums">
                            {it.ya_recibido}
                          </span>{' '}
                          · Falta:{' '}
                          <span className="font-semibold tabular-nums">
                            {Math.max(0, it.cantidad_pedida - it.ya_recibido)}
                          </span>
                        </div>
                      )}
                    </div>
                    {puedeVerCosto && (
                      <div className="text-right">
                        <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a]">
                          Subtotal
                        </div>
                        <div className="font-bold text-[#391511] tabular-nums">
                          {formatearMonto(cantNum * it.precio_costo)}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a]">
                        Cantidad recibida
                      </Label>
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        value={it.cantidad_recibida}
                        onChange={(e) =>
                          actualizarItem(it.item_id, {
                            cantidad_recibida: e.target.value,
                          })
                        }
                        disabled={recibir.isPending}
                        className="h-10 tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
                      />
                      {!it.no_pedido &&
                        diferencia !== 0 &&
                        !Number.isNaN(diferencia) && (
                          <p
                            className={
                              diferencia > 0
                                ? 'text-[10px] text-[#6f3a2a]'
                                : 'text-[10px] text-[#c43e2c]'
                            }
                          >
                            {diferencia > 0 ? '+' : ''}
                            {diferencia} vs. lo pedido
                          </p>
                        )}
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        Fecha vencimiento (opc.)
                      </Label>
                      <Input
                        type="date"
                        value={it.fecha_vencimiento}
                        onChange={(e) =>
                          actualizarItem(it.item_id, {
                            fecha_vencimiento: e.target.value,
                          })
                        }
                        disabled={recibir.isPending}
                        className="h-10 tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
                      />
                      {it.fecha_vencimiento && !debajoMinimo && (
                        <p className="text-[10px] text-[#6f3a2a]">
                          Se creará un lote con esta fecha.
                          {min != null &&
                            diasReales != null &&
                            ` Vence en ${diasReales} día${
                              diasReales === 1 ? '' : 's'
                            } (mín ${min}).`}
                        </p>
                      )}
                      {debajoMinimo && diasReales != null && min != null && (
                        <p className="text-[11px] text-[#c43e2c] font-semibold flex items-start gap-1">
                          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                          Vence en {diasReales} día
                          {diasReales === 1 ? '' : 's'}, por debajo del mínimo
                          ({min}).
                        </p>
                      )}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>

          {/* Cartel global de aceptación si hay items por debajo del mínimo */}
          {hayPorDebajoMinimo && (
            <div className="bg-[#c43e2c]/10 border-2 border-[#c43e2c]/40 rounded-xl p-4 space-y-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-5 w-5 text-[#c43e2c] shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-[#c43e2c] font-bold text-sm">
                    Mercadería con vencimiento por debajo del mínimo
                  </p>
                  <p className="text-[#391511] text-xs mt-1">
                    {itemsPorDebajoMinimo.length} producto
                    {itemsPorDebajoMinimo.length === 1 ? '' : 's'} con menos
                    días de los configurados. Si la aceptás igual, se va a
                    registrar el lote.
                  </p>
                  <ul className="text-[11px] text-[#6f3a2a] mt-2 list-disc pl-4 space-y-0.5">
                    {itemsPorDebajoMinimo.map((it) => (
                      <li key={it.item_id}>
                        <strong>{it.nombre}</strong> · vence en{' '}
                        {it.diasReales} d (mín {it.diasMinimo})
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <label className="flex items-center gap-2 pt-1 text-sm text-[#391511] font-medium cursor-pointer">
                <input
                  type="checkbox"
                  checked={aceptaPorDebajoMin}
                  onChange={(e) => setAceptaPorDebajoMin(e.target.checked)}
                  className="h-4 w-4 accent-[#c43e2c]"
                />
                Acepto recibir esta mercadería igual
              </label>
            </div>
          )}
        </div>

        <div className="border-t border-[#e4c9b0]/60 bg-[#fdfaf6] px-6 py-3 flex items-center justify-between shrink-0">
          <div>
            {puedeVerCosto && (
              <>
                <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                  {hayRecepcionPrevia ? 'Total de esta entrega' : 'Total a pagar'}
                </div>
                <div className="text-2xl font-extrabold text-[#391511] tabular-nums">
                  <MontoARS monto={totalRecibido} />
                </div>
              </>
            )}
            {esParcial && totalRecibido > 0 && (
              <p className="text-[11px] text-[#9e6b15] font-medium mt-0.5">
                Estás recibiendo menos de lo pedido: elegí cerrar el pedido o
                dejar el faltante pendiente.
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onCambioAbierto(false)}
              disabled={procesando}
              className="border-[#e4c9b0] text-[#6f3a2a]"
            >
              Cancelar
            </Button>
            {esParcial && totalRecibido > 0 ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => confirmar(false)}
                  disabled={accionDeshabilitada}
                  className="border-[#e4a42a]/60 text-[#9e6b15] hover:bg-[#e4a42a]/10 hover:text-[#9e6b15]"
                >
                  {procesando ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Procesando…
                    </>
                  ) : (
                    'Guardar parcial'
                  )}
                </Button>
                <Button
                  type="button"
                  onClick={() => confirmar(true)}
                  disabled={accionDeshabilitada}
                  className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold"
                >
                  Cerrar pedido
                </Button>
              </>
            ) : (
              <Button
                type="button"
                onClick={() => confirmar(false)}
                disabled={accionDeshabilitada}
                className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold"
              >
                {procesando ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Procesando…
                  </>
                ) : (
                  'Confirmar recepción'
                )}
              </Button>
            )}
          </div>
        </div>

        <DialogFooter className="sr-only">
          <span>Acciones</span>
        </DialogFooter>
      </DialogContent>

      <DrawerProducto
        abierto={nuevoProductoAbierto}
        onCambioAbierto={setNuevoProductoAbierto}
        producto={null}
        proveedorIdInicial={pedido.proveedor?.id ?? null}
        onCreado={agregarProductoNoPedido}
      />

      <ModalImprimirEtiquetas
        abierto={modalEtiquetasAbierto}
        onCambioAbierto={cerrarTodo}
        items={itemsParaEtiquetar}
      />

      <ModalClaveSupervisor
        abierto={modalSupervisorAbierto}
        onCambioAbierto={setModalSupervisorAbierto}
        motivo={`Se está recibiendo más cantidad de la pedida en ${itemsConExceso.length} producto(s). Un encargado debe autorizarlo.`}
        onAutorizado={(nombre) => {
          setExcesoAutorizado(true)
          setAutorizadoPor(nombre)
          // Ya autorizado: ejecutar directamente, sin re-chequear supervisor,
          // respetando si el operador eligió cerrar el pedido.
          ejecutarRecepcion(cerrarTrasRecepcion.current)
        }}
      />
    </Dialog>
  )
}
