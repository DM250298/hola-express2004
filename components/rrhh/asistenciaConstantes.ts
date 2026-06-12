import type {
  EstadoAsistencia,
  EstadoHorario,
  NombreTurno,
} from '@/types/database'

export const NOMBRE_TURNO: Record<NombreTurno, string> = {
  manana: 'Mañana',
  tarde: 'Tarde',
  noche: 'Noche',
}

export const ABREV_TURNO: Record<NombreTurno, string> = {
  manana: 'M',
  tarde: 'T',
  noche: 'N',
}

export const ESTADO_HORARIO: Record<EstadoHorario, string> = {
  planificado: 'Planificado',
  cubierto: 'Cubierto',
  ausente: 'Ausente',
  franco: 'Franco',
  licencia: 'Licencia',
}

interface EstiloEstado {
  label: string
  clase: string
}

/** Colores del semáforo de asistencia (mismo lenguaje cálido del ERP). */
export const ESTADO_ASISTENCIA: Record<EstadoAsistencia, EstiloEstado> = {
  presente: { label: 'Presente', clase: 'bg-[#2f7d4f]/15 text-[#2f7d4f]' },
  tardanza: { label: 'Tardanza', clase: 'bg-[#e0a100]/20 text-[#a06b00]' },
  ausente_justificado: {
    label: 'Ausente justif.',
    clase: 'bg-[#4a6fa5]/15 text-[#4a6fa5]',
  },
  ausente_injustificado: {
    label: 'Ausente',
    clase: 'bg-[#c43e2c]/15 text-[#c43e2c]',
  },
  franco: { label: 'Franco', clase: 'bg-[#c8a58a]/20 text-[#6f3a2a]' },
  licencia: { label: 'Licencia', clase: 'bg-[#7b5ea7]/15 text-[#7b5ea7]' },
  incompleto: { label: 'Incompleto', clase: 'bg-[#d9772e]/20 text-[#a8521a]' },
  sin_turno: { label: 'Sin turno', clase: 'bg-[#e4c9b0]/30 text-[#6f3a2a]' },
}

/** HH:mm de un timestamptz en hora argentina. */
export function horaAr(iso: string | null): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Argentina/Buenos_Aires',
    hour12: false,
  }).format(new Date(iso))
}

/** Minutos → "8h 15m". */
export function formatearMinutos(min: number): string {
  if (!min) return '0h'
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${h}h${m ? ` ${m}m` : ''}`
}
