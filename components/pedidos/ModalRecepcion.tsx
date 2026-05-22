'use client'

import { useEffect, useMemo, useState } from 'react'
import { Calendar, Loader2, PackageCheck } from 'lucide-react'
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
import { useRecibirPedido } from '@/lib/hooks/usePedidos'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { parsearDiasCondicionPago } from '@/lib/queries/pedidos'
import type { PedidoCompleto } from '@/lib/queries/pedidos'
import { formatearFechaCorta, formatearMonto } from '@/lib/utils/formato'
import {
  ModalImprimirEtiquetas,
  type ItemParaEtiqueta,
} from '@/components/recepcion/ModalImprimirEtiquetas'

interface ItemEstado {
  item_id: number
  producto_id: number
  nombre: string
  cantidad_pedida: number
  precio_costo: number
  cantidad_recibida: string
  fecha_vencimiento: string
}

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  pedido: PedidoCompleto
}

export function ModalRecepcion({ abierto, onCambioAbierto, pedido }: Props) {
  const { data: usuario } = useUsuario()
  const recibir = useRecibirPedido()
  const [itemsEstado, setItemsEstado] = useState<ItemEstado[]>([])
  const [itemsParaEtiquetar, setItemsParaEtiquetar] = useState<ItemParaEtiqueta[]>([])
  const [modalEtiquetasAbierto, setModalEtiquetasAbierto] = useState(false)

  useEffect(() => {
    if (abierto) {
      setItemsEstado(
        pedido.items.map((it) => ({
          item_id: it.id,
          producto_id: it.producto_id,
          nombre: it.producto?.nombre ?? 'Producto eliminado',
          cantidad_pedida: it.cantidad_pedida,
          precio_costo: it.precio_costo,
          // Pre-cargar con la cantidad pedida — es lo más común
          cantidad_recibida: String(it.cantidad_pedida),
          fecha_vencimiento: '',
        }))
      )
    }
  }, [abierto, pedido])

  function actualizarItem(
    item_id: number,
    cambios: Partial<Pick<ItemEstado, 'cantidad_recibida' | 'fecha_vencimiento'>>
  ) {
    setItemsEstado((prev) =>
      prev.map((it) => (it.item_id === item_id ? { ...it, ...cambios } : it))
    )
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
    pedido.proveedor_completo?.condicion_pago
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

  function confirmar() {
    if (!usuario || hayErrores) return
    if (!pedido.proveedor) return

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
        onSuccess: () => {
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
                {pedido.proveedor_completo?.condicion_pago ?? 'Contado'}
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

          {/* Items */}
          <ul className="space-y-3">
            {itemsEstado.map((it) => {
              const cantNum = Number(it.cantidad_recibida) || 0
              const diferencia = cantNum - it.cantidad_pedida
              return (
                <li
                  key={it.item_id}
                  className="bg-white border border-[#e4c9b0]/60 rounded-xl p-3 space-y-2"
                >
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-[#391511]">
                        {it.nombre}
                      </div>
                      <div className="text-xs text-[#6f3a2a] mt-0.5">
                        Pedido:{' '}
                        <span className="font-semibold text-[#391511] tabular-nums">
                          {it.cantidad_pedida}
                        </span>{' '}
                        · ${' '}
                        <span className="tabular-nums">
                          {it.precio_costo.toFixed(2)}
                        </span>{' '}
                        c/u
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a]">
                        Subtotal
                      </div>
                      <div className="font-bold text-[#391511] tabular-nums">
                        {formatearMonto(cantNum * it.precio_costo)}
                      </div>
                    </div>
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
                      {diferencia !== 0 && !Number.isNaN(diferencia) && (
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
                      {it.fecha_vencimiento && (
                        <p className="text-[10px] text-[#6f3a2a]">
                          Se creará un lote con esta fecha.
                        </p>
                      )}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>

        <div className="border-t border-[#e4c9b0]/60 bg-[#fdfaf6] px-6 py-3 flex items-center justify-between shrink-0">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
              Total a pagar
            </div>
            <div className="text-2xl font-extrabold text-[#391511] tabular-nums">
              <MontoARS monto={totalRecibido} />
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onCambioAbierto(false)}
              disabled={recibir.isPending}
              className="border-[#e4c9b0] text-[#6f3a2a]"
            >
              Cancelar
            </Button>
            <Button
              onClick={confirmar}
              disabled={recibir.isPending || hayErrores || totalRecibido <= 0}
              className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold"
            >
              {recibir.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Procesando…
                </>
              ) : (
                'Confirmar recepción'
              )}
            </Button>
          </div>
        </div>

        <DialogFooter className="sr-only">
          <span>Acciones</span>
        </DialogFooter>
      </DialogContent>

      <ModalImprimirEtiquetas
        abierto={modalEtiquetasAbierto}
        onCambioAbierto={cerrarTodo}
        items={itemsParaEtiquetar}
      />
    </Dialog>
  )
}
