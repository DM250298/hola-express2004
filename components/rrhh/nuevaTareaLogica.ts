/**
 * Lógica pura del formulario "Nueva tarea" (Tareas v2, Etapa 3).
 * Sin React: valida, arma el resumen "Así va a quedar" y traduce el
 * formulario a lo que piden fn_tarea_crear_puntual (una vez) y
 * fn_rutina_guardar (se repite). Solo importa tipos, para que los tests
 * corran con `node --test` sin compilar.
 */
import type {
  AreaTarea,
  ModoTarea,
  PrioridadTarea,
  RolOperativo,
  TipoActividadTarea,
  TurnoPlantillaRow,
} from '@/types/database'

const DIA = 1440

export type Frecuencia = 'una_vez' | 'rutina'
export type ModoHorario = 'con_horario' | 'todo_el_turno'
export type QuienLaHace = 'puesto' | 'persona'

export interface FormNuevaTarea {
  frecuencia: Frecuencia
  titulo: string
  detalle: string
  privada: boolean
  /** Una vez: día (yyyy-MM-dd). */
  fecha: string
  /** Se repite: días de la semana (0 = domingo). */
  dias: number[]
  turnoId: number | null
  horario: ModoHorario
  /** "HH:mm" */
  desde: string
  hasta: string
  /** Solo "todo el turno": es un recordatorio (no se marca). */
  recordatorio: boolean
  area: AreaTarea | null
  quien: QuienLaHace
  puestos: RolOperativo[]
  personas: number[]
  modo: ModoTarea
  prioridad: PrioridadTarea
  avisar: boolean
  foto: boolean
}

/** Puestos que se ofrecen en "Quién la hace" (etiquetas del lienzo). */
export const PUESTOS_TAREA: { clave: RolOperativo; nombre: string }[] = [
  { clave: 'responsable_general', nombre: 'Encargada de sucursal' },
  { clave: 'encargado', nombre: 'Encargado/a de turno' },
  { clave: 'fiambreria', nombre: 'Fiambrería y producción' },
  { clave: 'cajero', nombre: 'Caja' },
  { clave: 'pivote', nombre: 'Pivot' },
]

export const AVISO_ATRASO_MIN = 15

const DIAS_CORTO = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

function minutos(hora: string): number {
  const [h, m] = hora.split(':').map(Number)
  return h * 60 + (m || 0)
}

function largoTurno(t: TurnoPlantillaRow): number {
  const l = (minutos(t.hora_fin) - minutos(t.hora_inicio) + DIA) % DIA
  return l === 0 ? DIA : l
}

/** Duración en minutos de desde→hasta (cruza la medianoche si hace falta). */
export function duracion(desde: string, hasta: string): number {
  return (minutos(hasta) - minutos(desde) + DIA) % DIA
}

export function formularioVacio(fecha: string, turnoId: number | null, frecuencia: Frecuencia = 'una_vez'): FormNuevaTarea {
  return {
    frecuencia,
    titulo: '',
    detalle: '',
    privada: false,
    fecha,
    dias: [0, 1, 2, 3, 4, 5, 6],
    turnoId,
    horario: 'con_horario',
    desde: '',
    hasta: '',
    recordatorio: false,
    area: null,
    quien: 'puesto',
    puestos: [],
    personas: [],
    modo: 'individual',
    prioridad: 'media',
    avisar: false,
    foto: false,
  }
}

/** Errores para mostrar (vacío = se puede guardar). */
export function validar(f: FormNuevaTarea, turno: TurnoPlantillaRow | null): string[] {
  const e: string[] = []
  if (!f.titulo.trim()) e.push('Escribí qué hay que hacer.')
  if (f.titulo.trim().length > 200) e.push('El título no puede pasar de 200 letras.')
  if (!turno) e.push('Elegí el turno.')
  if (f.frecuencia === 'una_vez' && !f.fecha) e.push('Elegí el día.')
  if (f.frecuencia === 'rutina' && f.dias.length === 0) e.push('Elegí al menos un día de la semana.')
  if (!f.area) e.push('Elegí el área.')
  if (f.horario === 'con_horario') {
    if (!/^\d{2}:\d{2}$/.test(f.desde) || !/^\d{2}:\d{2}$/.test(f.hasta)) {
      e.push('Completá desde y hasta.')
    } else if (turno) {
      const dur = duracion(f.desde, f.hasta)
      const offset = (minutos(f.desde) - minutos(turno.hora_inicio) + DIA) % DIA
      if (dur === 0) e.push('El fin tiene que ser después del inicio.')
      else if (offset >= largoTurno(turno) || offset + dur > largoTurno(turno)) {
        e.push(`El horario tiene que quedar dentro del turno (${turno.hora_inicio.slice(0, 5)} a ${turno.hora_fin.slice(0, 5)}).`)
      }
    }
  }
  if (!f.privada) {
    if (f.quien === 'puesto' && f.puestos.length === 0) e.push('Elegí al menos un puesto.')
    if (f.quien === 'persona' && f.personas.length === 0) e.push('Elegí al menos una persona.')
  }
  return e
}

/** ¿Tiene sentido preguntar "si la hacen varios"? */
export function variosPosibles(f: FormNuevaTarea): boolean {
  if (f.privada) return false
  return f.quien === 'persona' ? f.personas.length > 1 : true
}

export interface Contexto {
  turno: TurnoPlantillaRow | null
  /** Nombre del turno para mostrar ("Mañana"). */
  nombreTurno: string
  /** "domingo 18/10" para una vez. */
  diaLegible: string
  nombreArea: string
  /** Nombres de las personas elegidas, o a quién le toca por puesto. */
  quienes: string[]
}

/** Texto de "Así va a quedar". */
export function resumen(f: FormNuevaTarea, c: Contexto): string[] {
  const lineas: string[] = []
  const titulo = f.titulo.trim() || 'Sin título'
  lineas.push(`${titulo}${f.privada ? ' (privada: solo administradores)' : ''}`)

  const cuando =
    f.frecuencia === 'una_vez'
      ? `Solo una vez, el ${c.diaLegible}`
      : f.dias.length === 7
        ? 'Todos los días, desde mañana'
        : `Los ${[...f.dias].sort((a, b) => a - b).map((d) => DIAS_CORTO[d]).join(', ')}, desde mañana`
  const horario =
    f.horario === 'todo_el_turno'
      ? f.recordatorio
        ? 'recordatorio de todo el turno (no se marca)'
        : 'en cualquier momento del turno'
      : f.desde && f.hasta
        ? `de ${f.desde} a ${f.hasta}`
        : 'horario a completar'
  lineas.push(`${cuando} · turno ${c.nombreTurno.toLowerCase()} · ${horario}`)
  lineas.push(c.nombreArea)

  if (!f.privada) {
    const quien = c.quienes.length ? c.quienes.join(', ') : 'nadie todavía'
    const varios = c.quienes.length > 1 || f.quien === 'puesto'
    const modo = varios ? (f.modo === 'grupal' ? ' · grupal: con que uno la marque alcanza' : ' · cada uno la suya') : ''
    lineas.push(
      f.quien === 'puesto'
        ? `${f.frecuencia === 'una_vez' ? 'Ese día le toca a' : 'Le toca a quien esté en el puesto'}: ${quien}${modo}`
        : `La hace: ${quien}${modo}`
    )
  }

  const extras = [`prioridad ${f.prioridad}`]
  if (f.avisar && !f.recordatorio) extras.push(`avisa si se atrasa más de ${AVISO_ATRASO_MIN} min`)
  if (f.foto && !f.recordatorio) extras.push('pide foto')
  lineas.push(extras.join(' · '))
  return lineas
}

function tipoActividad(f: FormNuevaTarea): TipoActividadTarea {
  return f.horario === 'todo_el_turno' && f.recordatorio ? 'continua' : 'puntual'
}

/** Datos para fn_tarea_crear_puntual (ver lib/queries/tareas.ts). */
export function aPuntual(f: FormNuevaTarea) {
  const conHorario = f.horario === 'con_horario'
  const recordatorio = tipoActividad(f) === 'continua'
  return {
    fecha: f.fecha,
    turnoId: f.turnoId as number,
    titulo: f.titulo.trim(),
    descripcion: f.detalle.trim() || null,
    hora: conHorario ? f.desde : null,
    duracionMin: conHorario ? duracion(f.desde, f.hasta) : null,
    empleadoIds: f.privada || f.quien !== 'persona' ? [] : f.personas,
    rolesPuesto: f.privada || f.quien !== 'puesto' ? [] : f.puestos,
    modo: f.privada ? ('individual' as ModoTarea) : f.modo,
    prioridad: f.prioridad,
    area: f.area,
    privada: f.privada,
    requiereEvidencia: f.foto && !recordatorio,
    tipoActividad: tipoActividad(f),
    avisarAtrasoMin: f.avisar && !recordatorio ? AVISO_ATRASO_MIN : null,
  }
}

/** Datos y asignados para fn_rutina_guardar (rige desde mañana). */
export function aRutina(f: FormNuevaTarea, esAdmin: boolean) {
  const conHorario = f.horario === 'con_horario'
  const recordatorio = tipoActividad(f) === 'continua'
  const datos: Record<string, unknown> = {
    titulo: f.titulo.trim(),
    descripcion: f.detalle.trim() || null,
    turno_id: f.turnoId,
    dias_semana: [...f.dias].sort((a, b) => a - b),
    hora: conHorario ? f.desde : null,
    duracion_min: conHorario ? duracion(f.desde, f.hasta) : null,
    tipo_actividad: tipoActividad(f),
    area: f.area,
    prioridad: f.prioridad,
    requiere_evidencia: f.foto && !recordatorio,
    avisar_atraso_min: f.avisar && !recordatorio ? AVISO_ATRASO_MIN : null,
    modo: f.privada ? 'individual' : f.modo,
    alcance: f.privada ? 'todos' : f.quien === 'puesto' ? 'puesto' : 'empleados',
    roles_puesto: !f.privada && f.quien === 'puesto' ? f.puestos : [],
  }
  // "privada" la cambia solo un administrador: la encargada ni la manda.
  if (esAdmin) datos.privada = f.privada
  const asignados = !f.privada && f.quien === 'persona' ? f.personas : []
  return { datos, asignados }
}
