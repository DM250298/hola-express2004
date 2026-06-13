'use client'

import { useState } from 'react'
import { Award, ClipboardCheck, Star } from 'lucide-react'
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
import { useEvaluacionesPeriodo } from '@/lib/hooks/useDesempeno'
import type { EvaluacionCalculadaRow } from '@/types/database'
import { cn } from '@/lib/utils'
import { ModalEvaluacion } from './ModalEvaluacion'
import { ScoreBadge } from './ScoreDesempeno'

function mesActual(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const nombreCompleto = (f: EvaluacionCalculadaRow) =>
  [f.nombre, f.apellido].filter(Boolean).join(' ')

export function TabDesempeno() {
  const [periodo, setPeriodo] = useState(mesActual())
  const [filaSel, setFilaSel] = useState<EvaluacionCalculadaRow | null>(null)
  const [modalAbierto, setModalAbierto] = useState(false)

  const { data: filas, isLoading, isError } = useEvaluacionesPeriodo(periodo)

  function evaluar(f: EvaluacionCalculadaRow) {
    setFilaSel(f)
    setModalAbierto(true)
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
        <p className="text-[#6f3a2a] text-xs max-w-sm">
          El total pondera asistencia, tareas y la evaluación personal. Si un
          empleado no tuvo turnos o tareas, ese componente no resta.
        </p>
      </div>

      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden shadow-sm">
        {isLoading ? (
          <div className="p-6">
            <SkeletonTabla filas={5} columnas={6} />
          </div>
        ) : isError ? (
          <div className="p-10 text-center text-[#c43e2c] text-sm">
            No se pudo calcular el desempeño.
          </div>
        ) : !filas || filas.length === 0 ? (
          <div className="p-12 text-center">
            <div className="inline-flex p-3 rounded-full bg-[#f9d2a2]/40 mb-3">
              <Award className="h-6 w-6 text-[#6f3a2a]" />
            </div>
            <p className="text-[#391511] font-semibold">
              Sin empleados activos para evaluar
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
                  <TableHead className="text-center text-[#391511] font-semibold">
                    Asistencia
                  </TableHead>
                  <TableHead className="text-center text-[#391511] font-semibold">
                    Tareas
                  </TableHead>
                  <TableHead className="text-center text-[#391511] font-semibold">
                    Personal
                  </TableHead>
                  <TableHead className="text-center text-[#391511] font-semibold">
                    Total
                  </TableHead>
                  <TableHead className="w-28 text-right text-[#391511] font-semibold" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filas.map((f) => (
                  <TableRow key={f.empleado_id} className="border-b-[#e4c9b0]/40">
                    <TableCell className="font-medium text-[#391511] text-sm">
                      <div className="flex flex-col">
                        <span>{nombreCompleto(f)}</span>
                        <span className="text-[#c8a58a] text-xs tabular-nums">
                          {f.legajo}
                          {f.evaluado_at && (
                            <span className="ml-2 inline-flex items-center gap-0.5 text-[#2f7d4f]">
                              <Star className="h-3 w-3 fill-current" />
                              evaluado
                            </span>
                          )}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <ScoreBadge valor={f.puntaje_asistencia} size="sm" />
                    </TableCell>
                    <TableCell className="text-center">
                      <ScoreBadge valor={f.puntaje_tareas} size="sm" />
                    </TableCell>
                    <TableCell className="text-center">
                      <ScoreBadge valor={f.puntaje_manual} size="sm" />
                    </TableCell>
                    <TableCell className="text-center">
                      <ScoreBadge valor={f.puntaje_total} size="md" />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => evaluar(f)}
                        className={cn(
                          'h-8 gap-1.5 text-[#6f3a2a] hover:bg-[#f9b44c]/15 hover:text-[#391511]'
                        )}
                      >
                        <ClipboardCheck className="h-3.5 w-3.5" />
                        {f.puntaje_manual != null ? 'Editar' : 'Evaluar'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <ModalEvaluacion
        abierto={modalAbierto}
        onCambioAbierto={setModalAbierto}
        fila={filaSel}
        periodo={periodo}
      />
    </div>
  )
}
