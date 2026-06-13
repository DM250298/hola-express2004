'use client'

import { useState } from 'react'
import { CalendarClock, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { ModalNovedad } from './ModalNovedad'
import { useNovedades, useDeleteNovedad } from '@/lib/hooks/useRrhh'
import { cn } from '@/lib/utils'

function mesActual(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// HE/presentismo ya no se cargan a mano (son automáticos en la liquidación);
// los registros legacy con esos tipos caen al fallback `n.tipo`.
const ETIQUETA_TIPO: Record<string, string> = {
  bono: 'Bono / premio',
  otro: 'Otro haber',
  adelanto: 'Adelanto',
  descuento: 'Descuento',
}

const RESTA = new Set(['adelanto', 'descuento'])

export function TabNovedades() {
  const [periodo, setPeriodo] = useState(mesActual())
  const [modalAbierto, setModalAbierto] = useState(false)

  const { data: novedades, isLoading, isError } = useNovedades(periodo)
  const eliminar = useDeleteNovedad()

  function handleEliminar(id: number) {
    if (!confirm('¿Eliminar esta novedad?')) return
    eliminar.mutate(id)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
            Período
          </Label>
          <Input
            type="month"
            value={periodo}
            onChange={(e) => setPeriodo(e.target.value || mesActual())}
            className="w-[170px] border-[#e4c9b0] focus-visible:ring-[#f9b44c] tabular-nums"
          />
        </div>
        <Button
          onClick={() => setModalAbierto(true)}
          className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5"
        >
          <Plus className="h-4 w-4" />
          Agregar novedad
        </Button>
      </div>

      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden shadow-sm">
        {isLoading ? (
          <div className="p-6">
            <SkeletonTabla filas={4} columnas={4} />
          </div>
        ) : isError ? (
          <div className="p-10 text-center text-[#c43e2c] text-sm">
            No se pudieron cargar las novedades.
          </div>
        ) : !novedades || novedades.length === 0 ? (
          <div className="p-12 text-center">
            <div className="inline-flex p-3 rounded-full bg-[#f9d2a2]/40 mb-3">
              <CalendarClock className="h-6 w-6 text-[#6f3a2a]" />
            </div>
            <p className="text-[#391511] font-semibold">
              Sin novedades en {periodo}
            </p>
            <p className="text-[#6f3a2a] text-sm mt-1">
              Cargá bonos, adelantos o descuentos antes de liquidar (las horas
              extra salen solas de la asistencia).
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-b-[#e4c9b0]/60 bg-[#fdfaf6] hover:bg-[#fdfaf6]">
                  <TableHead className="text-[#391511] font-semibold">
                    Empleado
                  </TableHead>
                  <TableHead className="text-[#391511] font-semibold">
                    Tipo
                  </TableHead>
                  <TableHead className="text-[#391511] font-semibold">
                    Concepto
                  </TableHead>
                  <TableHead className="text-right text-[#391511] font-semibold">
                    Monto
                  </TableHead>
                  <TableHead className="w-12 text-[#391511] font-semibold" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {novedades.map((n) => {
                  const resta = RESTA.has(n.tipo)
                  return (
                    <TableRow key={n.id} className="border-b-[#e4c9b0]/40">
                      <TableCell className="font-medium text-[#391511] text-sm">
                        {n.empleados?.nombre ?? `Empleado #${n.empleado_id}`}
                      </TableCell>
                      <TableCell className="text-[#6f3a2a] text-sm">
                        {ETIQUETA_TIPO[n.tipo] ?? n.tipo}
                      </TableCell>
                      <TableCell className="text-[#6f3a2a] text-sm">
                        {n.concepto || '—'}
                      </TableCell>
                      <TableCell
                        className={cn(
                          'text-right tabular-nums font-bold',
                          resta ? 'text-[#c43e2c]' : 'text-[#2f8f4e]'
                        )}
                      >
                        {resta ? '−' : '+'}
                        <MontoARS monto={n.monto} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEliminar(n.id)}
                          disabled={eliminar.isPending}
                          className="h-7 w-7 p-0 text-[#c8a58a] hover:bg-[#c43e2c]/10 hover:text-[#c43e2c]"
                          aria-label="Eliminar"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <ModalNovedad
        abierto={modalAbierto}
        onCambioAbierto={setModalAbierto}
        periodo={periodo}
      />
    </div>
  )
}
