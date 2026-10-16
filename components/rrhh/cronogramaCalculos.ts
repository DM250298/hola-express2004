/**
 * Lógica pura de la pestaña Cronograma (sin React, sin Supabase).
 *
 *  · Planificación y fichadas se calculan por separado: una celda de plan nunca
 *    mira `asistencia_diaria`, y el estado de fichada nunca inventa ausencias.
 *  · Fechas yyyy-MM-dd. "Hoy" siempre viene de `hoyAr()` (hora argentina).
 *  · La noche se imputa al día en que EMPIEZA (`horarios_asignados.fecha`): las
 *    horas de la noche del domingo cuentan en la semana del domingo.
 */
import { duracionTurno } from './tareasAgenda'
import { ORDEN_ROL_OPERATIVO, nombreCompleto } from './constantes'
import { formatearTardanza, horaAr, type TonoFichada } from './asistenciaConstantes'
import type {
  AsistenciaDiariaRow,
  DotacionRequeridaRow,
  EmpleadoRow,
  HorarioAsignadoRow,
  RolOperativo,
  TurnoPlantillaRow,
} from '@/types/database'

export type EmpleadoCrono = Pick<
  EmpleadoRow,
  'id' | 'nombre' | 'apellido' | 'legajo' | 'rol_operativo' | 'activo'
>

/** 0 = domingo … 6 = sábado (mismo criterio que `extract(dow)` en Postgres). */
export function dowDe(fecha: string): number {
  return new Date(`${fecha}T00:00:00`).getDay()
}

/** "06–14" · "22–06 +1" (la noche termina al día siguiente). */
export function etiquetaHorasCorta(t: TurnoPlantillaRow): string {
  const ini = t.hora_inicio.slice(0, 5)
  const fin = t.hora_fin.slice(0, 5)
  return `${ini}–${fin}${t.cruza_medianoche ? ' +1' : ''}`
}

/** ¿La fila cuenta como trabajo planificado con turno? */
export function esTurnoPlanificado(h: HorarioAsignadoRow | undefined): h is HorarioAsignadoRow {
  return !!h && !!h.turno_id && (h.estado === 'planificado' || h.estado === 'cubierto')
}

/**
 * Minutos BRUTOS planificados en la semana (duración del turno, sin descontar
 * descansos: no hay descansos configurados). No son horas trabajadas ni liquidables.
 */
export function minutosSemana(
  horarios: HorarioAsignadoRow[],
  turnoPorId: Map<number, TurnoPlantillaRow>
): number {
  let total = 0
  for (const h of horarios) {
    if (!esTurnoPlanificado(h)) continue
    const t = turnoPorId.get(h.turno_id as number)
    if (t) total += duracionTurno(t)
  }
  return total
}

/** 480 → "8 h" · 510 → "8,5 h". */
export function formatearHoras(min: number): string {
  const h = Math.round((min / 60) * 10) / 10
  return `${h.toLocaleString('es-AR')} h`
}

// ─── Notas: "Cubre a X (Puesto) · observación" ───────────────────────────────

export interface NotaPlan {
  cubreA: { nombre: string; puesto: string | null } | null
  observacion: string | null
}

const RE_CUBRE = /^Cubre a (.+?)(?: \(([^)]+)\))?(?: · ([\s\S]*))?$/

/** Misma convención que fn_generar_cronograma (mig 247): `Cubre a Nombre (Puesto)`. */
export function parseNota(notas: string | null | undefined): NotaPlan {
  if (!notas) return { cubreA: null, observacion: null }
  const m = notas.match(RE_CUBRE)
  if (!m) return { cubreA: null, observacion: notas }
  return {
    cubreA: { nombre: m[1].trim(), puesto: m[2]?.trim() ?? null },
    observacion: m[3]?.trim() || null,
  }
}

export function armarNota(
  cubreA: { nombre: string; puesto: string | null } | null,
  observacion: string
): string | null {
  const obs = observacion.trim()
  if (!cubreA) return obs || null
  const base = `Cubre a ${cubreA.nombre}${cubreA.puesto ? ` (${cubreA.puesto})` : ''}`
  return obs ? `${base} · ${obs}` : base
}

// ─── Cobertura planificada del día ───────────────────────────────────────────

export interface CoberturaTurno {
  turno: TurnoPlantillaRow
  planificados: EmpleadoCrono[]
  porPuesto: Partial<Record<RolOperativo, number>>
  /** null = "Dotación requerida sin configurar" (no se inventan mínimos). */
  requerido: number | null
  faltan: number | null
}

/** Mínimo para (turno, fecha): el del día de semana si existe, si no el general. */
export function requeridoPara(
  dotacion: DotacionRequeridaRow[],
  turnoId: number,
  fecha: string
): number | null {
  const dow = dowDe(fecha)
  const delDia = dotacion.find((d) => d.turno_id === turnoId && d.dia_semana === dow)
  if (delDia) return delDia.minimo
  const general = dotacion.find((d) => d.turno_id === turnoId && d.dia_semana === null)
  return general ? general.minimo : null
}

/**
 * Cuenta PERSONAS asignadas por turno. No prueba presencia real ni que cada
 * puesto quede cubierto: para eso está el desglose por puesto y la vista Fichadas.
 */
export function coberturaDia(
  fecha: string,
  horarios: HorarioAsignadoRow[],
  turnos: TurnoPlantillaRow[],
  dotacion: DotacionRequeridaRow[],
  empleadoPorId: Map<number, EmpleadoCrono>
): CoberturaTurno[] {
  return turnos
    .filter((t) => t.activo)
    .map((turno) => {
      const planificados: EmpleadoCrono[] = []
      const porPuesto: Partial<Record<RolOperativo, number>> = {}
      for (const h of horarios) {
        if (h.fecha !== fecha || !esTurnoPlanificado(h) || h.turno_id !== turno.id) continue
        const e = empleadoPorId.get(h.empleado_id)
        if (!e) continue
        planificados.push(e)
        porPuesto[e.rol_operativo] = (porPuesto[e.rol_operativo] ?? 0) + 1
      }
      const requerido = requeridoPara(dotacion, turno.id, fecha)
      return {
        turno,
        planificados: ordenarEmpleados(planificados),
        porPuesto,
        requerido,
        faltan: requerido === null ? null : Math.max(0, requerido - planificados.length),
      }
    })
}

// ─── Estado de fichada (vista Fichadas) ──────────────────────────────────────

export interface EstadoFichada {
  clave:
    | 'franco'
    | 'licencia'
    | 'sin_turno'
    | 'ficho_sin_turno'
    | 'programado'
    | 'aun_no'
    | 'sin_fichada'
    | 'en_curso'
    | 'presente'
    | 'tardanza'
    | 'incompleto'
    | 'ausente'
    | 'ausente_justificado'
    | 'revisar'
  label: string
  tono: TonoFichada
  /** Segunda línea opcional (motivo, aclaración). */
  detalle?: string
  /** "06:02–14:05" cuando hay marcaciones. */
  horas?: string
}

export interface ArgsEstadoFichada {
  fecha: string
  hoy: string
  /** HH:mm actual en hora AR; solo se usa para "hoy". */
  horaAhora?: string
  horario?: HorarioAsignadoRow
  turno?: TurnoPlantillaRow
  asistencia?: AsistenciaDiariaRow
  /** `periodo_hasta` de la última importación del reloj; null = nunca se importó. */
  ultimaImportHasta: string | null
}

function horasDe(a: AsistenciaDiariaRow): string | undefined {
  if (!a.entrada_real) return undefined
  return `${horaAr(a.entrada_real)}–${a.salida_real ? horaAr(a.salida_real) : '…'}`
}

/**
 * Deriva un estado legible SIN marcar ausencia por celda vacía ni por falta de
 * importación: un día pasado sin fichadas solo es "Ausente" si el reloj ya se
 * importó hasta esa fecha; si no, es "Revisar fichada".
 */
export function estadoFichada(a: ArgsEstadoFichada): EstadoFichada {
  const { fecha, hoy, horario, turno, asistencia } = a
  if (horario?.estado === 'franco') return { clave: 'franco', label: 'Franco', tono: 'neutro' }
  if (horario?.estado === 'licencia') return { clave: 'licencia', label: 'Licencia', tono: 'neutro' }

  const conMarcas = !!asistencia && asistencia.marcaciones > 0
  const tieneTurno = esTurnoPlanificado(horario) && !!turno

  if (!tieneTurno) {
    if (conMarcas && asistencia) {
      return { clave: 'ficho_sin_turno', label: 'Fichó sin turno', tono: 'atencion', horas: horasDe(asistencia) }
    }
    return { clave: 'sin_turno', label: 'Sin turno asignado', tono: 'neutro' }
  }

  if (fecha > hoy) return { clave: 'programado', label: 'Programado', tono: 'neutro' }

  if (fecha === hoy) {
    if (conMarcas && asistencia) {
      if (asistencia.salida_real && asistencia.marcaciones >= 2) {
        return asistencia.minutos_tardanza > 0
          ? { clave: 'tardanza', label: `Tardanza ${formatearTardanza(asistencia.minutos_tardanza)}`, tono: 'atencion', horas: horasDe(asistencia) }
          : { clave: 'presente', label: 'Presente', tono: 'ok', horas: horasDe(asistencia) }
      }
      return {
        clave: 'en_curso',
        label: `Entrada ${horaAr(asistencia.entrada_real)}`,
        tono: 'ok',
        detalle: asistencia.minutos_tardanza > 0 ? `Tardanza ${formatearTardanza(asistencia.minutos_tardanza)}` : undefined,
      }
    }
    const inicio = turno.hora_inicio.slice(0, 5)
    if (a.horaAhora && a.horaAhora < inicio) {
      return { clave: 'aun_no', label: 'Aún no corresponde', tono: 'neutro', detalle: `Empieza ${inicio}` }
    }
    return { clave: 'sin_fichada', label: 'Sin fichada todavía', tono: 'neutro' }
  }

  // Día pasado con turno.
  switch (asistencia?.estado) {
    case 'presente':
      return { clave: 'presente', label: 'Presente', tono: 'ok', horas: horasDe(asistencia) }
    case 'tardanza':
      return { clave: 'tardanza', label: `Tardanza ${formatearTardanza(asistencia.minutos_tardanza)}`, tono: 'atencion', horas: horasDe(asistencia) }
    case 'incompleto':
      return {
        clave: 'incompleto',
        label: 'Revisar fichada',
        tono: 'atencion',
        detalle: `${asistencia.marcaciones} marcación`,
        horas: horasDe(asistencia),
      }
    case 'ausente_justificado':
      return { clave: 'ausente_justificado', label: 'Ausente justificado', tono: 'neutro' }
    case 'ausente_injustificado':
      if (a.ultimaImportHasta && a.ultimaImportHasta >= fecha) {
        return { clave: 'ausente', label: 'Ausente', tono: 'problema', detalle: 'Sin marcaciones en el reloj' }
      }
      return { clave: 'revisar', label: 'Revisar fichada', tono: 'atencion', detalle: 'Falta importar el reloj' }
    case 'sin_turno':
      // Fichó y después se le cargó el turno: hay marcaciones, no es ausencia.
      return { clave: 'presente', label: 'Presente', tono: 'ok', horas: horasDe(asistencia), detalle: 'Recalcular' }
    default:
      return { clave: 'revisar', label: 'Revisar fichada', tono: 'atencion', detalle: 'Día sin cerrar' }
  }
}

// ─── Orden de filas ──────────────────────────────────────────────────────────

const POS_ROL = new Map(ORDEN_ROL_OPERATIVO.map((r, i) => [r, i]))

/** Por puesto (organigrama) y después por nombre. */
export function ordenarEmpleados<T extends EmpleadoCrono>(lista: T[]): T[] {
  return [...lista].sort((a, b) => {
    const pa = POS_ROL.get(a.rol_operativo) ?? 99
    const pb = POS_ROL.get(b.rol_operativo) ?? 99
    if (pa !== pb) return pa - pb
    return nombreCompleto(a).localeCompare(nombreCompleto(b), 'es')
  })
}
