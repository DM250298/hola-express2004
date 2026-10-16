/**
 * Lógica pura de la agenda por turno (Personal › Tareas › Agenda del día).
 * Sin React: todo recibe datos y devuelve datos, para poder razonarla y
 * testearla aparte.
 *
 * Convenciones:
 *  · `tareas_turno.fecha` es el día en que EMPIEZA el turno. La noche del
 *    lunes (22→06) tiene fecha lunes aunque termine el martes.
 *  · La línea de tiempo de la agenda del día D va de 00:00 a 24:00 de D en
 *    minutos (0..1440). Una tarea de la noche de D−1 con hora 01:00 cae en
 *    el minuto 60 de D; una de la noche de D con hora 01:00 cae en 1500
 *    (ya es "mañana" visto desde D).
 *  · "Ahora" se calcula SIEMPRE con la hora argentina (hoyAr / horaActualAr).
 */
import type { HorarioAsignadoRow, TurnoPlantillaRow } from '@/types/database'
import type { TareaConParticipantes } from '@/lib/queries/tareas'
import type { EstadoDerivado } from './tareasConstantes'

const DIA = 1440

/** "07:20:00" | "07:20" → 440. */
export function minutosDeHora(hora: string): number {
  const [h, m] = hora.split(':').map(Number)
  return h * 60 + (m || 0)
}

/** 440 → "07:20". 1500 → "01:00" (se normaliza al día). */
export function horaDeMinutos(min: number): string {
  const m = ((min % DIA) + DIA) % DIA
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** Rango legible de un turno: "22:00 — 06:00 (+1 día)". */
export function etiquetaHorarioTurno(t: TurnoPlantillaRow): string {
  const ini = t.hora_inicio.slice(0, 5)
  const fin = t.hora_fin.slice(0, 5)
  return t.cruza_medianoche ? `${ini} — ${fin} (+1 día)` : `${ini} — ${fin}`
}

/** Duración del turno en minutos (maneja el cruce de medianoche). */
export function duracionTurno(t: TurnoPlantillaRow): number {
  const ini = minutosDeHora(t.hora_inicio)
  const fin = minutosDeHora(t.hora_fin)
  return t.cruza_medianoche ? fin + DIA - ini : fin - ini
}

// ─── Cobertura 00:00–24:00 ─────────────────────────────────────────────────

export interface SegmentoDia {
  /** null = hueco sin cobertura. */
  turno: TurnoPlantillaRow | null
  /** Minutos desde 00:00 del día de la agenda. */
  desde: number
  hasta: number
  /** 'ayer' = es la cola de un turno nocturno que empezó el día anterior. */
  origen: 'hoy' | 'ayer'
}

/**
 * Parte el día en franjas según los turnos activos. Un turno que cruza
 * medianoche aporta dos franjas: [inicio, 24:00) de hoy y [00:00, fin) como
 * cola del de ayer. Los huecos quedan con turno null.
 */
export function segmentosDia(turnos: TurnoPlantillaRow[]): SegmentoDia[] {
  const seg: SegmentoDia[] = []
  for (const t of turnos.filter((x) => x.activo)) {
    const ini = minutosDeHora(t.hora_inicio)
    const fin = minutosDeHora(t.hora_fin)
    if (t.cruza_medianoche) {
      if (fin > 0) seg.push({ turno: t, desde: 0, hasta: fin, origen: 'ayer' })
      seg.push({ turno: t, desde: ini, hasta: DIA, origen: 'hoy' })
    } else if (fin > ini) {
      seg.push({ turno: t, desde: ini, hasta: fin, origen: 'hoy' })
    }
  }
  seg.sort((a, b) => a.desde - b.desde)
  // Huecos (y solapamientos: el que empieza antes manda).
  const res: SegmentoDia[] = []
  let cursor = 0
  for (const s of seg) {
    if (s.desde > cursor) res.push({ turno: null, desde: cursor, hasta: s.desde, origen: 'hoy' })
    if (s.hasta > cursor) {
      res.push({ ...s, desde: Math.max(s.desde, cursor) })
      cursor = s.hasta
    }
  }
  if (cursor < DIA) res.push({ turno: null, desde: cursor, hasta: DIA, origen: 'hoy' })
  return res
}

/** Turno que contiene la hora dada (minutos del día), o null si es un hueco. */
export function turnoEnMinuto(segmentos: SegmentoDia[], min: number): SegmentoDia | null {
  return segmentos.find((s) => s.turno && min >= s.desde && min < s.hasta) ?? null
}

// ─── Selección y filtrado ──────────────────────────────────────────────────

/** Qué se está mirando: un turno que empieza en la fecha de la agenda, o la cola de la noche de ayer. */
export interface SeleccionTurno {
  turnoId: number
  origen: 'hoy' | 'ayer'
}

/** Fecha (yyyy-MM-dd) en que empieza el turno seleccionado. */
export function fechaDeSeleccion(sel: SeleccionTurno, fecha: string, ayer: string): string {
  return sel.origen === 'ayer' ? ayer : fecha
}

/**
 * Minuto absoluto (en la línea del día de la agenda) en que empieza una
 * tarea. null si no tiene hora. Resuelve el cruce de medianoche: una hora
 * menor que la de inicio de un turno nocturno es "del día siguiente".
 */
export function inicioAbsoluto(
  t: { hora: string | null; fecha: string },
  turno: TurnoPlantillaRow | null,
  fechaAgenda: string
): number | null {
  if (!t.hora) return null
  let min = minutosDeHora(t.hora)
  if (turno?.cruza_medianoche && min < minutosDeHora(turno.hora_inicio)) min += DIA
  if (t.fecha < fechaAgenda) min -= DIA
  else if (t.fecha > fechaAgenda) min += DIA
  return min
}

/** Las tareas del turno seleccionado (todas las que empiezan ese día en ese turno). */
export function tareasDeSeleccion(
  tareas: TareaConParticipantes[],
  sel: SeleccionTurno,
  fechaSel: string
): TareaConParticipantes[] {
  return tareas.filter((t) => t.turno_id === sel.turnoId && t.fecha === fechaSel)
}

/** Las de la fecha sin turno asignado (se muestran aparte). */
export function tareasSinTurno(tareas: TareaConParticipantes[], fecha: string) {
  return tareas.filter((t) => t.turno_id === null && t.fecha === fecha)
}

// ─── Estado derivado ───────────────────────────────────────────────────────

export interface Derivado {
  estado: EstadoDerivado
  /** Ventana vencida y sigue abierta (aunque esté en curso). */
  atrasada: boolean
  /** Minuto absoluto de inicio en la línea del día (null = sin hora). */
  inicio: number | null
  /** Minuto absoluto en que vence la ventana (null = sin hora). */
  limite: number | null
}

export const VENTANA_DEFAULT_MIN = 30

export interface ContextoReloj {
  /** Minuto actual en la línea del día de la agenda; -∞ si la agenda es futura, +∞ si es pasada. */
  ahora: number
}

/** Construye el contexto de reloj para una fecha de agenda. */
export function contextoReloj(fechaAgenda: string, hoy: string, horaAhora: string): ContextoReloj {
  if (fechaAgenda === hoy) return { ahora: minutosDeHora(horaAhora) }
  if (fechaAgenda < hoy) return { ahora: Number.POSITIVE_INFINITY }
  return { ahora: Number.NEGATIVE_INFINITY }
}

export function estadoDerivado(
  t: TareaConParticipantes,
  turno: TurnoPlantillaRow | null,
  fechaAgenda: string,
  reloj: ContextoReloj
): Derivado {
  const inicio = inicioAbsoluto(t, turno, fechaAgenda)
  const ventana = t.ventana_min ?? t.duracion_min ?? VENTANA_DEFAULT_MIN
  const limite = inicio === null ? null : inicio + ventana
  const base = { inicio, limite }
  if (t.estado === 'completada') return { ...base, estado: 'completada', atrasada: false }
  if (t.estado === 'cancelada')
    return { ...base, estado: t.trasladada_a ? 'trasladada' : 'omitida', atrasada: false }
  if (t.estado === 'vencida') return { ...base, estado: 'vencida', atrasada: true }
  const atrasada = limite !== null && reloj.ahora >= limite
  if (t.estado === 'en_curso') return { ...base, estado: 'en_curso', atrasada }
  // pendiente
  if (inicio === null) return { ...base, estado: 'pendiente', atrasada: false }
  if (reloj.ahora < inicio) return { ...base, estado: 'futura', atrasada: false }
  if (atrasada) return { ...base, estado: 'atrasada', atrasada: true }
  return { ...base, estado: 'ahora', atrasada: false }
}

export type TareaAgenda = { tarea: TareaConParticipantes; derivado: Derivado }

/** Orden cronológico: primero con hora (por inicio), después sin hora; empate por prioridad. */
export function ordenarCronologico(lista: TareaAgenda[]): TareaAgenda[] {
  const pri = { alta: 0, media: 1, baja: 2 }
  return [...lista].sort((a, b) => {
    const ia = a.derivado.inicio
    const ib = b.derivado.inicio
    if (ia === null && ib === null) return pri[a.tarea.prioridad] - pri[b.tarea.prioridad]
    if (ia === null) return 1
    if (ib === null) return -1
    if (ia !== ib) return ia - ib
    return pri[a.tarea.prioridad] - pri[b.tarea.prioridad]
  })
}

export const ABIERTAS: EstadoDerivado[] = ['futura', 'ahora', 'pendiente', 'en_curso', 'atrasada', 'vencida']

export function estaAbierta(d: Derivado): boolean {
  return ABIERTAS.includes(d.estado)
}

/**
 * Qué destacar arriba: lo que está en curso o toca ahora; si no, la
 * atrasada más vieja; si no, la próxima; si no, una pendiente sin hora.
 */
export type TipoFoco = 'ahora' | 'atrasada' | 'proxima' | 'pendiente'

export function focoDelTurno(lista: TareaAgenda[]): { tipo: TipoFoco; item: TareaAgenda } | null {
  const puntuales = lista.filter((x) => x.tarea.tipo_actividad !== 'continua')
  const enCurso = puntuales.find((x) => x.derivado.estado === 'en_curso' || x.derivado.estado === 'ahora')
  if (enCurso) return { tipo: 'ahora', item: enCurso }
  const atrasada = puntuales.find((x) => x.derivado.estado === 'atrasada' || x.derivado.estado === 'vencida')
  if (atrasada) return { tipo: 'atrasada', item: atrasada }
  const proxima = puntuales.find((x) => x.derivado.estado === 'futura')
  if (proxima) return { tipo: 'proxima', item: proxima }
  const pendiente = puntuales.find((x) => x.derivado.estado === 'pendiente')
  if (pendiente) return { tipo: 'pendiente', item: pendiente }
  return null
}

/** completadas / total, sin contar continuas ni canceladas. */
export function conteoTurno(lista: TareaAgenda[]): { hechas: number; total: number } {
  const cuentan = lista.filter(
    (x) => x.tarea.tipo_actividad !== 'continua' && x.tarea.estado !== 'cancelada'
  )
  return {
    hechas: cuentan.filter((x) => x.tarea.estado === 'completada').length,
    total: cuentan.length,
  }
}

// ─── Avisos: asignación, cobertura, carga ──────────────────────────────────

/** Individual sin responsable o grupal sin participantes. */
export function sinAsignar(t: TareaConParticipantes): boolean {
  if (t.estado === 'cancelada') return false
  if (t.empleado_id !== null) return false
  return (t.tareas_turno_participantes ?? []).length === 0
}

/** Quiénes están planificados/cubriendo un turno ese día (franco y licencia no cuentan). */
export function personasEnTurno(
  horarios: HorarioAsignadoRow[],
  turnoId: number,
  fecha: string
): number[] {
  return horarios
    .filter(
      (h) =>
        h.fecha === fecha &&
        h.turno_id === turnoId &&
        (h.estado === 'planificado' || h.estado === 'cubierto')
    )
    .map((h) => h.empleado_id)
}

export interface Solapamiento {
  empleadoId: number
  a: TareaConParticipantes
  b: TareaConParticipantes
}

/**
 * Dos tareas con hora y duración de la misma persona que se pisan. Solo
 * individuales (las grupales no cargan a nadie en particular).
 */
export function solapamientosPorPersona(lista: TareaAgenda[]): Solapamiento[] {
  const porPersona = new Map<number, TareaAgenda[]>()
  for (const x of lista) {
    const t = x.tarea
    if (
      t.empleado_id === null ||
      t.estado === 'cancelada' ||
      t.tipo_actividad === 'continua' ||
      x.derivado.inicio === null ||
      !t.duracion_min
    )
      continue
    const arr = porPersona.get(t.empleado_id) ?? []
    arr.push(x)
    porPersona.set(t.empleado_id, arr)
  }
  const res: Solapamiento[] = []
  for (const [empleadoId, arr] of porPersona) {
    const ord = [...arr].sort((a, b) => a.derivado.inicio! - b.derivado.inicio!)
    for (let i = 1; i < ord.length; i++) {
      const prev = ord[i - 1]
      const cur = ord[i]
      const finPrev = prev.derivado.inicio! + (prev.tarea.duracion_min ?? 0)
      if (cur.derivado.inicio! < finPrev) res.push({ empleadoId, a: prev.tarea, b: cur.tarea })
    }
  }
  return res
}

/** Minutos de tareas puntuales con duración por persona (carga del turno). */
export function cargaPorPersona(lista: TareaAgenda[]): Map<number, number> {
  const m = new Map<number, number>()
  for (const x of lista) {
    const t = x.tarea
    if (t.empleado_id === null || t.estado === 'cancelada' || t.tipo_actividad === 'continua') continue
    m.set(t.empleado_id, (m.get(t.empleado_id) ?? 0) + (t.duracion_min ?? 0))
  }
  return m
}

/** ¿El turno seleccionado ya terminó o está por terminar (para "pendientes para entregar")? */
export function turnoPorTerminar(
  turno: TurnoPlantillaRow,
  origen: 'hoy' | 'ayer',
  reloj: ContextoReloj,
  margenMin = 30
): boolean {
  let fin = turno.cruza_medianoche ? minutosDeHora(turno.hora_fin) + DIA : minutosDeHora(turno.hora_fin)
  if (origen === 'ayer') fin -= DIA
  return reloj.ahora >= fin - margenMin
}
