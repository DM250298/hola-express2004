'use client'

import { useEffect, useState } from 'react'
import { Ban, Eye, Loader2, Printer, Receipt } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { Skeleton } from '@/components/ui/skeleton'
import { MontoARS } from '@/components/shared/MontoARS'
import { DrawerDetalleVenta } from '@/components/ventas/DrawerDetalleVenta'
import { TicketTermico } from './TicketTermico'
import {
  useAnularVenta,
  useVentaDetalle,
  useVentasListado,
} from '@/lib/hooks/useVentasListado'
import { aVentaCompleta } from '@/lib/queries/ventas-listado'
import { formatearFechaHora, formatearNumero } from '@/lib/utils/formato'
import { cn } from '@/lib/utils'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  turnoId: number
  usuarioId: string
}

export function ModalVentasTurno({
  abierto,
  onCambioAbierto,
  turnoId,
  usuarioId,
}: Props) {
  const { data: ventas, isLoading } = useVentasListado({ turno_id: turnoId })
  const anular = useAnularVenta()
  const [ventaVer, setVentaVer] = useState<number | null>(null)
  const [reimprimirId, setReimprimirId] = useState<number | null>(null)

  // Reimpresión: el ticket original se arma con el payload del cobro, que ya
  // no existe. Se trae el detalle guardado y se rearma la venta para el mismo
  // TicketTermico de siempre (una sola plantilla de ticket en todo el POS).
  const {
    data: detalleReimpresion,
    isError: errorReimpresion,
    isSuccess: llegoReimpresion,
  } = useVentaDetalle(reimprimirId)
  const ventaReimpresion =
    detalleReimpresion && detalleReimpresion.venta.id === reimprimirId
      ? aVentaCompleta(detalleReimpresion)
      : null

  // El ticket tiene que estar en el DOM antes de abrir el diálogo de impresión
  // (el CSS de @media print oculta todo lo demás). Dep primitiva: el objeto se
  // rearma en cada render y dispararía el effect de nuevo.
  useEffect(() => {
    if (!ventaReimpresion) return
    const t = setTimeout(() => {
      window.print()
      setReimprimirId(null)
    }, 80)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ventaReimpresion?.venta.id])

  // Sin detalle (se cortó la red, o la venta ya no está) hay que destrabar el
  // botón: si no, queda girando el spinner y ninguna venta se puede reimprimir.
  useEffect(() => {
    if (reimprimirId === null) return
    if (!errorReimpresion && !(llegoReimpresion && !detalleReimpresion)) return
    toast.error('No se pudo traer la venta para reimprimir el ticket.')
    setReimprimirId(null)
  }, [reimprimirId, errorReimpresion, llegoReimpresion, detalleReimpresion])

  function handleAnular(ventaId: number) {
    if (
      !confirm(
        `¿Anular la venta #${ventaId}?\n\n` +
          'Se devuelve todo el stock al inventario y se revierten los ' +
          'movimientos de cuenta. Esta acción no se puede deshacer.'
      )
    )
      return
    anular.mutate({ ventaId, usuarioId })
  }

  return (
    <>
      <Dialog open={abierto} onOpenChange={onCambioAbierto}>
        <DialogContent className="sm:max-w-xl p-0 gap-0 overflow-hidden max-h-[85vh] flex flex-col">
          <DialogHeader className="px-6 py-4 border-b border-[#e4c9b0]/60 bg-[#fdfaf6] shrink-0">
            <DialogTitle className="text-[#391511] text-lg flex items-center gap-2">
              <Receipt className="h-5 w-5 text-[#f9b44c]" />
              Ventas del turno #{turnoId}
            </DialogTitle>
            <DialogDescription className="text-[#6f3a2a]">
              Revisá tus ventas y anulá las que tengan un error.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-4 py-4">
            {isLoading ? (
              <div className="space-y-2">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton
                    key={i}
                    className="h-14 rounded-xl bg-[#f9d2a2]/30"
                  />
                ))}
              </div>
            ) : !ventas || ventas.length === 0 ? (
              <div className="py-10 text-center text-[#6f3a2a] text-sm">
                Todavía no hay ventas en este turno.
              </div>
            ) : (
              <ul className="space-y-2">
                {ventas.map((v) => {
                  const anulada = v.estado === 'anulada'
                  return (
                    <li
                      key={v.id}
                      className={cn(
                        'flex items-center gap-3 p-3 rounded-xl border',
                        anulada
                          ? 'bg-[#f5f0e8]/60 border-[#e4c9b0]/40'
                          : 'bg-white border-[#e4c9b0]/60'
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-[#6f3a2a]">
                            #{v.id}
                          </span>
                          {anulada && (
                            <span className="text-[9px] uppercase tracking-wider font-bold text-[#c43e2c] bg-[#c43e2c]/10 px-1.5 py-0.5 rounded">
                              Anulada
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-[#6f3a2a] tabular-nums">
                          {/* formatearNumero corta la basura del float: los
                              productos por peso hacían salir "454.29999999" */}
                          {formatearFechaHora(v.fecha)} ·{' '}
                          {formatearNumero(v.cantidad_items)}{' '}
                          {v.cantidad_items === 1 ? 'ítem' : 'ítems'}
                        </div>
                      </div>

                      <span
                        className={cn(
                          'font-bold tabular-nums',
                          anulada
                            ? 'text-[#c8a58a] line-through'
                            : 'text-[#391511]'
                        )}
                      >
                        <MontoARS monto={v.total} />
                      </span>

                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setVentaVer(v.id)}
                        className="h-8 w-8 p-0 text-[#6f3a2a] hover:bg-[#f9d2a2]/40"
                        title="Ver detalle"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </Button>

                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setReimprimirId(v.id)}
                        disabled={anulada || reimprimirId !== null}
                        className="h-8 w-8 p-0 text-[#6f3a2a] hover:bg-[#f9d2a2]/40 disabled:opacity-30"
                        title={
                          anulada
                            ? 'Venta anulada: no se reimprime'
                            : 'Reimprimir ticket'
                        }
                      >
                        {reimprimirId === v.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Printer className="h-3.5 w-3.5" />
                        )}
                      </Button>

                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleAnular(v.id)}
                        disabled={anulada || anular.isPending}
                        className="h-8 px-2 text-[#c43e2c] hover:bg-[#c43e2c]/10 hover:text-[#c43e2c] gap-1 text-xs disabled:opacity-30"
                        title={anulada ? 'Ya anulada' : 'Anular venta'}
                      >
                        {anular.isPending &&
                        anular.variables?.ventaId === v.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Ban className="h-3.5 w-3.5" />
                        )}
                        Anular
                      </Button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <DrawerDetalleVenta
        ventaId={ventaVer}
        onCambioAbierto={(v) => !v && setVentaVer(null)}
      />

      {/* Copia del ticket, fuera de pantalla hasta que se imprime. */}
      {ventaReimpresion && (
        <TicketTermico
          venta={ventaReimpresion}
          vuelto={null}
          nombreCajero={detalleReimpresion?.cajero_nombre ?? '—'}
          copia
        />
      )}
    </>
  )
}
