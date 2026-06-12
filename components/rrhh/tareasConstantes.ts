import type { EstadoTareaTurno, PrioridadTarea } from '@/types/database'

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
