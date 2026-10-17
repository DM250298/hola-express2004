/**
 * Lógica pura del calendario del turno (Tareas v2, Etapa 2).
 * Sin React: recibe la lista ya derivada (tareasAgenda.ts) y devuelve qué
 * dibujar: carriles por área o por persona, la posición de cada tarea
 * (minutos desde el inicio del turno, columnas si se pisan) y lo que va en
 * el panel lateral (ahora, atrasadas, lo que sigue, avance por persona).
 *
 * Unidades: todo en minutos de la línea del día de la agenda (tareasAgenda),
 * así que la noche de ayer cae en negativo y la de hoy pasa de 1440.
 */
import type { AreaTarea, TurnoPlantillaRow } from '@/types/database'
import type { ContextoReloj, TareaAgenda } from './tareasAgenda'

const DIA = 1440

// Copias de tareasAgenda.ts: este módulo solo importa tipos para que los
// tests corran con `node --test` sin compilar (igual que el resto).
function minutosDeHora(hora: string): number {
  const [h, m] = hora.split(':').map(Number)
  return h * 60 + (m || 0)
}
function cerradaSinHacer(estado: string): boolean {
  return estado === 'cancelada' || estado === 'no_se_pudo'
}

// ─── Áreas ─────────────────────────────────────────────────────────────────

export type ClaveArea = AreaTarea | 'sin_area'

export interface AreaDef {
  clave: ClaveArea
  nombre: string
  /** Color del área (borde y punto). */
  color: string
  /** Fondo suave de las tareas por hacer. */
  fondo: string
}

/** Orden y colores del lienzo "Tablero de tareas HEX". */
export const AREAS: AreaDef[] = [
  { clave: 'atencion_caja', nombre: 'Atención y caja', color: '#b5541c', fondo: '#fdeee2' },
  { clave: 'produccion_fiambreria', nombre: 'Producción y fiambrería', color: '#2f7a4b', fondo: '#e6f3ea' },
  { clave: 'reposicion_limpieza', nombre: 'Reposición, depósito y limpieza', color: '#1f5f8b', fondo: '#e4eff7' },
  { clave: 'control_seguridad', nombre: 'Control y seguridad', color: '#5a3f8f', fondo: '#eee8f6' },
  { clave: 'sin_area', nombre: 'Sin área', color: '#74635a', fondo: '#f3ece5' },
]

export function areaDe(clave: AreaTarea | null | undefined): AreaDef {
  return AREAS.find((a) => a.clave === (clave ?? 'sin_area')) ?? AREAS[AREAS.length - 1]
}

// ─── Rango del turno ───────────────────────────────────────────────────────

/** Minutos [desde, hasta) del turno en la línea del día de la agenda. */
export function rangoTurno(turno: TurnoPlantillaRow, origen: 'hoy' | 'ayer'): { desde: number; hasta: number } {
  const ini = minutosDeHora(turno.hora_inicio)
  let fin = minutosDeHora(turno.hora_fin)
  if (turno.cruza_medianoche || fin <= ini) fin += DIA
  const corrimiento = origen === 'ayer' ? -DIA : 0
  return { desde: ini + corrimiento, hasta: fin + corrimiento }
}

/** Marcas de hora para el eje (cada 60 min, alineadas a la hora en punto). */
export function marcasHora(desde: number, hasta: number): number[] {
  const res: number[] = []
  for (let m = Math.ceil(desde / 60) * 60; m <= hasta; m += 60) res.push(m)
  return res
}

// ─── Filtros ───────────────────────────────────────────────────────────────

export type FiltroTipo = 'todas' | 'rutina' | 'puntuales'
export type VerPor = 'area' | 'persona'

export function filtrarTipo(lista: TareaAgenda[], filtro: FiltroTipo): TareaAgenda[] {
  if (filtro === 'todas') return lista
  return lista.filter((x) => (filtro === 'rutina' ? x.tarea.origen === 'rutina' : x.tarea.origen === 'puntual'))
}

/** "Todo el turno": recordatorios y tareas sin horario. Van en la franja de arriba. */
export function esTodoElTurno(x: TareaAgenda): boolean {
  return x.tarea.tipo_actividad === 'continua' || x.derivado.inicio === null
}

// ─── Posición en el calendario ─────────────────────────────────────────────

/** Duración que se dibuja: la real, o 30 min si no tiene. */
export const DURACION_DIBUJO_DEFAULT = 30
/** Menos de esto se muestra en una sola línea. */
export const UMBRAL_COMPACTA = 20

export interface Bloque {
  item: TareaAgenda
  /** Minutos desde el inicio del turno. */
  top: number
  /** Alto en minutos (mínimo 15 para que se pueda tocar). */
  alto: number
  /** Columna dentro de su grupo de tareas que se pisan (0..cols-1). */
  col: number
  cols: number
  compacta: boolean
}

function duracionDe(x: TareaAgenda): number {
  return x.tarea.duracion_min && x.tarea.duracion_min > 0 ? x.tarea.duracion_min : DURACION_DIBUJO_DEFAULT
}

/**
 * Ubica las tareas con hora de un carril. Las que se pisan van lado a lado:
 * se agrupan en racimos (cadenas de solapamiento) y dentro de cada racimo
 * cada tarea toma la primera columna libre; todas las del racimo comparten
 * la cantidad de columnas.
 */
export function ubicar(lista: TareaAgenda[], desdeTurno: number): Bloque[] {
  const con = lista
    .filter((x) => !esTodoElTurno(x))
    .map((x) => ({ x, ini: x.derivado.inicio as number, fin: (x.derivado.inicio as number) + duracionDe(x) }))
    .sort((a, b) => a.ini - b.ini || b.fin - a.fin || a.x.tarea.titulo.localeCompare(b.x.tarea.titulo, 'es'))

  const res: Bloque[] = []
  let racimo: { b: Bloque; fin: number }[] = []
  let finRacimo = Number.NEGATIVE_INFINITY

  const cerrar = () => {
    const cols = racimo.reduce((m, r) => Math.max(m, r.b.col + 1), 0)
    for (const r of racimo) r.b.cols = cols
    racimo = []
  }

  for (const c of con) {
    if (c.ini >= finRacimo && racimo.length) cerrar()
    const ocupadas = new Set(racimo.filter((r) => r.fin > c.ini).map((r) => r.b.col))
    let col = 0
    while (ocupadas.has(col)) col++
    const dur = c.fin - c.ini
    const b: Bloque = {
      item: c.x,
      top: c.ini - desdeTurno,
      alto: Math.max(dur, 15),
      col,
      cols: 1,
      compacta: dur < UMBRAL_COMPACTA,
    }
    res.push(b)
    racimo.push({ b, fin: c.fin })
    finRacimo = Math.max(finRacimo, c.fin)
  }
  if (racimo.length) cerrar()
  return res
}

// ─── Carriles ──────────────────────────────────────────────────────────────

export interface Persona {
  id: number
  nombre: string
  /** Puesto para mostrar debajo del nombre. */
  puesto?: string | null
}

export interface Carril {
  clave: string
  titulo: string
  subtitulo?: string
  color: string
  fondo: string
  /** Carril de privadas: "Solo administradores". */
  privado?: boolean
  tareas: TareaAgenda[]
}

const PRIVADO: Omit<Carril, 'tareas'> = {
  clave: 'privadas',
  titulo: 'Solo administradores',
  subtitulo: 'Privadas',
  color: '#7a1f2b',
  fondo: '#f8e5e7',
  privado: true,
}

/** Dueños de una tarea: el responsable o los participantes de la grupal. */
export function duenosDe(x: TareaAgenda): number[] {
  if (x.tarea.empleado_id !== null) return [x.tarea.empleado_id]
  return (x.tarea.tareas_turno_participantes ?? []).map((p) => p.empleado_id)
}

/**
 * Arma los carriles. Por área: las cuatro áreas siempre (y "Sin área" si
 * hace falta). Por persona: quienes trabajan el turno y cualquier otro
 * dueño de una tarea; las grupales aparecen en el carril de cada
 * participante; "Sin asignar" si queda alguna sin dueño. Las privadas van
 * siempre a su carril (solo llegan si quien mira es administrador).
 */
export function carriles(lista: TareaAgenda[], verPor: VerPor, personas: Persona[]): Carril[] {
  const privadas = lista.filter((x) => x.tarea.privada)
  const resto = lista.filter((x) => !x.tarea.privada)
  const res: Carril[] = []

  if (verPor === 'area') {
    for (const a of AREAS) {
      const tareas = resto.filter((x) => (x.tarea.area ?? 'sin_area') === a.clave)
      if (a.clave === 'sin_area' && tareas.length === 0) continue
      res.push({ clave: a.clave, titulo: a.nombre, color: a.color, fondo: a.fondo, tareas })
    }
  } else {
    const ids: number[] = personas.map((p) => p.id)
    for (const x of resto) for (const id of duenosDe(x)) if (!ids.includes(id)) ids.push(id)
    for (const id of ids) {
      const p = personas.find((q) => q.id === id)
      res.push({
        clave: `p${id}`,
        titulo: p?.nombre ?? `Legajo ${id}`,
        subtitulo: p?.puesto ?? (p ? undefined : 'No figura en el turno'),
        color: '#3e1013',
        fondo: '#f6efe8',
        tareas: resto.filter((x) => duenosDe(x).includes(id)),
      })
    }
    const sinDueno = resto.filter((x) => duenosDe(x).length === 0)
    if (sinDueno.length) {
      res.push({ clave: 'sin_asignar', titulo: 'Sin asignar', color: '#a3271d', fondo: '#fbe2df', tareas: sinDueno })
    }
  }
  if (privadas.length) res.push({ ...PRIVADO, tareas: privadas })
  return res
}

// ─── Estilo por estado ─────────────────────────────────────────────────────

export type EstiloCalendario = 'por_hacer' | 'en_curso' | 'atrasada' | 'hecha' | 'no_se_pudo' | 'cancelada'

export function estiloCalendario(x: TareaAgenda): EstiloCalendario {
  const e = x.derivado.estado
  if (e === 'completada') return 'hecha'
  if (e === 'no_se_pudo') return 'no_se_pudo'
  if (e === 'omitida' || e === 'trasladada') return 'cancelada'
  if (x.derivado.atrasada) return 'atrasada'
  if (e === 'en_curso') return 'en_curso'
  return 'por_hacer'
}

/** Minutos de atraso (0 si no está atrasada o la agenda no es de hoy). */
export function minutosAtraso(x: TareaAgenda, reloj: ContextoReloj): number {
  if (!x.derivado.atrasada || x.derivado.limite === null || !Number.isFinite(reloj.ahora)) return 0
  return Math.max(0, Math.round(reloj.ahora - x.derivado.limite))
}

// ─── Panel lateral ─────────────────────────────────────────────────────────

export interface Panel {
  /** En curso o que tocan ahora. */
  ahora: TareaAgenda[]
  /** Atrasadas, la más vieja primero. */
  atrasadas: TareaAgenda[]
  /** Las próximas que todavía no empezaron (hasta `cuantas`). */
  sigue: TareaAgenda[]
}

export function panelLateral(lista: TareaAgenda[], cuantas = 4): Panel {
  const marcables = lista.filter((x) => x.tarea.tipo_actividad !== 'continua')
  const porInicio = (a: TareaAgenda, b: TareaAgenda) =>
    (a.derivado.inicio ?? Number.POSITIVE_INFINITY) - (b.derivado.inicio ?? Number.POSITIVE_INFINITY)
  return {
    ahora: marcables
      .filter((x) => !x.derivado.atrasada && (x.derivado.estado === 'en_curso' || x.derivado.estado === 'ahora'))
      .sort(porInicio),
    atrasadas: marcables.filter((x) => x.derivado.atrasada).sort(porInicio),
    sigue: marcables.filter((x) => x.derivado.estado === 'futura').sort(porInicio).slice(0, cuantas),
  }
}

export interface Avance {
  id: number
  nombre: string
  hechas: number
  total: number
}

/**
 * Avance por persona: las marcables que no se cerraron sin hacer. Una
 * grupal cuenta para cada participante (con que uno la haga alcanza).
 */
export function avancePorPersona(lista: TareaAgenda[], personas: Persona[]): Avance[] {
  return personas
    .map((p) => {
      const suyas = lista.filter(
        (x) =>
          !x.tarea.privada &&
          x.tarea.tipo_actividad !== 'continua' &&
          !cerradaSinHacer(x.tarea.estado) &&
          duenosDe(x).includes(p.id)
      )
      return {
        id: p.id,
        nombre: p.nombre,
        hechas: suyas.filter((x) => x.tarea.estado === 'completada').length,
        total: suyas.length,
      }
    })
    .filter((a) => a.total > 0)
}

export interface Juntadas {
  id: number
  /** Minuto (línea del día) en que se juntan más. */
  desde: number
  cantidad: number
}

/**
 * A quién se le juntan `umbral` o más tareas a la vez (abiertas, con hora,
 * no recordatorios). Devuelve el pico de cada persona.
 */
export function tareasJuntas(lista: TareaAgenda[], umbral = 3): Juntadas[] {
  const porPersona = new Map<number, { ini: number; fin: number }[]>()
  for (const x of lista) {
    if (esTodoElTurno(x) || cerradaSinHacer(x.tarea.estado) || x.tarea.estado === 'completada') continue
    const ini = x.derivado.inicio as number
    for (const id of duenosDe(x)) {
      const arr = porPersona.get(id) ?? []
      arr.push({ ini, fin: ini + duracionDe(x) })
      porPersona.set(id, arr)
    }
  }
  const res: Juntadas[] = []
  for (const [id, arr] of porPersona) {
    const eventos = arr
      .flatMap((r) => [
        { m: r.ini, d: 1 },
        { m: r.fin, d: -1 },
      ])
      .sort((a, b) => a.m - b.m || a.d - b.d)
    let cur = 0
    let pico = { m: 0, n: 0 }
    for (const ev of eventos) {
      cur += ev.d
      if (cur > pico.n) pico = { m: ev.m, n: cur }
    }
    if (pico.n >= umbral) res.push({ id, desde: pico.m, cantidad: pico.n })
  }
  return res
}
