'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  Calendar,
  Check,
  ChevronLeft,
  ClipboardList,
  CreditCard,
  PackageCheck,
  Pencil,
  Send,
  Truck,
  X,
} from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { BadgeEstadoPedido } from '@/components/shared/BadgeEstadoPedido'
import { MontoARS } from '@/components/shared/MontoARS'
import {
  usePedidoDetalle,
  useActualizarEstadoPedido,
} from '@/lib/hooks/usePedidos'
import { formatearFechaCorta } from '@/lib/utils/formato'
import { ModalRecepcion } from './ModalRecepcion'

interface Props {
  pedidoId: number
}

export function DetallePedido({ pedidoId }: Props) {
  const { data: pedido, isLoading, isError } = usePedidoDetalle(pedidoId)
  const cambiarEstado = useActualizarEstadoPedido()
  const [modalRecepcionAbierto, setModalRecepcionAbierto] = useState(false)

  if (isLoading) {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-4">
        <Skeleton className="h-6 w-32 bg-[#f9d2a2]/30" />
        <Skeleton className="h-32 rounded-2xl bg-[#f9d2a2]/30" />
        <Skeleton className="h-48 rounded-2xl bg-[#f9d2a2]/30" />
      </div>
    )
  }

  if (isError || !pedido) {
    return (
      <div className="p-12 text-center">
        <ClipboardList className="h-10 w-10 text-[#c8a58a] mx-auto mb-3" />
        <p className="text-[#391511] font-semibold">Pedido no encontrado</p>
        <Link
          href="/compras"
          className="text-[#c43e2c] text-sm hover:underline mt-1 inline-block"
        >
          Volver a compras
        </Link>
      </div>
    )
  }

  const totalRecibido = pedido.items.reduce(
    (acc, it) => acc + (it.cantidad_recibida ?? 0) * it.precio_costo,
    0
  )
  // En 'recibido' y 'recepcion_parcial' mostramos lo efectivamente recibido
  // (que es lo que se debe), no el total pedido original.
  const mostrarRecibido =
    pedido.estado === 'recibido' || pedido.estado === 'recepcion_parcial'

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-5">
      {/* Breadcrumb */}
      <div>
        <Link
          href="/compras"
          className="inline-flex items-center gap-1 text-sm text-[#6f3a2a] hover:text-[#391511] transition-colors"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Compras
        </Link>
      </div>

      {/* Header */}
      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-[#391511] text-2xl font-bold">
                Pedido #{pedido.id}
              </h1>
              <BadgeEstadoPedido estado={pedido.estado} size="md" />
            </div>
            <p className="text-[#6f3a2a] text-sm">
              {pedido.proveedor?.nombre ?? 'Proveedor eliminado'}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {(pedido.estado === 'borrador' || pedido.estado === 'enviado') && (
              <Link
                href={`/pedidos/${pedido.id}/editar`}
                className={cn(
                  buttonVariants({ variant: 'outline' }),
                  'border-[#e4c9b0] text-[#6f3a2a] hover:bg-[#fdfaf6] gap-1.5'
                )}
              >
                <Pencil className="h-4 w-4" />
                Editar
              </Link>
            )}
            {pedido.estado === 'borrador' && (
              <Button
                onClick={() =>
                  cambiarEstado.mutate({ id: pedido.id, estado: 'enviado' })
                }
                disabled={cambiarEstado.isPending}
                className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5"
              >
                <Send className="h-4 w-4" />
                Marcar como enviado
              </Button>
            )}
            {(pedido.estado === 'enviado' ||
              pedido.estado === 'recepcion_parcial') && (
              <Button
                onClick={() => setModalRecepcionAbierto(true)}
                className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5"
              >
                <PackageCheck className="h-4 w-4" />
                {pedido.estado === 'recepcion_parcial'
                  ? 'Recibir faltante'
                  : 'Registrar recepción'}
              </Button>
            )}
            {pedido.estado === 'recepcion_parcial' && (
              <Button
                variant="outline"
                onClick={() =>
                  cambiarEstado.mutate({ id: pedido.id, estado: 'recibido' })
                }
                disabled={cambiarEstado.isPending}
                className="border-[#6f3a2a]/30 text-[#6f3a2a] hover:bg-[#6f3a2a]/10 hover:text-[#391511] gap-1.5"
              >
                <Check className="h-4 w-4" />
                Cerrar recepción
              </Button>
            )}
            {(pedido.estado === 'borrador' || pedido.estado === 'enviado') && (
              <Button
                variant="outline"
                onClick={() =>
                  cambiarEstado.mutate({ id: pedido.id, estado: 'cancelado' })
                }
                disabled={cambiarEstado.isPending}
                className="border-[#c43e2c]/30 text-[#c43e2c] hover:bg-[#c43e2c]/10 hover:text-[#c43e2c] gap-1.5"
              >
                <X className="h-4 w-4" />
                Cancelar
              </Button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-4 border-t border-[#e4c9b0]/60 text-sm">
          <Stat
            icono={Calendar}
            etiqueta="Fecha pedido"
            valor={formatearFechaCorta(pedido.fecha_pedido)}
          />
          <Stat
            icono={Truck}
            etiqueta="Entrega esperada"
            valor={
              pedido.fecha_entrega_esperada
                ? formatearFechaCorta(pedido.fecha_entrega_esperada)
                : '—'
            }
          />
          <Stat
            icono={CreditCard}
            etiqueta="Condición pago"
            valor={
              pedido.terminos_pago ??
              pedido.proveedor_completo?.condicion_pago ??
              '—'
            }
          />
          <Stat
            icono={Truck}
            etiqueta="Contacto"
            valor={
              pedido.proveedor_completo?.telefono ??
              pedido.proveedor_completo?.email ??
              '—'
            }
          />
        </div>
      </div>

      {/* Items */}
      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden shadow-sm">
        <div className="px-5 py-4 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <h2 className="text-[#391511] font-bold">Productos del pedido</h2>
        </div>

        {pedido.items.length === 0 ? (
          <div className="p-8 text-center text-[#6f3a2a] text-sm">
            El pedido no tiene productos.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-b-[#e4c9b0]/60 bg-[#fdfaf6] hover:bg-[#fdfaf6]">
                  <TableHead className="text-[#391511] font-semibold">
                    Producto
                  </TableHead>
                  <TableHead className="text-right text-[#391511] font-semibold">
                    Cant. pedida
                  </TableHead>
                  <TableHead className="text-right text-[#391511] font-semibold">
                    Cant. recibida
                  </TableHead>
                  <TableHead className="text-right text-[#391511] font-semibold">
                    Precio costo
                  </TableHead>
                  <TableHead className="text-right text-[#391511] font-semibold">
                    Subtotal
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pedido.items.map((it) => {
                  const cantUsada = it.cantidad_recibida ?? it.cantidad_pedida
                  return (
                    <TableRow
                      key={it.id}
                      className="border-b-[#e4c9b0]/40 hover:bg-[#fdfaf6]"
                    >
                      <TableCell>
                        <div className="font-medium text-[#391511]">
                          {it.producto?.nombre ?? 'Producto eliminado'}
                        </div>
                        {it.producto?.codigo_barras && (
                          <div className="text-xs text-[#c8a58a] font-mono mt-0.5">
                            {it.producto.codigo_barras}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-[#6f3a2a]">
                        {it.cantidad_pedida}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {it.cantidad_recibida != null ? (
                          <span
                            className={
                              it.cantidad_recibida === it.cantidad_pedida
                                ? 'text-[#391511] font-semibold'
                                : 'text-[#c43e2c] font-semibold'
                            }
                          >
                            {it.cantidad_recibida}
                          </span>
                        ) : (
                          <span className="text-[#c8a58a]">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-[#6f3a2a]">
                        <MontoARS monto={it.precio_costo} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-semibold text-[#391511]">
                        <MontoARS monto={cantUsada * it.precio_costo} />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="px-5 py-3 border-t border-[#e4c9b0]/60 bg-[#fdfaf6] flex items-baseline justify-between">
          <span className="text-[#6f3a2a] text-sm font-medium uppercase tracking-wider">
            {mostrarRecibido ? 'Total recibido' : 'Total pedido'}
          </span>
          <span className="text-[#391511] text-2xl font-extrabold tabular-nums">
            <MontoARS monto={mostrarRecibido ? totalRecibido : pedido.total} />
          </span>
        </div>
      </div>

      {(pedido.estado === 'enviado' ||
        pedido.estado === 'recepcion_parcial') && (
        <ModalRecepcion
          abierto={modalRecepcionAbierto}
          onCambioAbierto={setModalRecepcionAbierto}
          pedido={pedido}
        />
      )}
    </div>
  )
}

function Stat({
  icono: Icono,
  etiqueta,
  valor,
}: {
  icono: React.ElementType
  etiqueta: string
  valor: string
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold flex items-center gap-1">
        <Icono className="h-3 w-3" />
        {etiqueta}
      </div>
      <div className="text-[#391511] font-semibold mt-0.5 tabular-nums truncate">
        {valor}
      </div>
    </div>
  )
}
