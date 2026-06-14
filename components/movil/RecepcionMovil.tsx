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
  ShieldCheck,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MontoARS } from '@/components/shared/MontoARS'
import { ModalClaveSupervisor } from '@/components/compras/ModalClaveSupervisor'
import { EscanerCamara } from './EscanerCamara'
import {
  useActualizarEstadoPedido,
  usePedidoDetalle,
  useRecibirPedido,
} from '@/lib/hooks/usePedidos'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { parsearDiasCondicionPago } from '@/lib/queries/pedidos'
import { formatearFechaCorta } from '@/lib/utils/formato'

interface ItemEstado {
  item_id: number
  producto_id: number
  nombre: string
  codigo_barras: string | null
  cantidad_pedida: number
  /** Lo ya recibido en entregas anteriores (acumulado en la DB). */
  ya_recibido: number
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
 * de supervisor si se recibe de más, y registro atómico vía `fn_recibir_pedido`
 * (suma stock, crea lotes y genera la cuenta a pagar provisoria).
 */
export function RecepcionMovil({ pedidoId }: Props) {
  const router = useRouter()
  const { data: usuario } = useUsuario()
  const { data: pedido, isLoading } = usePedidoDetalle(pedidoId)
  const recibir = useRecibirPedido()
  const cambiarEstado = useActualizarEstadoPedido()

  const [itemsEstado, setItemsEstado] = useState<ItemEstado[]>([])
  const [aceptaPorDebajoMin, setAceptaPorDebajoMin] = useState(false)
  const [excesoAutorizado, setExcesoAutorizado] = useState(false)
  const [autorizadoPor, setAutorizadoPor] = useState<string | null>(null)
  const [modalSupervisorAbierto, setModalSupervisorAbierto] = useState(false)
  const cerrarTrasRecepcion = useRef(false)

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
      toast.error('Ese código no pertenece a este pedido.')
      return
    }
    const actual = Number(item.cantidad_recibida) || 0
    actualizarItem(item.item_id, { cantidad_recibida: String(actual + 1) })
    toast.success(`${item.nombre} · ${actual + 1}`)
  }

  const totalRecibido = useMemo(
    () =>
      itemsEstado.reduce((acc, it) => {
        const cant = Number(it.cantidad_recibida) || 0
        return acc + cant * it.precio_costo
      }, 0),
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

  const requiereAceptacion = itemsPorDebajoMinimo.length > 0 && !aceptaPorDebajoMin
  const procesando = recibir.isPending || cambiarEstado.isPending
  const accionDeshabilitada =
    procesando || hayErrores || totalRecibido <= 0 || requiereAceptacion

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
          if (resultado.variaciones && resultado.variaciones.length > 0) {
            const nombres = resultado.variaciones
              .map((v) => {
                const it = itemsEstado.find((i) => i.producto_id === v.producto_id)
                return `${it?.nombre ?? 'Producto'} (+${v.variacion_pct}%)`
              })
              .join(', ')
            toast.warning(`Subas de costo: ${nombres}`, { duration: 8000 })
          }
          router.push('/movil/recepcion')
        },
      }
    )
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
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
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
                {cantNum > 0 && (
                  <span className="shrink-0 text-right">
                    <span className="block text-[10px] uppercase tracking-wider text-[#6f3a2a]">
                      Subtotal
                    </span>
                    <span className="font-bold tabular-nums text-[#391511]">
                      <MontoARS monto={cantNum * it.precio_costo} />
                    </span>
                  </span>
                )}
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
                : 'Total a pagar'}
            </div>
            <div className="text-xl font-extrabold tabular-nums text-[#391511]">
              <MontoARS monto={totalRecibido} />
            </div>
          </div>
          {esParcial && totalRecibido > 0 ? (
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
    </div>
  )
}
