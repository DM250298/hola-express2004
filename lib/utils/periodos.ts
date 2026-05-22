import { endOfMonth, startOfMonth, subDays, subMonths } from 'date-fns'

export type ClavePeriodo =
  | 'hoy'
  | 'mes_actual'
  | 'mes_anterior'
  | 'ultimos_7'
  | 'personalizado'

export interface RangoFechas {
  desde: string // ISO yyyy-MM-dd 00:00
  hasta: string // ISO yyyy-MM-dd 23:59:59.999
}

function inicioDia(fecha: Date): Date {
  const d = new Date(fecha)
  d.setHours(0, 0, 0, 0)
  return d
}

function finDia(fecha: Date): Date {
  const d = new Date(fecha)
  d.setHours(23, 59, 59, 999)
  return d
}

export function rangoPredefinido(clave: ClavePeriodo): RangoFechas {
  const hoy = new Date()
  switch (clave) {
    case 'hoy':
      return {
        desde: inicioDia(hoy).toISOString(),
        hasta: finDia(hoy).toISOString(),
      }
    case 'mes_anterior': {
      const inicio = startOfMonth(subMonths(hoy, 1))
      const fin = endOfMonth(subMonths(hoy, 1))
      return {
        desde: inicioDia(inicio).toISOString(),
        hasta: finDia(fin).toISOString(),
      }
    }
    case 'ultimos_7':
      return {
        desde: inicioDia(subDays(hoy, 6)).toISOString(),
        hasta: finDia(hoy).toISOString(),
      }
    case 'mes_actual':
    case 'personalizado':
    default:
      return {
        desde: inicioDia(startOfMonth(hoy)).toISOString(),
        hasta: finDia(hoy).toISOString(),
      }
  }
}

export function rangoDesdeFechas(
  desde: string,
  hasta: string
): RangoFechas {
  return {
    desde: inicioDia(new Date(desde)).toISOString(),
    hasta: finDia(new Date(hasta)).toISOString(),
  }
}

/** Lunes de la semana que contiene la fecha dada (locale es-AR: semana empieza lunes). */
export function inicioSemana(fecha: Date): Date {
  const d = new Date(fecha)
  d.setHours(0, 0, 0, 0)
  const dia = d.getDay() // 0 (dom) - 6 (sáb)
  // Lunes = día 1; dom (0) cuenta como -6
  const diff = dia === 0 ? -6 : 1 - dia
  d.setDate(d.getDate() + diff)
  return d
}

export function claveSemana(fecha: Date): string {
  return inicioSemana(fecha).toISOString().slice(0, 10)
}

/** Lista de inicios de semana en un rango, de antiguo a reciente. */
export function semanasEnRango(desde: string, hasta: string): string[] {
  const inicio = inicioSemana(new Date(desde))
  const fin = inicioSemana(new Date(hasta))
  const claves: string[] = []
  const cursor = new Date(inicio)
  while (cursor <= fin) {
    claves.push(cursor.toISOString().slice(0, 10))
    cursor.setDate(cursor.getDate() + 7)
  }
  return claves
}
