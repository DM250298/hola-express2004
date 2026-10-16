'use client'

import type { ReactNode } from 'react'
import { NavegadorFecha } from './NavegadorFecha'
import { ROLES_OPERATIVOS, nombreCompleto } from './constantes'
import { formatearHoras, type EmpleadoCrono } from './cronogramaCalculos'

interface Props {
  fecha: string
  hoy: string
  onCambioFecha: (fecha: string) => void
  empleados: EmpleadoCrono[]
  renderCelda: (empleado: EmpleadoCrono, fecha: string) => ReactNode
  /** Minutos planificados en la semana por empleado (solo Planificación). */
  minutosPorEmpleado?: Map<number, number>
}

/** Vista del día para celular: una fila legible por persona, misma celda que la grilla. */
export function ListaDiaCronograma({ fecha, hoy, onCambioFecha, empleados, renderCelda, minutosPorEmpleado }: Props) {
  return (
    <div className="space-y-3">
      <NavegadorFecha fecha={fecha} hoy={hoy} onCambio={onCambioFecha} formato="EEEE d 'de' MMM" />
      <ul className="bg-white border border-[#e4c9b0]/60 rounded-2xl divide-y divide-[#e4c9b0]/40 overflow-hidden">
        {empleados.map((e) => (
          <li key={e.id} className="grid grid-cols-[minmax(0,1fr)_140px] gap-2 items-center px-3 py-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-[#391511] truncate">{nombreCompleto(e)}</p>
              <p className="text-[11px] text-[#6f3a2a] truncate">
                {ROLES_OPERATIVOS[e.rol_operativo]}
                {minutosPorEmpleado && (
                  <span className="text-[#c8a58a]"> · {formatearHoras(minutosPorEmpleado.get(e.id) ?? 0)} semana</span>
                )}
              </p>
            </div>
            <div>{renderCelda(e, fecha)}</div>
          </li>
        ))}
      </ul>
    </div>
  )
}
