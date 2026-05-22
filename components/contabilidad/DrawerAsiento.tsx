'use client'

import { Calendar, FileText } from 'lucide-react'
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
import { useAsientoDetalle } from '@/lib/hooks/useContabilidad'
import { formatearFechaCorta } from '@/lib/utils/formato'

interface Props {
  asientoId: number | null
  onCambioAbierto: (v: boolean) => void
}

export function DrawerAsiento({ asientoId, onCambioAbierto }: Props) {
  const { data, isLoading } = useAsientoDetalle(asientoId)
  const abierto = asientoId !== null

  const totalDebe = (data?.items ?? []).reduce(
    (s, i) => s + Number(i.debe),
    0
  )
  const totalHaber = (data?.items ?? []).reduce(
    (s, i) => s + Number(i.haber),
    0
  )

  return (
    <Sheet open={abierto} onOpenChange={onCambioAbierto}>
      <SheetContent side="right" className="sm:max-w-lg w-full flex flex-col p-0">
        <SheetHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <SheetTitle className="text-[#391511] text-lg flex items-center gap-2">
            <FileText className="h-5 w-5 text-[#f9b44c]" />
            Asiento {asientoId !== null ? `#${asientoId}` : ''}
          </SheetTitle>
          <SheetDescription className="text-[#6f3a2a]">
            Detalle de la partida doble.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {isLoading || !data ? (
            <div className="space-y-3">
              <Skeleton className="h-14 rounded-xl bg-[#f9d2a2]/30" />
              <Skeleton className="h-40 rounded-xl bg-[#f9d2a2]/30" />
            </div>
          ) : (
            <>
              <div className="bg-[#fdfaf6] border border-[#e4c9b0]/60 rounded-xl p-3 space-y-1.5 text-sm">
                <div className="flex items-center gap-1.5 text-[#6f3a2a]">
                  <Calendar className="h-3.5 w-3.5 text-[#c8a58a]" />
                  <span className="tabular-nums">
                    {formatearFechaCorta(data.asiento.fecha)}
                  </span>
                </div>
                <div className="text-[#391511] font-medium">
                  {data.asiento.descripcion}
                </div>
                <div className="flex gap-2">
                  <span className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full bg-[#c8a58a]/25 text-[#6f3a2a]">
                    {data.asiento.tipo}
                  </span>
                  {data.asiento.anulado && (
                    <span className="text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full bg-[#c43e2c]/10 text-[#c43e2c]">
                      Anulado
                    </span>
                  )}
                </div>
              </div>

              <div className="bg-white border border-[#e4c9b0]/60 rounded-xl overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="border-b-[#e4c9b0]/60 bg-[#fdfaf6] hover:bg-[#fdfaf6]">
                      <TableHead className="text-[#391511] font-semibold text-xs">
                        Cuenta
                      </TableHead>
                      <TableHead className="text-right text-[#391511] font-semibold text-xs">
                        Debe
                      </TableHead>
                      <TableHead className="text-right text-[#391511] font-semibold text-xs">
                        Haber
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.items.map((it) => (
                      <TableRow key={it.id} className="border-b-[#e4c9b0]/40">
                        <TableCell className="text-[#391511] text-xs">
                          <span className="font-mono text-[#6f3a2a]">
                            {it.cuenta_codigo}
                          </span>{' '}
                          {it.cuenta_nombre}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-xs text-[#391511]">
                          {Number(it.debe) > 0 ? (
                            <MontoARS monto={it.debe} />
                          ) : (
                            <span className="text-[#c8a58a]">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-xs text-[#391511]">
                          {Number(it.haber) > 0 ? (
                            <MontoARS monto={it.haber} />
                          ) : (
                            <span className="text-[#c8a58a]">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-[#fdfaf6]">
                      <TableCell className="font-bold text-[#391511] text-xs uppercase">
                        Totales
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-extrabold text-[#391511] text-xs">
                        <MontoARS monto={totalDebe} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-extrabold text-[#391511] text-xs">
                        <MontoARS monto={totalHaber} />
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
