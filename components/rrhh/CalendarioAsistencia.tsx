'use client'

import { useMemo, useState } from 'react'
import {
  addDays,
  addMonths,
  endOfMonth,
  format,
  parseISO,
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import { es } from 'date-fns/locale'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ESTADO_ASISTENCIA } from './asistenciaConstantes'
import { useAsistenciaEmpleado } from '@/lib/hooks/useAsistencia'
import { cn } from '@/lib/utils'
import type { AsistenciaDiariaRow } from '@/types/database'

interface Props {
  empleadoId: number
}

const DIAS_SEMANA = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do']

export function CalendarioAsistencia({ empleadoId }: Props) {
  const [mes, setMes] = useState(() => startOfMonth(new Date()))
  const desde = format(startOfMonth(mes), 'yyyy-MM-dd')
  const hasta = format(endOfMonth(mes), 'yyyy-MM-dd')

  const { data: asistencia, isLoading } = useAsistenciaEmpleado(empleadoId, desde, hasta)

  const mapa = useMemo(() => {
    const m = new Map<string, AsistenciaDiariaRow>()
    for (const a of asistencia ?? []) m.set(a.fecha, a)
    return m
  }, [asistencia])

  // 6 semanas desde el lunes de la semana del día 1.
  const celdas = useMemo(() => {
    const ini = startOfWeek(startOfMonth(mes), { weekStartsOn: 1 })
    return Array.from({ length: 42 }, (_, i) => addDays(ini, i))
  }, [mes])

  return (
    <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[#391511] font-bold capitalize">
          {format(mes, 'MMMM yyyy', { locale: es })}
        </h3>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setMes((m) => addMonths(m, -1))}
            className="h-7 w-7 p-0 text-[#6f3a2a]"
            aria-label="Mes anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setMes((m) => addMonths(m, 1))}
            className="h-7 w-7 p-0 text-[#6f3a2a]"
            aria-label="Mes siguiente"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {DIAS_SEMANA.map((d) => (
          <div key={d} className="text-center text-[#c8a58a] text-xs font-semibold py-1">
            {d}
          </div>
        ))}
        {celdas.map((dia) => {
          const iso = format(dia, 'yyyy-MM-dd')
          const delMes = dia.getMonth() === mes.getMonth()
          const asis = mapa.get(iso)
          const estilo = asis ? ESTADO_ASISTENCIA[asis.estado] : null
          return (
            <div
              key={iso}
              className={cn(
                'aspect-square rounded-lg flex flex-col items-center justify-center text-xs',
                !delMes && 'opacity-30',
                estilo ? estilo.clase : 'bg-[#fdfaf6] text-[#c8a58a]'
              )}
              title={estilo?.label}
            >
              <span className="font-semibold tabular-nums">{format(dia, 'd')}</span>
            </div>
          )
        })}
      </div>

      {isLoading && <p className="text-[#c8a58a] text-xs mt-2">Cargando…</p>}

      <div className="flex flex-wrap gap-1.5 mt-3">
        {Object.entries(ESTADO_ASISTENCIA).map(([k, v]) => (
          <span key={k} className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full', v.clase)}>
            {v.label}
          </span>
        ))}
      </div>
    </div>
  )
}
