import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns'
import { createClient } from '@/lib/supabase/client'
import { nuevoUuid } from '@/lib/offline/cola'
import { esErrorDeRed } from '@/lib/offline/sync'
import { encolarFichaje } from '@/lib/offline/colaFichajes'
import {
  guardarEmpleadosKiosco,
  type EmpleadoKiosco,
} from '@/lib/offline/empleadosKiosco'
import { updateEmpleado } from '@/lib/queries/rrhh'
import { materializarFecha } from '@/lib/queries/tareas'
import type {
  AsistenciaDiariaRow,
  FichajeRow,
  HorarioAsignadoInsert,
  HorarioAsignadoRow,
  ImportacionFichajesRow,
  Json,
  TipoFichaje,
  TurnoPlantillaRow,
} from '@/types/database'

const TZ_OFFSET = '-03:00' // Argentina (sin DST)

/** Fecha de hoy (yyyy-MM-dd) en hora argentina. */
function hoyAr(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(new Date())
}

function sumarDias(iso: string, n: number): string {
  return format(addDays(parseISO(iso), n), 'yyyy-MM-dd')
}

async function usuarioActualId(): Promise<string | null> {
  const supabase = createClient()
  const { data } = await supabase.auth.getUser()
  return data.user?.id ?? null
}

// ─── Turnos ───────────────────────────────────────────────────────────────────

export async function getTurnos(): Promise<TurnoPlantillaRow[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('turnos_plantilla')
    .select('*')
    .order('hora_inicio', { ascending: true })
  if (error) throw error
  return (data ?? []) as TurnoPlantillaRow[]
}

/** Horario de un turno (Configurar rutina › Horarios de turno; permiso rrhh por RLS). */
export async function updateTurno(
  id: number,
  datos: { hora_inicio: string; hora_fin: string; activo: boolean }
): Promise<TurnoPlantillaRow> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('turnos_plantilla')
    .update(datos)
    .eq('id', id)
    .select()
    .single<TurnoPlantillaRow>()
  if (error) throw error
  return data
}

// ─── Horarios asignados ───────────────────────────────────────────────────────

export async function getHorariosRango(
  desde: string,
  hasta: string
): Promise<HorarioAsignadoRow[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('horarios_asignados')
    .select('*')
    .gte('fecha', desde)
    .lte('fecha', hasta)
  if (error) throw error
  return (data ?? []) as HorarioAsignadoRow[]
}

/**
 * Alta/edición MANUAL de una celda. Marca la fila como manual (`patron_id: null`,
 * `usuario_id` del que edita): así una regeneración con "sobrescribir" no la pisa.
 */
export async function upsertHorario(
  datos: HorarioAsignadoInsert
): Promise<HorarioAsignadoRow> {
  const supabase = createClient()
  const usuarioId = await usuarioActualId()
  const { data, error } = await supabase
    .from('horarios_asignados')
    .upsert(
      { ...datos, patron_id: null, usuario_id: usuarioId },
      { onConflict: 'empleado_id,fecha' }
    )
    .select()
    .single<HorarioAsignadoRow>()
  if (error) throw error
  return data
}

export async function eliminarHorario(id: string): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.from('horarios_asignados').delete().eq('id', id)
  if (error) throw error
}

/** Recalcula la asistencia de un empleado para D y D+1 (mig 255, permiso rrhh). */
export async function recalcularAsistenciaEmpleado(
  empleadoId: number,
  fecha: string
): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.rpc('fn_recalcular_asistencia_empleado', {
    p_empleado_id: empleadoId,
    p_fecha: fecha,
  })
  if (error) throw error
}

/**
 * Re-sincroniza las tareas del turno si la fecha cae en la ventana que acepta
 * fn_materializar_tareas_turno ([hoy−1, hoy+7]). No bloquea: cerca de
 * medianoche el "hoy" del navegador y el del servidor pueden diferir y la RPC
 * rechaza la fecha, pero el plan ya quedó guardado. Devuelve null si no corrió.
 */
export async function materializarSiEnVentana(fecha: string): Promise<number | null> {
  const hoy = hoyAr()
  if (fecha < sumarDias(hoy, -1) || fecha > sumarDias(hoy, 7)) return null
  try {
    return await materializarFecha(fecha)
  } catch {
    return null
  }
}

export interface ResultadoSincronizacionPlan {
  /** Cambios que hizo fn_materializar_tareas_turno; null si no corrió. */
  tareasCambiadas: number | null
  /** true si se recalculó la asistencia (día pasado). */
  asistenciaRecalculada: boolean
}

/**
 * Después de tocar el plan de (empleado, fecha): si el día ya pasó, recalcula
 * la asistencia (el cron solo cierra planificados: un cambio a franco quedaba
 * "ausente"); después re-sincroniza las tareas del turno si corresponde.
 */
export async function sincronizarPlan(
  empleadoId: number,
  fecha: string
): Promise<ResultadoSincronizacionPlan> {
  let asistenciaRecalculada = false
  if (fecha < hoyAr()) {
    await recalcularAsistenciaEmpleado(empleadoId, fecha)
    asistenciaRecalculada = true
  }
  const tareasCambiadas = await materializarSiEnVentana(fecha)
  return { tareasCambiadas, asistenciaRecalculada }
}

export async function guardarHorarioYSincronizar(
  datos: HorarioAsignadoInsert
): Promise<{ horario: HorarioAsignadoRow } & ResultadoSincronizacionPlan> {
  const horario = await upsertHorario(datos)
  const sync = await sincronizarPlan(datos.empleado_id, datos.fecha)
  return { horario, ...sync }
}

export async function eliminarHorarioYSincronizar(
  horario: Pick<HorarioAsignadoRow, 'id' | 'empleado_id' | 'fecha'>
): Promise<ResultadoSincronizacionPlan> {
  await eliminarHorario(horario.id)
  return sincronizarPlan(horario.empleado_id, horario.fecha)
}

// ─── Copiar semana (con previsualización) ────────────────────────────────────

export interface FilaCopiaSemana {
  empleado_id: number
  fecha: string
  turno_id: number | null
  estado: HorarioAsignadoRow['estado']
  notas: string | null
  /** Fila que ya existe en la semana destino (se pisaría). */
  existente?: HorarioAsignadoRow
}

export interface PreviewCopiaSemana {
  desde: string
  hacia: string
  crear: FilaCopiaSemana[]
  pisar: FilaCopiaSemana[]
}

/** Las notas de cobertura son de un día concreto: no tiene sentido copiarlas. */
function notaCopiable(notas: string | null): string | null {
  if (!notas) return null
  if (/^Cubre (a|puesto) /i.test(notas)) return null
  return notas
}

/** Lee origen y destino y separa lo que se crea de lo que pisaría una fila existente. */
export async function previsualizarCopiaSemana(
  semanaDesde: string,
  semanaHacia: string
): Promise<PreviewCopiaSemana> {
  const origen = await getHorariosRango(semanaDesde, sumarDias(semanaDesde, 6))
  const destino = await getHorariosRango(semanaHacia, sumarDias(semanaHacia, 6))
  // differenceInCalendarDays da un entero exacto (inmune a DST), a diferencia de
  // dividir milisegundos, que da fraccional si la ventana cruza un cambio de hora.
  const corrimiento = differenceInCalendarDays(parseISO(semanaHacia), parseISO(semanaDesde))
  const existentes = new Map<string, HorarioAsignadoRow>()
  for (const h of destino) existentes.set(`${h.empleado_id}|${h.fecha}`, h)

  const crear: FilaCopiaSemana[] = []
  const pisar: FilaCopiaSemana[] = []
  for (const h of origen) {
    const fecha = sumarDias(h.fecha, corrimiento)
    const fila: FilaCopiaSemana = {
      empleado_id: h.empleado_id,
      fecha,
      turno_id: h.turno_id,
      estado: h.estado,
      notas: notaCopiable(h.notas),
    }
    const ex = existentes.get(`${h.empleado_id}|${fecha}`)
    if (ex) pisar.push({ ...fila, existente: ex })
    else crear.push(fila)
  }
  return { desde: semanaDesde, hacia: semanaHacia, crear, pisar }
}

/** Escribe las filas elegidas como carga manual (`patron_id: null`). */
export async function aplicarCopiaSemana(filas: FilaCopiaSemana[]): Promise<number> {
  if (filas.length === 0) return 0
  const supabase = createClient()
  const usuarioId = await usuarioActualId()
  const nuevos: HorarioAsignadoInsert[] = filas.map((f) => ({
    empleado_id: f.empleado_id,
    turno_id: f.turno_id,
    fecha: f.fecha,
    estado: f.estado,
    notas: f.notas,
    patron_id: null,
    usuario_id: usuarioId,
  }))
  const { error } = await supabase
    .from('horarios_asignados')
    .upsert(nuevos, { onConflict: 'empleado_id,fecha' })
  if (error) throw error
  return nuevos.length
}

// ─── Asistencia diaria ────────────────────────────────────────────────────────

export async function getAsistenciaRango(
  desde: string,
  hasta: string
): Promise<AsistenciaDiariaRow[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('asistencia_diaria')
    .select('*')
    .gte('fecha', desde)
    .lte('fecha', hasta)
  if (error) throw error
  return (data ?? []) as AsistenciaDiariaRow[]
}

/** Asistencia de un empleado en un mes (calendario de su ficha / panel). */
export async function getAsistenciaEmpleado(
  empleadoId: number,
  desde: string,
  hasta: string
): Promise<AsistenciaDiariaRow[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('asistencia_diaria')
    .select('*')
    .eq('empleado_id', empleadoId)
    .gte('fecha', desde)
    .lte('fecha', hasta)
    .order('fecha', { ascending: true })
  if (error) throw error
  return (data ?? []) as AsistenciaDiariaRow[]
}

/** Cierra (recalcula y marca ausentes) un día. Disparado on-demand. */
export async function cerrarDia(fecha: string): Promise<number> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_cerrar_dia_asistencia', {
    p_fecha: fecha,
  })
  if (error) throw error
  return (data as number) ?? 0
}

// ─── Fichajes (corrección manual) ─────────────────────────────────────────────

export async function getFichajesDia(
  empleadoId: number,
  fecha: string
): Promise<FichajeRow[]> {
  const supabase = createClient()
  const ini = `${fecha}T00:00:00${TZ_OFFSET}`
  const fin = `${format(addDays(parseISO(fecha), 1), 'yyyy-MM-dd')}T00:00:00${TZ_OFFSET}`
  const { data, error } = await supabase
    .from('fichajes')
    .select('*')
    .eq('empleado_id', empleadoId)
    .gte('momento', ini)
    .lt('momento', fin)
    .order('momento', { ascending: true })
  if (error) throw error
  return (data ?? []) as FichajeRow[]
}

export async function corregirFichaje(args: {
  empleadoId: number
  momento: string
  tipo: TipoFichaje
  motivo: string
}): Promise<string> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_corregir_fichaje', {
    p_empleado_id: args.empleadoId,
    p_momento: args.momento,
    p_tipo: args.tipo,
    p_motivo: args.motivo,
  })
  if (error) throw error
  return data as string
}

export async function anularFichaje(
  fichajeId: string,
  motivo: string
): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.rpc('fn_anular_fichaje', {
    p_fichaje_id: fichajeId,
    p_motivo: motivo,
  })
  if (error) throw error
}

// ─── Importación del reloj biométrico ─────────────────────────────────────────

export interface FilaPreviewReloj {
  reloj_id: number
  nombre_reloj: string
  empleado_id: number | null
  nombre_empleado: string | null
  total: number
  dias_impares: number
  por_dia: Record<string, string[]>
}

export interface PreviewReloj {
  archivo_nombre: string
  periodo_desde: string
  periodo_hasta: string
  dias: string[]
  filas: FilaPreviewReloj[]
  marcaciones: { reloj_id: number; momento: string }[]
  resumen: { total_marcaciones: number; empleados: number; sin_match: number }
}

export interface ResumenImportReloj {
  nuevas: number
  duplicadas: number
  sin_match: number
  relojes_sin_match: number[]
  dias_recalculados: number
}

/** Sube el .xls al parser server-side y devuelve la previsualización. */
export async function previsualizarReloj(file: File): Promise<PreviewReloj> {
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch('/api/rrhh/importar-reloj', {
    method: 'POST',
    body: fd,
  })
  const json = await res.json()
  if (!res.ok) {
    throw new Error(json.error ?? 'No se pudo leer el archivo del reloj.')
  }
  return json as PreviewReloj
}

/** Vincula un reloj_id sin matchear a un empleado (lo guarda en su ficha). */
export async function vincularReloj(
  empleadoId: number,
  relojId: number
): Promise<void> {
  await updateEmpleado(empleadoId, { reloj_id: relojId })
}

/** Crea la importación y ejecuta fn_importar_fichajes (transaccional). */
export async function confirmarImportReloj(
  preview: PreviewReloj
): Promise<ResumenImportReloj> {
  const supabase = createClient()
  const usuarioId = await usuarioActualId()
  const { data: imp, error: e1 } = await supabase
    .from('importaciones_fichajes')
    .insert({
      usuario_id: usuarioId,
      archivo_nombre: preview.archivo_nombre,
      periodo_desde: preview.periodo_desde,
      periodo_hasta: preview.periodo_hasta,
      total_marcaciones: preview.marcaciones.length,
      estado: 'pendiente',
    })
    .select('id')
    .single<{ id: string }>()
  if (e1) throw e1

  const { data, error } = await supabase.rpc('fn_importar_fichajes', {
    p_import_id: imp.id,
    p_marcaciones: preview.marcaciones as unknown as Json,
  })
  if (error) {
    // Que no quede una importación "completada" sin fichajes (la vista Fichadas
    // toma la última importación para distinguir ausencia de "falta importar").
    await supabase
      .from('importaciones_fichajes')
      .update({ estado: 'error' })
      .eq('id', imp.id)
    throw error
  }
  return data as unknown as ResumenImportReloj
}

/**
 * Última importación del reloj que efectivamente procesó fichajes. Define
 * hasta qué fecha una falta de marcaciones es "ausencia" y no "falta importar".
 */
export async function getUltimaImportacion(): Promise<ImportacionFichajesRow | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('importaciones_fichajes')
    .select('*')
    .eq('estado', 'completada')
    .gt('dias_recalculados', 0)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<ImportacionFichajesRow>()
  if (error) throw error
  return data ?? null
}

// ─── Kiosco (PIN + fichaje con fallback offline) ──────────────────────────────

export interface ResultadoFichaje {
  ya_registrado: boolean
  empleado_id: number
  nombre: string
  apellido: string | null
  foto_url: string | null
  tipo?: TipoFichaje
  momento?: string
  pendiente?: boolean
}

/** Lista de empleados activos para el kiosco; cachea para uso offline. */
export async function getEmpleadosParaKiosco(): Promise<EmpleadoKiosco[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('empleados')
    .select('id, nombre, apellido, foto_url, legajo')
    .eq('activo', true)
    .order('nombre', { ascending: true })
  if (error) throw error
  const lista = (data ?? []) as EmpleadoKiosco[]
  await guardarEmpleadosKiosco(lista)
  return lista
}

/** Registra un fichaje del kiosco; si no hay red, lo encola (valida al sync). */
export async function registrarFichajeKiosco(
  empleado: { id: number; nombre: string },
  pin: string
): Promise<ResultadoFichaje> {
  const id = nuevoUuid()
  const momento = new Date().toISOString()

  const offline = (): Promise<ResultadoFichaje> =>
    encolarFichaje(
      { empleado_id: empleado.id, nombre: empleado.nombre, pin, momento },
      id
    ).then(() => ({
      ya_registrado: false,
      empleado_id: empleado.id,
      nombre: empleado.nombre,
      apellido: null,
      foto_url: null,
      pendiente: true,
    }))

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return offline()
  }

  const supabase = createClient()
  try {
    const { data, error } = await supabase.rpc('fn_registrar_fichaje', {
      p_id: id,
      p_empleado_id: empleado.id,
      p_pin: pin,
      p_origen: 'kiosco',
      p_momento: momento,
    })
    if (error) throw error
    return { ...(data as unknown as ResultadoFichaje), pendiente: false }
  } catch (e) {
    // Se cayó la red → encolar. PIN incorrecto u otro error → relanzar.
    if (esErrorDeRed(e)) return offline()
    throw e
  }
}

// ─── PIN ──────────────────────────────────────────────────────────────────────

export async function setPin(empleadoId: number, pin: string): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.rpc('fn_set_pin', {
    p_empleado_id: empleadoId,
    p_pin: pin,
  })
  if (error) throw error
}

export async function tienePin(empleadoId: number): Promise<boolean> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_tiene_pin', {
    p_empleado_id: empleadoId,
  })
  if (error) throw error
  return (data as boolean) ?? false
}
