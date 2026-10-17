/**
 * Lógica pura de "Mi turno" en el celular (Tareas v2, Etapa 6).
 * Recibe las tareas ya derivadas (tareasAgenda.estadoDerivado) y solo usa
 * imports de tipos (los tests corren con `node --test`):
 *  · en qué sección va cada tarea (atrasadas, ahora, en curso, más tarde,
 *    todo el turno, recordatorios, ya pasaron);
 *  · el avance del día, el saludo y con quién estás de turno.
 */
import type { TareaAgenda } from './tareasAgenda'

export type SeccionesMiTurno = {
  /** Abiertas y pasadas de su horario; la más atrasada primero. */
  atrasadas: TareaAgenda[]
  /** Les toca ahora (dentro de su horario, sin empezar). */
  ahora: TareaAgenda[]
  /** Empezadas y todavía en horario (o sin hora). */
  enCurso: TareaAgenda[]
  /** Todavía no empezó su horario. */
  masTarde: TareaAgenda[]
  /** Sin hora: se hacen en cualquier momento del turno y se marcan. */
  todoElTurno: TareaAgenda[]
  /** Recordatorios de todo el turno: no se marcan. */
  recordatorios: TareaAgenda[]
  /** Hechas, "no se pudo", omitidas o pasadas al turno siguiente. */
  yaPasaron: TareaAgenda[]
  avance: { hechas: number; total: number }
}

const CERRADAS = new Set(['completada', 'no_se_pudo', 'omitida', 'trasladada'])

/** Reparte la lista (ya en orden cronológico) en las secciones de la pantalla. */
export function secciones(items: TareaAgenda[]): SeccionesMiTurno {
  const s: SeccionesMiTurno = {
    atrasadas: [], ahora: [], enCurso: [], masTarde: [], todoElTurno: [], recordatorios: [], yaPasaron: [],
    avance: { hechas: 0, total: 0 },
  }
  for (const x of items) {
    const d = x.derivado
    if (x.tarea.tipo_actividad === 'continua') {
      if (!CERRADAS.has(d.estado)) s.recordatorios.push(x)
      continue
    }
    if (d.estado !== 'no_se_pudo' && d.estado !== 'omitida' && d.estado !== 'trasladada') {
      s.avance.total++
      if (d.estado === 'completada') s.avance.hechas++
    }
    if (CERRADAS.has(d.estado)) s.yaPasaron.push(x)
    else if (d.atrasada) s.atrasadas.push(x)
    else if (d.estado === 'en_curso') s.enCurso.push(x)
    else if (d.estado === 'ahora') s.ahora.push(x)
    else if (d.estado === 'futura') s.masTarde.push(x)
    else s.todoElTurno.push(x)
  }
  // La que más tiempo lleva atrasada, primero.
  s.atrasadas.sort((a, b) => (a.derivado.limite ?? Infinity) - (b.derivado.limite ?? Infinity))
  // Lo último que pasó, arriba.
  s.yaPasaron.reverse()
  return s
}

/** Minutos de atraso de una tarea abierta (0 si no tiene hora o no está atrasada). */
export function minutosTarde(x: TareaAgenda, ahora: number): number {
  const l = x.derivado.limite
  if (l === null || !Number.isFinite(ahora) || ahora < l) return 0
  return Math.floor(ahora - l)
}

/** "Buen día", "Buenas tardes" o "Buenas noches" según la hora (HH:MM). */
export function saludo(hora: string): string {
  const h = Number(hora.slice(0, 2))
  if (h >= 5 && h < 12) return 'Buen día'
  if (h >= 12 && h < 20) return 'Buenas tardes'
  return 'Buenas noches'
}

export type CompaneroTurno = { turno_id: number; nombre: string; soy_yo: boolean }

/**
 * "Hoy estás con Rebeca y Tomás" a partir de fn_mi_turno. Si trabaja en más
 * de un turno ese día, usa el turno indicado (el de ahora) o el primero.
 */
export function companerosTexto(filas: CompaneroTurno[], turnoId: number | null): string | null {
  const mios = [...new Set(filas.filter((f) => f.soy_yo).map((f) => f.turno_id))]
  if (mios.length === 0) return null
  const turno = turnoId !== null && mios.includes(turnoId) ? turnoId : mios[0]
  const otros = filas.filter((f) => f.turno_id === turno && !f.soy_yo).map((f) => f.nombre.split(' ')[0])
  if (otros.length === 0) return 'Hoy no hay nadie más en tu turno.'
  const lista = otros.length === 1 ? otros[0] : `${otros.slice(0, -1).join(', ')} y ${otros[otros.length - 1]}`
  return `Hoy estás con ${lista}.`
}

/** Estado de cada paso del checklist (lo que no se tildó todavía es false). */
export function pasosHechos(checklist: string[], estado: unknown): boolean[] {
  const arr = Array.isArray(estado) ? estado : []
  return checklist.map((_, i) => arr[i] === true)
}
