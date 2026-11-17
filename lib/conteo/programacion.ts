/**
 * Sesiones de conteo programadas (migs 330 a 333): lógica pura que comparten
 * el wizard, la sección "Programadas" del hub y el test (`node --test`: solo
 * imports de tipos con alias, nunca de valores).
 */
import type { ConteoProgramacionRow, Json } from '@/types/database'

/** Argentina no tiene horario de verano: el desfase es fijo (patrón del repo). */
export const OFFSET_AR = '-03:00'
export const ZONA_AR = 'America/Argentina/La_Rioja'
/** Cuánto espera el proceso con otra sesión viva antes de darla por fallida (mig 332). */
export const ESPERA_MAX_MIN = 60
/** Mismas reglas que fn_conteo_validar_programada_para (mig 330). */
export const MIN_ADELANTO_MIN = 2
export const MAX_DIAS_ADELANTE = 90

const MS_MIN = 60_000
const MS_DIA = 24 * 60 * MS_MIN
/** Vencida hace menos que esto y sin error: el proceso la está abriendo. */
const MARGEN_ABRIENDO_MS = 2 * MS_MIN
/** Las abiertas de estos días se muestran en gris debajo de las pendientes. */
const DIAS_RECIENTES = 7

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/
const RE_HORA = /^\d{2}:\d{2}$/

/** "2026-11-19" + "08:00" → "2026-11-19T08:00:00-03:00", o null si falta algo. */
export function combinarFechaHora(fecha: string, hora: string): string | null {
  if (!RE_FECHA.test(fecha) || !RE_HORA.test(hora)) return null
  const iso = `${fecha}T${hora}:00${OFFSET_AR}`
  return Number.isNaN(Date.parse(iso)) ? null : iso
}

/** Fecha (yyyy-MM-dd) y hora (HH:mm) de un instante, vistas desde Argentina. */
export function partesAr(ms: number): { fecha: string; hora: string } {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_AR,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms))
  const de = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? ''
  return {
    fecha: `${de('year')}-${de('month')}-${de('day')}`,
    hora: `${de('hour')}:${de('minute')}`,
  }
}

/** "HH:mm" en Argentina de un timestamptz ISO. */
export function horaAr(iso: string): string {
  return partesAr(Date.parse(iso)).hora
}

/** Lo que propone el wizard: mañana a las 07:00 (arranque del turno mañana). */
export function fechaHoraPorDefecto(ahoraMs: number): { fecha: string; hora: string } {
  return { fecha: partesAr(ahoraMs + MS_DIA).fecha, hora: '07:00' }
}

export type ValidacionProgramacion =
  | { ok: true; iso: string }
  | { ok: false; motivo: string }

/** Misma regla que la base (mig 330), para avisar antes de mandar. */
export function validarProgramacion(
  fecha: string,
  hora: string,
  ahoraMs: number
): ValidacionProgramacion {
  const iso = combinarFechaHora(fecha, hora)
  if (!iso) return { ok: false, motivo: 'Elegí fecha y hora.' }
  const ms = Date.parse(iso)
  if (ms < ahoraMs + MIN_ADELANTO_MIN * MS_MIN) {
    return { ok: false, motivo: 'La fecha y hora ya pasaron: usá "Abrir ahora".' }
  }
  if (ms > ahoraMs + MAX_DIAS_ADELANTE * MS_DIA) {
    return { ok: false, motivo: `Como mucho ${MAX_DIAS_ADELANTE} días adelante.` }
  }
  return { ok: true, iso }
}

export type ClaveEstadoProgramacion =
  | 'futura'
  | 'por_abrir'
  | 'esperando'
  | 'demorada'
  | 'fallida'
  | 'abierta'
  | 'cancelada'

export interface EstadoProgramacion {
  clave: ClaveEstadoProgramacion
  etiqueta: string
  /** Motivo o aclaración para mostrar debajo; null si no hace falta. */
  detalle: string | null
  /** true = en rojo: hace falta que alguien haga algo. */
  alerta: boolean
}

/** Lo que decide el estado (así el test no arma la fila entera). */
export type ProgramacionParaEstado = Pick<
  ConteoProgramacionRow,
  'estado' | 'programada_para' | 'ultimo_error' | 'abierta_at' | 'abierta_por'
>

/**
 * Estado derivado en cliente. La base solo distingue programada / abierta /
 * cancelada / fallida; acá se lee además si venció y qué dijo el proceso.
 */
export function estadoProgramacion(
  p: ProgramacionParaEstado,
  ahoraMs: number
): EstadoProgramacion {
  if (p.estado === 'abierta') {
    return {
      clave: 'abierta',
      etiqueta: p.abierta_por ? 'Abierta a mano' : 'Se abrió sola',
      detalle: null,
      alerta: false,
    }
  }
  if (p.estado === 'cancelada') {
    return { clave: 'cancelada', etiqueta: 'Cancelada', detalle: null, alerta: false }
  }
  if (p.estado === 'fallida') {
    return {
      clave: 'fallida',
      etiqueta: 'No se abrió',
      detalle: p.ultimo_error ?? 'Sin motivo registrado.',
      alerta: true,
    }
  }
  const vence = Date.parse(p.programada_para)
  if (vence > ahoraMs) {
    return { clave: 'futura', etiqueta: 'Programada', detalle: null, alerta: false }
  }
  if (p.ultimo_error) {
    return { clave: 'esperando', etiqueta: 'Esperando', detalle: p.ultimo_error, alerta: false }
  }
  if (ahoraMs - vence <= MARGEN_ABRIENDO_MS) {
    return {
      clave: 'por_abrir',
      etiqueta: 'Abriendo…',
      detalle: 'El sistema la abre en instantes.',
      alerta: false,
    }
  }
  return {
    clave: 'demorada',
    etiqueta: 'Demorada',
    detalle: `Debería haberse abierto a las ${horaAr(p.programada_para)}. Si en unos minutos no abre, abrila a mano.`,
    alerta: true,
  }
}

export interface TareaProgramada {
  nombre: string
  responsables: string[]
}

/** Las tareas guardadas en la receta (`zonas`), para listarlas sin abrir nada. */
export function tareasDeProgramacion(zonas: Json): TareaProgramada[] {
  if (!Array.isArray(zonas)) return []
  const tareas: TareaProgramada[] = []
  for (const z of zonas) {
    if (!z || typeof z !== 'object' || Array.isArray(z)) continue
    const nombre = typeof z.nombre === 'string' ? z.nombre : ''
    let responsables: string[] = []
    if (Array.isArray(z.responsables)) {
      responsables = z.responsables.filter((r): r is string => typeof r === 'string')
    } else if (typeof z.responsable_user_id === 'string') {
      responsables = [z.responsable_user_id]
    }
    tareas.push({ nombre, responsables })
  }
  return tareas
}

export interface ProgramacionesOrdenadas {
  /** Programadas y fallidas, la más próxima primero. */
  pendientes: ConteoProgramacionRow[]
  /** Abiertas en los últimos días, la más nueva primero. */
  recientes: ConteoProgramacionRow[]
}

export function ordenarProgramaciones(
  filas: ConteoProgramacionRow[],
  ahoraMs: number
): ProgramacionesOrdenadas {
  const pendientes = filas
    .filter((f) => f.estado === 'programada' || f.estado === 'fallida')
    .sort((a, b) => Date.parse(a.programada_para) - Date.parse(b.programada_para))
  const desde = ahoraMs - DIAS_RECIENTES * MS_DIA
  const recientes = filas
    .filter((f) => f.estado === 'abierta' && f.abierta_at !== null && Date.parse(f.abierta_at) >= desde)
    .sort((a, b) => Date.parse(b.abierta_at ?? '') - Date.parse(a.abierta_at ?? ''))
  return { pendientes, recientes }
}

/** Hay una programada ya vencida: la pantalla vigila la sesión activa más seguido. */
export function hayPendienteVencida(filas: ConteoProgramacionRow[], ahoraMs: number): boolean {
  return filas.some(
    (f) => f.estado === 'programada' && Date.parse(f.programada_para) <= ahoraMs
  )
}
