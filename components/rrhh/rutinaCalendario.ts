/**
 * Lógica pura de la rutina en calendario (Tareas v2, Etapa 4).
 * Sin React y solo con imports de tipos (los tests corren con `node --test`):
 *  · arrastrar y estirar: minutos de a 15, sin salirse del turno;
 *  · en qué carril (área) cae una tarea al soltarla;
 *  · si una tarea de la rutina se hace un día dado;
 *  · pasar una plantilla al formulario de "Nueva tarea" y al calendario,
 *    y quedarse solo con lo que cambió para guardar.
 */
import type { TurnoPlantillaRow } from '@/types/database'
import type { PlantillaConAsignados, TareaConParticipantes } from '@/lib/queries/tareas'
import type { TareaAgenda } from './tareasAgenda'
import type { FormNuevaTarea } from './nuevaTareaLogica'

const DIA = 1440
export const PASO_MIN = 15

function minutos(hora: string): number {
  const [h, m] = hora.split(':').map(Number)
  return h * 60 + (m || 0)
}

export function hhmm(min: number): string {
  const m = ((min % DIA) + DIA) % DIA
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** Largo del turno en minutos (la noche cruza la medianoche). */
export function largoTurno(t: TurnoPlantillaRow): number {
  const l = (minutos(t.hora_fin) - minutos(t.hora_inicio) + DIA) % DIA
  return l === 0 ? DIA : l
}

export function redondear(min: number, paso = PASO_MIN): number {
  return Math.round(min / paso) * paso
}

/** Mueve una tarea: nuevo inicio (minutos desde el inicio del turno), de a 15 y dentro del turno. */
export function mover(inicio: number, duracion: number, deltaMin: number, largo: number): number {
  const nuevo = redondear(inicio + deltaMin)
  return Math.min(Math.max(0, nuevo), Math.max(0, largo - duracion))
}

/** Estira el borde de abajo: nueva duración, de a 15, mínimo 15 y sin pasarse del turno. */
export function estirar(inicio: number, duracion: number, deltaMin: number, largo: number): number {
  const nueva = redondear(duracion + deltaMin)
  return Math.min(Math.max(PASO_MIN, nueva), largo - inicio)
}

/** Índice del carril bajo la posición x (relativa al borde izquierdo de los carriles). */
export function indiceCarril(x: number, anchoCarriles: number, cantidad: number): number {
  if (cantidad <= 0 || anchoCarriles <= 0) return 0
  const i = Math.floor((x / anchoCarriles) * cantidad)
  return Math.min(Math.max(0, i), cantidad - 1)
}

/** ¿La tarea de la rutina se hace ese día (yyyy-MM-dd)? Misma regla que la base. */
export function aplicaEnDia(p: PlantillaConAsignados, fecha: string): boolean {
  if (!p.activa) return false
  if (p.vigencia_desde && fecha < p.vigencia_desde) return false
  if (p.vigencia_hasta && fecha > p.vigencia_hasta) return false
  const d = new Date(`${fecha}T12:00:00Z`)
  if (p.tipo_recurrencia === 'dias_semana') return (p.dias_semana ?? []).includes(d.getUTCDay())
  if (p.tipo_recurrencia === 'dia_mes') {
    if (!p.dia_mes) return false
    const ultimo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
    return d.getUTCDate() === p.dia_mes || (d.getUTCDate() === ultimo && p.dia_mes > ultimo)
  }
  if (p.tipo_recurrencia === 'cada_n_dias') {
    const base = p.fecha_base ?? p.created_at.slice(0, 10)
    if (!p.cada_n_dias || fecha < base) return false
    const dias = Math.round((Date.parse(`${fecha}T12:00:00Z`) - Date.parse(`${base}T12:00:00Z`)) / 86400000)
    return dias % p.cada_n_dias === 0
  }
  return false
}

/** Próxima fecha (desde `desde`, incluida) con ese día de la semana. */
export function proximoDia(desde: string, dow: number): string {
  const d = new Date(`${desde}T12:00:00Z`)
  const delta = (dow - d.getUTCDay() + 7) % 7
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}

/**
 * Plantilla como si fuera una tarea de la agenda, para reutilizar el
 * calendario (carriles por área, columnas si se pisan). `inicio` va en la
 * línea del día del turno: inicio del turno + minutos desde el inicio.
 */
export function comoTareaAgenda(p: PlantillaConAsignados, turno: TurnoPlantillaRow): TareaAgenda {
  const inicioTurno = minutos(turno.hora_inicio)
  const inicio = p.minutos_desde_inicio === null ? null : inicioTurno + p.minutos_desde_inicio
  const tarea = {
    id: p.id,
    plantilla_id: p.id,
    titulo: p.titulo,
    descripcion: p.descripcion,
    empleado_id: null,
    turno_id: p.turno_id,
    fecha: '',
    prioridad: p.prioridad,
    requiere_evidencia: p.requiere_evidencia,
    estado: 'pendiente',
    modo: p.modo,
    hora: null,
    duracion_min: p.duracion_min,
    tipo_actividad: p.tipo_actividad,
    checklist: p.checklist,
    origen: 'rutina',
    area: p.area,
    privada: p.privada,
    tareas_turno_participantes: [],
  } as unknown as TareaConParticipantes
  return {
    tarea,
    derivado: {
      estado: 'futura',
      atrasada: false,
      inicio,
      limite: inicio === null ? null : inicio + (p.duracion_min ?? 30),
    },
  }
}

/** La plantilla cargada en el formulario de "Nueva tarea" (modo rutina). */
export function formDesdePlantilla(p: PlantillaConAsignados, turno: TurnoPlantillaRow): FormNuevaTarea {
  const ini = p.minutos_desde_inicio
  const conHorario = ini !== null && p.tipo_actividad !== 'continua'
  const desde = conHorario ? minutos(turno.hora_inicio) + (ini as number) : 0
  return {
    frecuencia: 'rutina',
    titulo: p.titulo,
    detalle: p.descripcion ?? '',
    privada: p.privada,
    fecha: '',
    dias: p.dias_semana ?? [],
    turnoId: p.turno_id,
    horario: conHorario ? 'con_horario' : 'todo_el_turno',
    desde: conHorario ? hhmm(desde) : '',
    hasta: conHorario ? hhmm(desde + (p.duracion_min ?? 30)) : '',
    recordatorio: p.tipo_actividad === 'continua',
    area: p.area,
    quien: p.alcance === 'empleados' ? 'persona' : 'puesto',
    puestos: p.roles_puesto ?? [],
    personas: (p.tareas_recurrentes_asignados ?? []).map((a) => a.empleado_id),
    modo: p.modo,
    prioridad: p.prioridad,
    avisar: p.avisar_atraso_min !== null,
    foto: p.requiere_evidencia,
  }
}

/**
 * Solo lo que cambió entre dos armados del formulario (los dos pasados por
 * aRutina), para que fn_rutina_guardar registre antes/después de eso nada más.
 */
export function cambios(antes: Record<string, unknown>, despues: Record<string, unknown>): Record<string, unknown> {
  const res: Record<string, unknown> = {}
  for (const k of Object.keys(despues)) {
    if (JSON.stringify(antes[k]) !== JSON.stringify(despues[k])) res[k] = despues[k]
  }
  return res
}

/** ¿Cambiaron los asignados fijos? (mismo conjunto, en cualquier orden = no). */
export function mismosAsignados(a: number[], b: number[]): boolean {
  const x = [...a].sort((p, q) => p - q)
  const y = [...b].sort((p, q) => p - q)
  return x.length === y.length && x.every((v, i) => v === y[i])
}
