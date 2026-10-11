import { addDays, format, parseISO, startOfWeek } from 'date-fns'
import { es } from 'date-fns/locale'
import type { TipoPatronCronograma } from '@/types/database'

export const TIPOS_PATRON: Record<TipoPatronCronograma, { label: string; ayuda: string }> = {
  franco_rotativo: {
    label: 'Francos rotativos (mañana / tarde)',
    ayuda:
      'Un franco por persona por semana. Cada semana el franco de cada uno avanza al siguiente día del orden elegido. Los días que no están en el orden nadie descansa. El pivote cubre el turno del que descansa.',
  },
  noche_ab: {
    label: 'Noche A/B (2 personas, ciclo de 14 días)',
    ayuda:
      'Semana A: lunes, martes, miércoles y domingo el 1º; jueves, viernes y sábado el 2º. Semana B al revés.',
  },
  bloques_alternados: {
    label: 'Bloques de días corridos alternados',
    ayuda:
      'Cada persona trabaja N días seguidos y después pasa a la siguiente de la lista, en rueda. Ej: noche de 7 días de jueves a miércoles, alternando dos personas.',
  },
}

/** Lunes (yyyy-MM-dd) de la semana que contiene la fecha. */
export function lunesDe(d: Date): string {
  return format(startOfWeek(d, { weekStartsOn: 1 }), 'yyyy-MM-dd')
}

/** Posiciones 0..6 desde el ancla → nombre del día (ej. ancla domingo: 0 = dom). */
export function nombreDiaDesdeAncla(ancla: string, posicion: number): string {
  if (!ancla) return '—'
  return format(addDays(parseISO(ancla), posicion), 'EEEE', { locale: es })
}

/** Abreviatura (3 letras) del día en la posición dada desde el ancla. */
export function abrevDiaDesdeAncla(ancla: string, posicion: number): string {
  if (!ancla) return '—'
  return format(addDays(parseISO(ancla), posicion), 'EEE', { locale: es }).replace('.', '')
}

export const ORDEN_DIAS_DEFAULT = [0, 1, 2, 3, 4, 5, 6]

/** true si la fecha ISO cae en lunes. */
export function esLunes(iso: string): boolean {
  if (!iso) return false
  return new Date(`${iso}T00:00:00`).getDay() === 1
}
