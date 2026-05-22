'use client'

import { Clock, Users } from 'lucide-react'
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
import { formatearFechaHora } from '@/lib/utils/formato'
import { useTurnosDelDia } from '@/lib/hooks/useDashboard'
import { cn } from '@/lib/utils'

function soloHora(fecha: string): string {
  const d = new Date(fecha)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function TablaTurnosDia() {
  const { data: turnos, isLoading, isError } = useTurnosDelDia()

  return (
    <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden shadow-sm">
      <div className="px-5 py-4 border-b border-[#e4c9b0]/60 bg-[#fdfaf6] flex items-center gap-2">
        <Users className="h-4 w-4 text-[#391511]" />
        <h2 className="text-[#391511] font-bold">Turnos del día</h2>
        {turnos && (
          <span className="text-xs text-[#6f3a2a]">· {turnos.length}</span>
        )}
      </div>

      {isLoading ? (
        <div className="p-6">
          <Skeleton className="h-24 w-full bg-[#f9d2a2]/30" />
        </div>
      ) : isError ? (
        <div className="p-6 text-center text-[#c43e2c] text-sm">
          No se pudieron cargar los turnos.
        </div>
      ) : !turnos || turnos.length === 0 ? (
        <div className="py-10 text-center">
          <Clock className="h-6 w-6 text-[#c8a58a] mx-auto mb-2" />
          <p className="text-[#391511] font-semibold text-sm">
            Sin turnos abiertos hoy
          </p>
          <p className="text-[#6f3a2a] text-xs mt-1">
            Cuando un cajero abra caja, aparecerá acá.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-b-[#e4c9b0]/60 bg-[#fdfaf6] hover:bg-[#fdfaf6]">
                <TableHead className="text-[#391511] font-semibold">
                  Cajero
                </TableHead>
                <TableHead className="text-[#391511] font-semibold">
                  Horario
                </TableHead>
                <TableHead className="text-right text-[#391511] font-semibold">
                  Ventas
                </TableHead>
                <TableHead className="text-right text-[#391511] font-semibold">
                  Diferencia
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {turnos.map((t) => {
                const abierto = t.estado === 'abierto'
                return (
                  <TableRow
                    key={t.id}
                    className="border-b-[#e4c9b0]/40 hover:bg-[#fdfaf6]"
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-[#391511]">
                          {t.cajero_nombre ?? '—'}
                        </span>
                        {abierto && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider bg-[#f9b44c]/20 text-[#6f3a2a] px-1.5 py-0.5 rounded-full">
                            <span className="h-1 w-1 rounded-full bg-[#f9b44c] animate-pulse" />
                            En curso
                          </span>
                        )}
                      </div>
                      <div
                        className="text-xs text-[#6f3a2a] mt-0.5"
                        title={formatearFechaHora(t.fecha_apertura)}
                      >
                        Turno #{t.id}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-[#6f3a2a] tabular-nums">
                      {soloHora(t.fecha_apertura)} –{' '}
                      {t.fecha_cierre ? (
                        soloHora(t.fecha_cierre)
                      ) : (
                        <span className="text-[#c8a58a] italic">en curso</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="font-semibold text-[#391511] tabular-nums">
                        <MontoARS monto={t.ventas_total} />
                      </div>
                      <div className="text-xs text-[#c8a58a] tabular-nums">
                        {t.cantidad_ventas}{' '}
                        {t.cantidad_ventas === 1 ? 'venta' : 'ventas'}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {t.diferencia == null ? (
                        <span className="text-[#c8a58a] italic text-xs">—</span>
                      ) : Math.abs(t.diferencia) < 0.01 ? (
                        <span className="text-[#6f3a2a] font-semibold">$0</span>
                      ) : (
                        <span
                          className={cn(
                            'font-semibold',
                            t.diferencia > 0
                              ? 'text-[#6f3a2a]'
                              : 'text-[#c43e2c]'
                          )}
                        >
                          {t.diferencia > 0 ? '+' : '−'}
                          <MontoARS monto={Math.abs(t.diferencia)} />
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
