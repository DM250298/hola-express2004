'use client'

import { Check, Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog'
import { MontoARS } from '@/components/shared/MontoARS'
import { TicketTermico } from './TicketTermico'
import { formatearFechaHora } from '@/lib/utils/formato'
import { useMediosPago } from '@/lib/hooks/useMediosPago'
import { etiquetaMedioFallback } from '@/lib/utils/iconosMedioPago'
import type { VentaCompleta } from '@/lib/queries/ventas'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  venta: VentaCompleta | null
  vuelto: number | null
  /** Nombre del cajero que registró la venta — se imprime en el ticket. */
  nombreCajero: string
}

export function TicketResumen({
  abierto,
  onCambioAbierto,
  venta,
  vuelto,
  nombreCajero,
}: Props) {
  const { data: medios } = useMediosPago()

  if (!venta) return null

  function etiquetaMedio(codigo: string): string {
    return (
      (medios ?? []).find((m) => m.codigo === codigo)?.nombre ??
      etiquetaMedioFallback(codigo)
    )
  }

  function imprimir() {
    window.print()
  }

  return (
    <>
      {/* Ticket térmico oculto — se vuelve visible al imprimir (80mm). */}
      {abierto && (
        <TicketTermico
          venta={venta}
          vuelto={vuelto}
          nombreCajero={nombreCajero}
        />
      )}

      <Dialog open={abierto} onOpenChange={onCambioAbierto}>
        <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
        <DialogTitle className="sr-only">Ticket de venta</DialogTitle>

        {/* Header de confirmación */}
        <div className="bg-[#f9b44c] px-6 py-5 text-center">
          <div className="inline-flex p-2 rounded-full bg-[#391511]/15 mb-1">
            <Check className="h-6 w-6 text-[#391511]" strokeWidth={3} />
          </div>
          <h2 className="text-[#391511] text-xl font-extrabold">
            {venta.pendiente ? 'Venta guardada' : '¡Venta registrada!'}
          </h2>
          <p className="text-[#391511]/70 text-xs">
            {venta.pendiente
              ? 'Sin conexión — se sincronizará al volver internet'
              : `Ticket #${venta.venta.id}`}
          </p>
        </div>

        {/* Cuerpo del ticket */}
        <div className="px-6 py-5 space-y-4 bg-white">
          <div className="text-center pb-3 border-b border-dashed border-[#e4c9b0]">
            <p className="text-[#391511] font-extrabold text-lg">
              ¡Hola! Express
            </p>
            <p className="text-[#6f3a2a] text-[10px]">
              {formatearFechaHora(venta.venta.fecha)}
            </p>
          </div>

          <ul className="space-y-1.5 text-sm">
            {venta.items.map((it) => (
              <li
                key={it.producto_id}
                className="flex items-baseline gap-2"
              >
                <span className="text-[#6f3a2a] tabular-nums shrink-0 w-8">
                  {it.cantidad}×
                </span>
                <span className="text-[#391511] flex-1 truncate">
                  {it.nombre}
                </span>
                <span className="text-[#391511] font-medium tabular-nums">
                  <MontoARS monto={it.subtotal} />
                </span>
              </li>
            ))}
          </ul>

          <div className="border-t border-dashed border-[#e4c9b0] pt-3 space-y-1">
            <div className="flex justify-between items-baseline">
              <span className="text-[#391511] font-extrabold uppercase">
                Total
              </span>
              <span className="text-[#391511] text-2xl font-extrabold tabular-nums">
                <MontoARS monto={venta.total} />
              </span>
            </div>

            {/* Pagos — uno o varios según split payment */}
            <div className="pt-1">
              <div className="text-[10px] text-[#6f3a2a] uppercase tracking-wider mb-0.5">
                {venta.pagos.length === 1 ? 'Forma de pago' : 'Pagos'}
              </div>
              <ul className="space-y-0.5">
                {venta.pagos.map((p, i) => (
                  <li
                    key={i}
                    className="flex justify-between text-xs"
                  >
                    <span className="text-[#6f3a2a]">
                      {etiquetaMedio(p.medio_pago)}
                    </span>
                    <span className="text-[#391511] font-medium tabular-nums">
                      <MontoARS monto={p.monto} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {vuelto != null && vuelto > 0 && (
              <div className="flex justify-between text-sm pt-1 border-t border-dashed border-[#e4c9b0]/40">
                <span className="text-[#6f3a2a] font-semibold uppercase">
                  Vuelto
                </span>
                <span className="text-[#c43e2c] font-bold tabular-nums">
                  <MontoARS monto={vuelto} />
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Acciones */}
        <div className="border-t border-[#e4c9b0]/60 bg-[#fdfaf6] px-6 py-3 flex gap-2 print:hidden">
          <Button
            variant="outline"
            onClick={imprimir}
            className="flex-1 border-[#e4c9b0] text-[#6f3a2a] hover:bg-[#f9d2a2]/40 gap-1.5"
          >
            <Printer className="h-4 w-4" />
            Imprimir
          </Button>
          <Button
            onClick={() => onCambioAbierto(false)}
            className="flex-[2] bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-bold"
          >
            Nueva venta
          </Button>
        </div>
      </DialogContent>
      </Dialog>
    </>
  )
}
