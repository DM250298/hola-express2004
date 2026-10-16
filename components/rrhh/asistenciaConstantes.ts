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

/** Fecha de hoy (yyyy-MM-dd) anclada a hora argentina (no a la TZ del navegador). */
export function hoyAr(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(new Date())
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

/** Primera letra en mayúscula (date-fns devuelve "martes 13 de octubre"). */
export function capitalizar(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s
}

/** Tardanza en minutos → "12 min" · "1h 05m". */
export function formatearTardanza(min: number): string {
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${h}h ${String(m).padStart(2, '0')}m`
}

/** Minutos → "8h 15m". */
export function formatearMinutos(min: number): string {
  if (!min) return '0h'
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${h}h${m ? ` ${m}m` : ''}`
}

// ─── Cronograma (Planificación / Fichadas) ───────────────────────────────────

interface EstiloTurno {
  /** Fondo + texto de la celda planificada. */
  celda: string
  /** Punto de color para leyendas y tarjetas de cobertura. */
  punto: string
  texto: string
}

/** Colores suaves y estables por turno (no son estados: nunca rojo). */
export const ESTILO_TURNO: Record<NombreTurno, EstiloTurno> = {
  manana: { celda: 'bg-[#fff0d2] text-[#805211]', punto: 'bg-[#e0a100]', texto: 'text-[#805211]' },
  tarde: { celda: 'bg-[#e3f1ec] text-[#286258]', punto: 'bg-[#2f7d4f]', texto: 'text-[#286258]' },
  noche: { celda: 'bg-[#ece8f7] text-[#5a4a84]', punto: 'bg-[#7b5ea7]', texto: 'text-[#5a4a84]' },
}

/** Celdas de planificación que no son un turno. */
export const ESTILO_PLAN = {
  franco: 'bg-white text-[#6f3a2a] border border-[#e4c9b0]/70',
  licencia: 'bg-[#f3eef9] text-[#7b5ea7] border border-transparent',
  sin_asignar:
    'bg-transparent text-[#c8a58a] border border-dashed border-[#e4c9b0]/80 hover:bg-[#fdf3e3]',
} as const

export type TonoFichada = 'neutro' | 'ok' | 'atencion' | 'problema'

/** Chips de la vista Fichadas. El rojo queda reservado a "Ausente" confirmado. */
export const TONO_FICHADA: Record<TonoFichada, string> = {
  neutro: 'bg-[#f3ece4] text-[#6f3a2a]',
  ok: 'bg-[#2f7d4f]/15 text-[#2f7d4f]',
  atencion: 'bg-[#e0a100]/20 text-[#a06b00]',
  problema: 'bg-[#c43e2c]/15 text-[#c43e2c]',
}
