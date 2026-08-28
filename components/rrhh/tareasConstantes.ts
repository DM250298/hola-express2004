import type {
  EstadoTareaTurno,
  ModoTarea,
  PrioridadTarea,
  TareaRecurrenteRow,
  TipoRecurrenciaTarea,
} from '@/types/database'

interface Estilo {
  label: string
  clase: string
}

export const ESTADO_TAREA: Record<EstadoTareaTurno, Estilo> = {
  pendiente: { label: 'Pendiente', clase: 'bg-[#e4c9b0]/40 text-[#6f3a2a]' },
  en_curso: { label: 'En curso', clase: 'bg-[#f9b44c]/25 text-[#a06b00]' },
  completada: { label: 'Completada', clase: 'bg-[#2f7d4f]/15 text-[#2f7d4f]' },
  vencida: { label: 'Vencida', clase: 'bg-[#c43e2c]/15 text-[#c43e2c]' },
  cancelada: { label: 'Cancelada', clase: 'bg-[#c8a58a]/20 text-[#6f3a2a]' },
}

/** Columnas del kanban, en orden. */
export const COLUMNAS_KANBAN: EstadoTareaTurno[] = [
  'pendiente',
  'en_curso',
  'completada',
  'vencida',
]

export const PRIORIDAD_TAREA: Record<PrioridadTarea, Estilo> = {
  baja: { label: 'Baja', clase: 'bg-[#c8a58a]/25 text-[#6f3a2a]' },
  media: { label: 'Media', clase: 'bg-[#f9b44c]/25 text-[#a06b00]' },
  alta: { label: 'Alta', clase: 'bg-[#c43e2c]/15 text-[#c43e2c]' },
}

/** Días de la semana (dow: 0 = domingo … 6 = sábado). */
export const DIAS_SEMANA: { n: number; corto: string; largo: string }[] = [
  { n: 1, corto: 'Lu', largo: 'Lunes' },
  { n: 2, corto: 'Ma', largo: 'Martes' },
  { n: 3, corto: 'Mi', largo: 'Miércoles' },
  { n: 4, corto: 'Ju', largo: 'Jueves' },
  { n: 5, corto: 'Vi', largo: 'Viernes' },
  { n: 6, corto: 'Sá', largo: 'Sábado' },
  { n: 0, corto: 'Do', largo: 'Domingo' },
]

export function diasResumen(dias: number[]): string {
  if (!dias || dias.length === 0) return 'Sin días'
  if (dias.length === 7) return 'Todos los días'
  return DIAS_SEMANA.filter((d) => dias.includes(d.n))
    .map((d) => d.corto)
    .join(' · ')
}

export const MODO_TAREA: Record<ModoTarea, Estilo> = {
  individual: { label: 'Cada uno', clase: 'bg-[#e4c9b0]/40 text-[#6f3a2a]' },
  grupal: { label: 'Grupal', clase: 'bg-[#f9b44c]/25 text-[#a06b00]' },
}

export const TIPO_RECURRENCIA: Record<TipoRecurrenciaTarea, string> = {
  dias_semana: 'Días de la semana',
  dia_mes: 'Un día del mes',
  cada_n_dias: 'Cada N días',
}

/** Resumen humano de la recurrencia de una plantilla (mig 158). */
export function recurrenciaResumen(p: TareaRecurrenteRow): string {
  switch (p.tipo_recurrencia) {
    case 'dia_mes':
      return p.dia_mes ? `El día ${p.dia_mes} de cada mes` : 'Sin día del mes'
    case 'cada_n_dias':
      if (!p.cada_n_dias) return 'Sin frecuencia'
      return p.cada_n_dias === 1 ? 'Todos los días' : `Cada ${p.cada_n_dias} días`
    default:
      return diasResumen(p.dias_semana)
  }
}

/**
 * ¿La instancia le corresponde al empleado? Cubre las individuales (es el
 * responsable) y las grupales (empleado_id null, figura entre los
 * participantes). Usar SIEMPRE este helper al filtrar "mis tareas".
 */
export function tareaEsDe(
  t: {
    empleado_id: number | null
    tareas_turno_participantes?: { empleado_id: number }[]
  },
  empleadoId: number
): boolean {
  if (t.empleado_id === empleadoId) return true
  return (
    t.empleado_id === null &&
    (t.tareas_turno_participantes ?? []).some((p) => p.empleado_id === empleadoId)
  )
}
