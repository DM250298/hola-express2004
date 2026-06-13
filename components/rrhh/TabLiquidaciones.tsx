'use client'

import { useState } from 'react'
import { FileText, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { SkeletonTabla } from '@/components/shared/SkeletonTabla'
import { MontoARS } from '@/components/shared/MontoARS'
import { ModalGenerarLiquidacion } from './ModalGenerarLiquidacion'
import { ModalDetalleLiquidacion } from './ModalDetalleLiquidacion'
import { useLiquidacionLotes } from '@/lib/hooks/useRrhh'
import { cn } from '@/lib/utils'

const BADGE_ESTADO: Record<string, string> = {
  borrador: 'bg-[#f9b44c]/20 text-[#6f3a2a]',
  confirmada: 'bg-[#6f3a2a]/15 text-[#6f3a2a]',
  pagada: 'bg-[#2f8f4e]/15 text-[#2f8f4e]',
}

export function TabLiquidaciones() {
  const { data: lotes, isLoading, isError } = useLiquidacionLotes()
  const [modalGenerar, setModalGenerar] = useState(false)
  const [detalleId, setDetalleId] = useState<number | null>(null)
  const [detalleAbierto, setDetalleAbierto] = useState(false)

  function abrirDetalle(id: number) {
    setDetalleId(id)
    setDetalleAbierto(true)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[#391511] font-bold">Liquidaciones de sueldo</h2>
          <p className="text-[#6f3a2a] text-sm">
            Una liquidación mensual con un recibo por empleado, calculado desde
            la asistencia real.
          </p>
        </div>
        <Button
          onClick={() => setModalGenerar(true)}
          className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5"
        >
          <Plus className="h-4 w-4" />
          Generar liquidación
        </Button>
      </div>

      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden shadow-sm">
        {isLoading ? (
          <div className="p-6">
            <SkeletonTabla filas={4} columnas={5} />
          </div>
        ) : isError ? (
          <div className="p-10 text-center text-[#c43e2c] text-sm">
            No se pudieron cargar las liquidaciones.
          </div>
        ) : !lotes || lotes.length === 0 ? (
          <div className="p-12 text-center">
            <div className="inline-flex p-3 rounded-full bg-[#f9d2a2]/40 mb-3">
              <FileText className="h-6 w-6 text-[#6f3a2a]" />
            </div>
            <p className="text-[#391511] font-semibold">
              Sin liquidaciones generadas
            </p>
            <p className="text-[#6f3a2a] text-sm mt-1">
              Generá la liquidación del mes para producir los recibos.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-b-[#e4c9b0]/60 bg-[#fdfaf6] hover:bg-[#fdfaf6]">
                  <TableHead className="text-[#391511] font-semibold">
                    Período
                  </TableHead>
                  <TableHead className="text-[#391511] font-semibold">
                    Estado
                  </TableHead>
                  <TableHead className="text-right text-[#391511] font-semibold">
                    Remunerativo
                  </TableHead>
                  <TableHead className="text-right text-[#391511] font-semibold">
                    Descuentos
                  </TableHead>
                  <TableHead className="text-right text-[#391511] font-semibold">
                    Neto
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lotes.map((l) => (
                  <TableRow
                    key={l.id}
                    onClick={() => abrirDetalle(l.id)}
                    className="border-b-[#e4c9b0]/40 cursor-pointer hover:bg-[#fdfaf6]"
                  >
                    <TableCell className="font-medium text-[#391511] tabular-nums">
                      {l.periodo}
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          'text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full',
                          BADGE_ESTADO[l.estado] ?? BADGE_ESTADO.borrador
                        )}
                      >
                        {l.estado}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-[#391511]">
                      <MontoARS monto={l.total_remunerativo} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-[#c43e2c]">
                      <MontoARS monto={l.total_descuentos} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-bold text-[#391511]">
                      <MontoARS monto={l.total_neto} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <ModalGenerarLiquidacion
        abierto={modalGenerar}
        onCambioAbierto={setModalGenerar}
        onGenerada={(id) => abrirDetalle(id)}
      />

      <ModalDetalleLiquidacion
        abierto={detalleAbierto}
        onCambioAbierto={setDetalleAbierto}
        loteId={detalleId}
      />
    </div>
  )
}
