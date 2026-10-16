'use client'

import { ESTILO_PLAN, ESTILO_TURNO, NOMBRE_TURNO, TONO_FICHADA } from './asistenciaConstantes'
import { etiquetaHorasCorta, parseNota, type EstadoFichada } from './cronogramaCalculos'
import { cn } from '@/lib/utils'
import type { HorarioAsignadoRow, TurnoPlantillaRow } from '@/types/database'

const BASE =
  'w-full min-h-[54px] rounded-lg px-1.5 py-1.5 text-left sm:text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f9b44c]'

interface PropsPlan {
  horario?: HorarioAsignadoRow
  turno?: TurnoPlantillaRow
  seleccionada?: boolean
  onClick: () => void
  etiqueta: string
}

/** Celda de Planificación: solo el plan, nunca la asistencia. */
export function CeldaPlan({ horario, turno, seleccionada, onClick, etiqueta }: PropsPlan) {
  const nota = parseNota(horario?.notas)
  const ring = seleccionada ? 'ring-2 ring-[#391511] ring-offset-1' : ''

  if (!horario) {
    return (
      <button type="button" onClick={onClick} aria-label={`${etiqueta}: sin asignar`} className={cn(BASE, ESTILO_PLAN.sin_asignar, ring)}>
        <span className="block text-xs">Sin asignar</span>
      </button>
    )
  }

  if (horario.estado === 'franco' || horario.estado === 'licencia') {
    const label = horario.estado === 'franco' ? 'Franco' : 'Licencia'
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={`${etiqueta}: ${label}`}
        title={horario.notas ?? undefined}
        className={cn(BASE, ESTILO_PLAN[horario.estado], ring)}
      >
        <span className="block text-xs font-semibold">{label}</span>
        {nota.observacion && (
          <span className="block text-[10px] leading-tight truncate opacity-80">{nota.observacion}</span>
        )}
      </button>
    )
  }

  if (!turno) {
    return (
      <button type="button" onClick={onClick} aria-label={`${etiqueta}: turno sin definir`} className={cn(BASE, ESTILO_PLAN.sin_asignar, ring)}>
        <span className="block text-xs">Turno sin definir</span>
      </button>
    )
  }

  const estilo = ESTILO_TURNO[turno.nombre]
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${etiqueta}: ${NOMBRE_TURNO[turno.nombre]} ${etiquetaHorasCorta(turno)}`}
      title={horario.notas ?? undefined}
      className={cn(BASE, estilo.celda, ring)}
    >
      <span className="block text-xs font-bold leading-tight">{NOMBRE_TURNO[turno.nombre]}</span>
      <span className="block text-[11px] tabular-nums leading-tight opacity-90">{etiquetaHorasCorta(turno)}</span>
      {nota.cubreA && (
        <span className="block text-[10px] leading-tight truncate font-semibold mt-0.5">
          Cubre a {nota.cubreA.nombre.split(' ')[0]}
        </span>
      )}
      {!nota.cubreA && nota.observacion && (
        <span className="block text-[10px] leading-tight truncate opacity-80 mt-0.5">{nota.observacion}</span>
      )}
    </button>
  )
}

interface PropsFichada {
  estado: EstadoFichada
  turno?: TurnoPlantillaRow
  onClick: () => void
  etiqueta: string
}

/** Celda de Fichadas: estado derivado + horas reales; el plan solo como referencia gris. */
export function CeldaFichada({ estado, turno, onClick, etiqueta }: PropsFichada) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${etiqueta}: ${estado.label}`}
      title={estado.detalle}
      className={cn(BASE, 'bg-white border border-[#e4c9b0]/50 hover:bg-[#fdfaf6]')}
    >
      <span className={cn('inline-block max-w-full truncate rounded-full px-2 py-0.5 text-[11px] font-semibold', TONO_FICHADA[estado.tono])}>
        {estado.label}
      </span>
      {estado.horas && (
        <span className="block text-[11px] tabular-nums text-[#391511] mt-0.5">{estado.horas}</span>
      )}
      {!estado.horas && estado.detalle && (
        <span className="block text-[10px] text-[#6f3a2a] truncate mt-0.5">{estado.detalle}</span>
      )}
      {turno && estado.clave !== 'franco' && estado.clave !== 'licencia' && (
        <span className="block text-[10px] text-[#c8a58a] truncate">
          Plan: {NOMBRE_TURNO[turno.nombre]} {etiquetaHorasCorta(turno)}
        </span>
      )}
    </button>
  )
}

/** Chip de fichada (listas del día, resúmenes). */
export function ChipFichada({ estado }: { estado: EstadoFichada }) {
  return (
    <span className={cn('inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold', TONO_FICHADA[estado.tono])}>
      {estado.label}
    </span>
  )
}
