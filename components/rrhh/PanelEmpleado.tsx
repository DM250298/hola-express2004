'use client'

import { useMemo, useState } from 'react'
import {
  addMonths,
  endOfMonth,
  format,
  startOfMonth,
} from 'date-fns'
import { es } from 'date-fns/locale'
import {
  AlertTriangle,
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  Clock,
  ShieldCheck,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CalendarioAsistencia } from './CalendarioAsistencia'
import { formatearMinutos } from './asistenciaConstantes'
import { useAsistenciaEmpleado } from '@/lib/hooks/useAsistencia'
import { formatearFechaHora } from '@/lib/utils/formato'
import { cn } from '@/lib/utils'

interface Props {
  empleadoId: number
  nombre: string
}

// Umbrales de presentismo para el indicador (la liquidación real usa rrhh_config
// en el Sprint 4; acá es sólo un semáforo informativo para el empleado).
const MAX_TARDANZAS = 3
const MAX_AUSENCIAS = 1

function Kpi({
  icono: Icono,
  label,
  valor,
  clase,
}: {
  icono: React.ElementType
  label: string
  valor: string
  clase?: string
}) {
  return (
    <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl shadow-sm p-4">
      <div className="flex items-center gap-2 text-[#c8a58a] text-xs font-semibold uppercase tracking-wide">
        <Icono className="h-4 w-4" />
        {label}
      </div>
      <p className={cn('text-2xl font-bold mt-1 tabular-nums', clase ?? 'text-[#391511]')}>
        {valor}
      </p>
    </div>
  )
}

export function PanelEmpleado({ empleadoId, nombre }: Props) {
  const [mes, setMes] = useState(() => startOfMonth(new Date()))
  const desde = format(startOfMonth(mes), 'yyyy-MM-dd')
  const hasta = format(endOfMonth(mes), 'yyyy-MM-dd')
  const { data: dias } = useAsistenciaEmpleado(empleadoId, desde, hasta)

  const resumen = useMemo(() => {
    const lista = dias ?? []
    const trabajados = lista.filter(
      (d) => d.estado === 'presente' || d.estado === 'tardanza'
    ).length
    const horas = lista.reduce((s, d) => s + d.minutos_trabajados, 0)
    const tardanzas = lista.filter((d) => d.estado === 'tardanza').length
    const ausencias = lista.filter((d) => d.estado === 'ausente_injustificado').length
    const ultima = lista.reduce((max, d) => (d.updated_at > max ? d.updated_at : max), '')
    const presentismoOk = ausencias < MAX_AUSENCIAS && tardanzas < MAX_TARDANZAS
    return { trabajados, horas, tardanzas, ausencias, ultima, presentismoOk }
  }, [dias])

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-5">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[#391511] text-2xl font-bold">Hola, {nombre.split(' ')[0]} 👋</h1>
          <p className="text-[#6f3a2a] text-sm mt-1">Tu asistencia del mes.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setMes((m) => addMonths(m, -1))}
            className="h-8 w-8 p-0 text-[#6f3a2a]"
            aria-label="Mes anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-[#391511] font-semibold text-sm capitalize min-w-[140px] text-center">
            {format(mes, 'MMMM yyyy', { locale: es })}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setMes((m) => addMonths(m, 1))}
            className="h-8 w-8 p-0 text-[#6f3a2a]"
            aria-label="Mes siguiente"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icono={CalendarCheck} label="Días trabajados" valor={String(resumen.trabajados)} />
        <Kpi icono={Clock} label="Horas" valor={formatearMinutos(resumen.horas)} />
        <Kpi
          icono={AlertTriangle}
          label="Tardanzas"
          valor={String(resumen.tardanzas)}
          clase={resumen.tardanzas > 0 ? 'text-[#a06b00]' : undefined}
        />
        <Kpi
          icono={XCircle}
          label="Ausencias"
          valor={String(resumen.ausencias)}
          clase={resumen.ausencias > 0 ? 'text-[#c43e2c]' : undefined}
        />
      </div>

      {/* Presentismo */}
      <div
        className={cn(
          'rounded-2xl border p-4 flex items-center gap-3',
          resumen.presentismoOk
            ? 'bg-[#2f7d4f]/10 border-[#2f7d4f]/30'
            : 'bg-[#c43e2c]/10 border-[#c43e2c]/30'
        )}
      >
        <ShieldCheck
          className={cn('h-6 w-6 shrink-0', resumen.presentismoOk ? 'text-[#2f7d4f]' : 'text-[#c43e2c]')}
        />
        <div>
          <p className={cn('font-bold', resumen.presentismoOk ? 'text-[#2f7d4f]' : 'text-[#c43e2c]')}>
            Presentismo {resumen.presentismoOk ? 'en regla' : 'en riesgo'}
          </p>
          <p className="text-[#6f3a2a] text-sm">
            {resumen.presentismoOk
              ? 'Seguí así: sin ausencias injustificadas ni exceso de tardanzas.'
              : 'Cuidá las tardanzas y ausencias para no perder el presentismo.'}
          </p>
        </div>
      </div>

      <CalendarioAsistencia empleadoId={empleadoId} />

      {resumen.ultima && (
        <p className="text-[#c8a58a] text-xs text-center">
          Datos actualizados al {formatearFechaHora(resumen.ultima)}
        </p>
      )}
    </div>
  )
}
