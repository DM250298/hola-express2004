import type {
  AlcanceTarea,
  EstadoTareaTurno,
  ModoTarea,
  PrioridadTarea,
  TareaRecurrenteRow,
  TipoActividadTarea,
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
  no_se_pudo: { label: 'No se pudo', clase: 'bg-[#c8a58a]/20 text-[#6f3a2a]' },
  vencida: { label: 'Vencida', clase: 'bg-[#c43e2c]/15 text-[#c43e2c]' },
  cancelada: { label: 'Cancelada', clase: 'bg-[#c8a58a]/20 text-[#6f3a2a]' },
}

/**
 * Estilo del estado guardado. Si la base devuelve un valor que esta versión
 * de la app todavía no conoce, muestra el texto tal cual en vez de romper.
 */
export function estiloEstado(estado: string): Estilo {
  return (
    ESTADO_TAREA[estado as EstadoTareaTurno] ?? {
      label: estado,
      clase: 'bg-[#c8a58a]/20 text-[#6f3a2a]',
    }
  )
}

/** Tipo de actividad (mig 251). */
export const TIPO_ACTIVIDAD: Record<TipoActividadTarea, { label: string; ayuda: string }> = {
  puntual: {
    label: 'Tarea puntual',
    ayuda: 'Tiene hora y duración: entra en la agenda del turno y se completa.',
  },
  continua: {
    label: 'Actividad continua',
    ayuda: 'Durante todo el turno (atención al público, orden del salón). No se lista ni se completa.',
  },
  bloque: {
    label: 'Descanso / pase de turno',
    ayuda: 'Bloque de tiempo reservado: se ve en la agenda y cuenta en la carga, no como tarea.',
  },
}

/**
 * Estado derivado para la agenda (estado real + reloj). Siempre con texto,
 * no solo color. `atrasada` y `ahora` / `futura` se calculan en cliente con
 * la hora argentina; el enum de la base no cambia.
 */
export type EstadoDerivado =
  | 'futura'
  | 'ahora'
  | 'pendiente'
  | 'en_curso'
  | 'atrasada'
  | 'completada'
  | 'no_se_pudo'
  | 'omitida'
  | 'trasladada'
  | 'vencida'

export const ESTADO_DERIVADO: Record<EstadoDerivado, Estilo> = {
  futura: { label: 'Más tarde', clase: 'bg-[#f3ece4] text-[#6f3a2a]' },
  ahora: { label: 'Ahora', clase: 'bg-[#f9b44c] text-[#391511]' },
  pendiente: { label: 'Por hacer', clase: 'bg-[#e4c9b0]/40 text-[#6f3a2a]' },
  en_curso: { label: 'En curso', clase: 'bg-[#f9b44c]/25 text-[#a06b00]' },
  atrasada: { label: 'Atrasada', clase: 'bg-[#c43e2c]/15 text-[#c43e2c]' },
  completada: { label: 'Hecha', clase: 'bg-[#2f7d4f]/15 text-[#2f7d4f]' },
  no_se_pudo: { label: 'No se pudo', clase: 'bg-[#c8a58a]/20 text-[#6f3a2a]' },
  omitida: { label: 'Omitida', clase: 'bg-[#c8a58a]/20 text-[#6f3a2a]' },
  trasladada: { label: 'Trasladada', clase: 'bg-[#c8a58a]/20 text-[#6f3a2a]' },
  vencida: { label: 'Vencida', clase: 'bg-[#c43e2c]/15 text-[#c43e2c]' },
}

/** "07:20:00" → "07:20"; null → "—". */
export function formatoHora(hora: string | null | undefined): string {
  return hora ? hora.slice(0, 5) : '—'
}

/** 40 → "40 min"; 90 → "1 h 30"; null → "". */
export function formatoDuracion(min: number | null | undefined): string {
  if (!min) return ''
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`
}

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

/** Quién hace una recurrente (mig 248). */
export const ALCANCE_TAREA: Record<AlcanceTarea, { label: string; ayuda: string }> = {
  puesto: {
    label: 'Por puesto (según cronograma)',
    ayuda:
      'Cada día va a quien esté planificado con ese puesto en el turno. Si el puesto falta (franco, licencia), la cubre alguien del turno: Pivot, Encargado/a de Turno o Encargada de Sucursal. Nunca queda sin dueño.',
  },
  empleados: {
    label: 'Personas fijas',
    ayuda:
      'Siempre las mismas personas. Con franco o licencia se omite, salvo que el pivote del patrón la cubra.',
  },
  todos: { label: 'Todos', ayuda: 'Todo el personal activo.' },
}

/** La instancia la hace alguien que cubre un puesto o persona ausente ("Cubre a X" / "Cubre puesto X"). */
export function esCobertura(notas: string | null | undefined): boolean {
  return !!notas && notas.startsWith('Cubre')
}

/** Asignada por defecto porque ese día el turno no tenía a nadie en el cronograma. */
export function esSinCronograma(notas: string | null | undefined): boolean {
  return !!notas && notas.startsWith('Sin cronograma')
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
