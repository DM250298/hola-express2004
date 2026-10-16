'use client'

import type { ReactNode } from 'react'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { ROLES_OPERATIVOS, nombreCompleto } from './constantes'
import { formatearHoras, type EmpleadoCrono } from './cronogramaCalculos'
import { cn } from '@/lib/utils'

interface Props {
  empleados: EmpleadoCrono[]
  /** 7 fechas yyyy-MM-dd (lunes a domingo). */
  dias: string[]
  diaSel: string
  onSeleccionarDia: (fecha: string) => void
  hoy: string
  renderCelda: (empleado: EmpleadoCrono, fecha: string) => ReactNode
  /** Minutos planificados por empleado; si viene, se muestra la columna Horas. */
  minutosPorEmpleado?: Map<number, number>
}

/**
 * Grilla empleados × días con encabezado y columna de empleados fijos. No sabe
 * qué hay en cada celda: Planificación y Fichadas le pasan su propio renderCelda.
 */
export function GrillaCronograma({
  empleados,
  dias,
  diaSel,
  onSeleccionarDia,
  hoy,
  renderCelda,
  minutosPorEmpleado,
}: Props) {
  return (
    <div className="overflow-auto max-h-[72vh]">
      <table className="w-full border-separate border-spacing-0 min-w-[900px]">
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-30 bg-[#fdfaf6] border-b border-[#e4c9b0]/60 text-left px-4 py-2.5 text-[#391511] font-semibold text-sm min-w-[200px] w-[200px]">
              Equipo
            </th>
            {dias.map((d) => {
              const dt = parseISO(d)
              const domingo = dt.getDay() === 0
              const sel = d === diaSel
              const esHoy = d === hoy
              return (
                <th
                  key={d}
                  className={cn(
                    'sticky top-0 z-20 border-b border-[#e4c9b0]/60 p-1 min-w-[108px]',
                    sel ? 'bg-[#fdf3e3]' : 'bg-[#fdfaf6]'
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onSeleccionarDia(d)}
                    aria-pressed={sel}
                    className={cn(
                      'w-full rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f9b44c]',
                      sel ? 'bg-[#f9b44c] text-[#391511]' : 'hover:bg-[#f9d2a2]/40',
                      !sel && (domingo ? 'text-[#c43e2c]' : 'text-[#391511]')
                    )}
                  >
                    <span className="block capitalize">{format(dt, 'EEE', { locale: es }).replace('.', '')}</span>
                    <span className={cn('block tabular-nums font-normal', sel ? 'text-[#391511]' : 'text-[#c8a58a]')}>
                      {format(dt, 'd/MM')}
                      {esHoy && <span className="ml-1 text-[9px] uppercase font-bold">hoy</span>}
                    </span>
                  </button>
                </th>
              )
            })}
            {minutosPorEmpleado && (
              <th
                className="sticky top-0 z-20 bg-[#fdfaf6] border-b border-[#e4c9b0]/60 px-2 py-2.5 text-center text-xs font-semibold text-[#391511] min-w-[72px]"
                title="Horas brutas planificadas en la semana (duración del turno, sin descontar descansos). No son horas trabajadas ni liquidables."
              >
                Horas
                <span className="block text-[9px] font-normal text-[#c8a58a]">plan. brutas</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {empleados.map((e) => (
            <tr key={e.id} className="group">
              <td className="sticky left-0 z-10 bg-white group-hover:bg-[#fdfaf6] border-b border-[#e4c9b0]/30 px-4 py-2 min-w-[200px] w-[200px]">
                <div className="text-[#391511] text-sm font-medium truncate">{nombreCompleto(e)}</div>
                <div className="text-[#6f3a2a] text-[11px] truncate">{ROLES_OPERATIVOS[e.rol_operativo]}</div>
                <div className="text-[#c8a58a] text-[10px] tabular-nums">{e.legajo}</div>
              </td>
              {dias.map((d) => (
                <td
                  key={d}
                  className={cn(
                    'border-b border-[#e4c9b0]/30 px-1 py-1.5 align-top',
                    d === diaSel && 'bg-[#fdf3e3]/60'
                  )}
                >
                  {renderCelda(e, d)}
                </td>
              ))}
              {minutosPorEmpleado && (
                <td className="border-b border-[#e4c9b0]/30 px-2 py-2 text-center text-sm tabular-nums text-[#391511]">
                  {formatearHoras(minutosPorEmpleado.get(e.id) ?? 0)}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
