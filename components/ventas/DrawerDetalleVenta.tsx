'use client'

import { Calendar, Receipt, User } from 'lucide-react'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { MontoARS } from '@/components/shared/MontoARS'
import { useVentaDetalle } from '@/lib/hooks/useVentasListado'
import { useMediosPago } from '@/lib/hooks/useMediosPago'
import { etiquetaMedioFallback } from '@/lib/utils/iconosMedioPago'
import { formatearFechaHora } from '@/lib/utils/formato'

interface Props {
  ventaId: number | null
  onCambioAbierto: (v: boolean) => void
}

export function DrawerDetalleVenta({ ventaId, onCambioAbierto }: Props) {
  const { data, isLoading } = useVentaDetalle(ventaId)
  const { data: medios } = useMediosPago()
  const abierto = ventaId !== null

  function etiquetaMedio(codigo: string): string {
    return (
      (medios ?? []).find((m) => m.codigo === codigo)?.nombre ??
      etiquetaMedioFallback(codigo)
    )
  }

  return (
    <Sheet open={abierto} onOpenChange={onCambioAbierto}>
      <SheetContent side="right" className="sm:max-w-lg w-full flex flex-col p-0">
        <SheetHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <SheetTitle className="text-[#391511] text-lg flex items-center gap-2">
            <Receipt className="h-5 w-5 text-[#f9b44c]" />
            Venta {ventaId !== null ? `#${ventaId}` : ''}
          </SheetTitle>
          <SheetDescription className="text-[#6f3a2a]">
            Detalle de items, pagos y total.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {isLoading || !data ? (
            <div className="space-y-3">
              <Skeleton className="h-16 rounded-xl bg-[#f9d2a2]/30" />
              <Skeleton className="h-40 rounded-xl bg-[#f9d2a2]/30" />
              <Skeleton className="h-24 rounded-xl bg-[#f9d2a2]/30" />
            </div>
          ) : (
            <>
              {/* Info */}
              <div className="bg-[#fdfaf6] border border-[#e4c9b0]/60 rounded-xl p-3 space-y-1.5 text-sm">
                <div className="flex items-center gap-1.5 text-[#6f3a2a]">
                  <Calendar className="h-3.5 w-3.5 text-[#c8a58a]" />
                  <span className="tabular-nums">
                    {formatearFechaHora(data.venta.fecha)}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-[#6f3a2a]">
                  <User className="h-3.5 w-3.5 text-[#c8a58a]" />
                  <span>
                    {data.cajero_nombre ?? '—'} · Turno #{data.venta.turno_id}
                  </span>
                </div>
                {data.venta.estado === 'anulada' && (
                  <div className="text-[10px] uppercase tracking-wider font-bold text-[#c43e2c] mt-1">
                    Anulada
                  </div>
                )}
              </div>

              {/* Items */}
              <div>
                <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold mb-2">
                  Productos ({data.items.length})
                </div>
                <div className="bg-white border border-[#e4c9b0]/60 rounded-xl overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-b-[#e4c9b0]/60 bg-[#fdfaf6] hover:bg-[#fdfaf6]">
                        <TableHead className="text-[#391511] font-semibold text-xs">
                          Producto
                        </TableHead>
                        <TableHead className="text-right text-[#391511] font-semibold text-xs">
                          Cant.
                        </TableHead>
                        <TableHead className="text-right text-[#391511] font-semibold text-xs">
                          Precio
                        </TableHead>
                        <TableHead className="text-right text-[#391511] font-semibold text-xs">
                          Subtotal
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.items.map((it) => (
                        <TableRow
                          key={it.id}
                          className="border-b-[#e4c9b0]/40"
                        >
                          <TableCell className="text-[#391511] text-xs">
                            <div className="font-medium">
                              {it.producto_nombre ?? 'Producto eliminado'}
                            </div>
                            {it.producto_codigo && (
                              <div className="text-[#c8a58a] font-mono text-[10px]">
                                {it.producto_codigo}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-[#6f3a2a] text-xs">
                            {it.cantidad}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-[#6f3a2a] text-xs">
                            <MontoARS monto={it.precio_unitario} />
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-semibold text-[#391511] text-xs">
                            <MontoARS monto={it.subtotal} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {/* Pagos */}
              <div>
                <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold mb-2">
                  Pagos
                </div>
                <ul className="bg-white border border-[#e4c9b0]/60 rounded-xl divide-y divide-[#e4c9b0]/40 overflow-hidden">
                  {data.pagos.length === 0 ? (
                    <li className="px-3 py-2 text-xs text-[#6f3a2a] italic">
                      Sin pagos registrados (venta antigua, ver{' '}
                      <span className="font-medium">
                        {etiquetaMedio(data.venta.medio_pago)}
                      </span>
                      )
                    </li>
                  ) : (
                    data.pagos.map((p) => (
                      <li
                        key={p.id}
                        className="px-3 py-2 flex items-center justify-between text-sm"
                      >
                        <span className="text-[#391511]">
                          {etiquetaMedio(p.medio_pago)}
                        </span>
                        <span className="font-bold text-[#391511] tabular-nums">
                          <MontoARS monto={p.monto} />
                        </span>
                      </li>
                    ))
                  )}
                </ul>
              </div>

              {/* Total */}
              <div className="bg-[#f9b44c]/10 border-2 border-[#f9b44c]/40 rounded-xl p-3 flex justify-between items-baseline">
                <span className="text-[#391511] font-extrabold uppercase tracking-wider text-sm">
                  Total
                </span>
                <span className="text-[#391511] text-2xl font-extrabold tabular-nums">
                  <MontoARS monto={data.venta.total} />
                </span>
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
