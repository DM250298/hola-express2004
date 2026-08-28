import { createClient } from '@/lib/supabase/client'
import type {
  EstadoTareaTurno,
  ModoTarea,
  TareaRecurrenteInsert,
  TareaRecurrenteRow,
  TareaTurnoInsert,
  TareaTurnoRow,
} from '@/types/database'

const BUCKET_EVIDENCIA = 'tareas-evidencia'

/** Plantilla con sus asignados (embed de la tabla puente, mig 158). */
export type PlantillaConAsignados = TareaRecurrenteRow & {
  tareas_recurrentes_asignados: { empleado_id: number }[]
}

/** Instancia con los participantes de una tarea grupal (vacío si individual). */
export type TareaConParticipantes = TareaTurnoRow & {
  tareas_turno_participantes: { empleado_id: number }[]
}

/** Fila agregada de cumplimiento por empleado (fn_cumplimiento_tareas). */
export type CumplimientoEmpleado = {
  empleado_id: number
  nombre: string
  apellido: string
  asignadas: number
  completadas: number
  vencidas: number
  pendientes: number
  rechazos: number
  pct: number | null
}

/** Fila agregada de cumplimiento por tarea/plantilla (fn_cumplimiento_tareas). */
export type CumplimientoTarea = {
  plantilla_id: string | null
  titulo: string
  modo: ModoTarea
  total: number
  completadas: number
  vencidas: number
  pendientes: number
  rechazos: number
  pct: number | null
}

export type CumplimientoTareas = {
  por_empleado: CumplimientoEmpleado[]
  por_tarea: CumplimientoTarea[]
}

/** id del usuario logueado, para registrar quién asigna (usuario_id). */
async function usuarioActualId(): Promise<string | null> {
  const supabase = createClient()
  const { data } = await supabase.auth.getSession()
  return data.session?.user.id ?? null
}

// ─── Plantillas (recurrentes) ─────────────────────────────────────────────────

export async function getPlantillas(): Promise<PlantillaConAsignados[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('tareas_recurrentes')
    .select('*, tareas_recurrentes_asignados(empleado_id)')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as PlantillaConAsignados[]
}

/** Sincroniza la tabla puente con la lista de asignados (delete + insert). */
async function sincronizarAsignados(
  plantillaId: string,
  asignados: number[]
): Promise<void> {
  const supabase = createClient()
  const { error: errorBorrar } = await supabase
    .from('tareas_recurrentes_asignados')
    .delete()
    .eq('plantilla_id', plantillaId)
  if (errorBorrar) throw errorBorrar
  if (asignados.length === 0) return
  const { error } = await supabase.from('tareas_recurrentes_asignados').insert(
    asignados.map((empleadoId) => ({
      plantilla_id: plantillaId,
      empleado_id: empleadoId,
    }))
  )
  if (error) throw error
}

/**
 * Crea una plantilla con sus asignados. Con alcance 'todos' la puente queda
 * vacía (la materialización resuelve empleados activos ese día).
 */
export async function createPlantilla(
  datos: TareaRecurrenteInsert,
  asignados: number[]
): Promise<TareaRecurrenteRow> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('tareas_recurrentes')
    .insert({ usuario_id: await usuarioActualId(), ...datos })
    .select()
    .single<TareaRecurrenteRow>()
  if (error) throw error
  if (datos.alcance !== 'todos') await sincronizarAsignados(data.id, asignados)
  return data
}

export async function updatePlantilla(
  id: string,
  datos: Partial<TareaRecurrenteInsert>,
  asignados: number[]
): Promise<TareaRecurrenteRow> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('tareas_recurrentes')
    .update(datos)
    .eq('id', id)
    .select()
    .single<TareaRecurrenteRow>()
  if (error) throw error
  await sincronizarAsignados(id, datos.alcance === 'todos' ? [] : asignados)
  return data
}

export async function deletePlantilla(id: string): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.from('tareas_recurrentes').delete().eq('id', id)
  if (error) throw error
}

// ─── Instancias (tareas del día) ───────────────────────────────────────────────

/**
 * Tareas de una fecha, con participantes de las grupales. RLS: gestión/rrhh
 * ven todas; el empleado, las suyas y las grupales donde participa.
 */
export async function getTareasFecha(
  fecha: string
): Promise<TareaConParticipantes[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('tareas_turno')
    .select('*, tareas_turno_participantes(empleado_id)')
    .eq('fecha', fecha)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as TareaConParticipantes[]
}

/**
 * Tareas de un rango (drill-down de cumplimiento; solo gestión por RLS).
 * El filtro por empleado (incl. participante de grupales) se hace en cliente.
 */
export async function getTareasRango(
  desde: string,
  hasta: string,
  filtros?: { plantillaId?: string | null; titulo?: string }
): Promise<TareaConParticipantes[]> {
  const supabase = createClient()
  let query = supabase
    .from('tareas_turno')
    .select('*, tareas_turno_participantes(empleado_id)')
    .gte('fecha', desde)
    .lte('fecha', hasta)
    .order('fecha', { ascending: false })
  if (filtros?.plantillaId) query = query.eq('plantilla_id', filtros.plantillaId)
  if (filtros?.plantillaId === null && filtros.titulo) {
    query = query.is('plantilla_id', null).eq('titulo', filtros.titulo)
  }
  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as TareaConParticipantes[]
}

export async function createTarea(
  datos: TareaTurnoInsert
): Promise<TareaTurnoRow> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('tareas_turno')
    .insert({ usuario_id: await usuarioActualId(), ...datos })
    .select()
    .single<TareaTurnoRow>()
  if (error) throw error
  return data
}

/** Tarea única "cada uno": una instancia individual por empleado. */
export async function createTareasIndividuales(
  datos: Omit<TareaTurnoInsert, 'empleado_id'>,
  empleados: number[]
): Promise<void> {
  const supabase = createClient()
  const usuarioId = await usuarioActualId()
  const { error } = await supabase.from('tareas_turno').insert(
    empleados.map((empleadoId) => ({
      usuario_id: usuarioId,
      ...datos,
      empleado_id: empleadoId,
      modo: 'individual' as ModoTarea,
    }))
  )
  if (error) throw error
}

/** Tarea única grupal: UNA instancia (empleado_id null) + sus participantes. */
export async function createTareaGrupal(
  datos: Omit<TareaTurnoInsert, 'empleado_id'>,
  participantes: number[]
): Promise<void> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('tareas_turno')
    .insert({
      usuario_id: await usuarioActualId(),
      ...datos,
      empleado_id: null,
      modo: 'grupal' as ModoTarea,
    })
    .select()
    .single<TareaTurnoRow>()
  if (error) throw error
  const { error: errorPart } = await supabase
    .from('tareas_turno_participantes')
    .insert(
      participantes.map((empleadoId) => ({
        tarea_id: data.id,
        empleado_id: empleadoId,
      }))
    )
  if (errorPart) throw errorPart
}

export async function updateTarea(
  id: string,
  datos: Partial<TareaTurnoInsert>
): Promise<TareaTurnoRow> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('tareas_turno')
    .update(datos)
    .eq('id', id)
    .select()
    .single<TareaTurnoRow>()
  if (error) throw error
  return data
}

export async function cambiarEstadoTarea(
  id: string,
  estado: EstadoTareaTurno
): Promise<TareaTurnoRow> {
  return updateTarea(id, { estado })
}

export async function deleteTarea(id: string): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.from('tareas_turno').delete().eq('id', id)
  if (error) throw error
}

/** Completa una tarea (valida evidencia y permiso server-side). */
export async function completarTarea(
  id: string,
  evidenciaUrl?: string | null
): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.rpc('fn_completar_tarea', {
    p_tarea_id: id,
    p_evidencia_url: evidenciaUrl ?? null,
  })
  if (error) throw error
}

/** Rechaza una completada (solo gestión): vuelve a pendiente con motivo. */
export async function rechazarTarea(id: string, motivo: string): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.rpc('fn_rechazar_tarea', {
    p_tarea_id: id,
    p_motivo: motivo,
  })
  if (error) throw error
}

/** Agregados de cumplimiento por empleado y por tarea (solo gestión). */
export async function getCumplimiento(
  desde: string,
  hasta: string,
  empleadoId?: number | null
): Promise<CumplimientoTareas> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_cumplimiento_tareas', {
    p_desde: desde,
    p_hasta: hasta,
    p_empleado_id: empleadoId ?? null,
  })
  if (error) throw error
  return (data ?? { por_empleado: [], por_tarea: [] }) as CumplimientoTareas
}

/** Materializa las tareas recurrentes de una fecha (fallback on-demand del cron). */
export async function materializarFecha(fecha: string): Promise<number> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_materializar_tareas_turno', {
    p_fecha: fecha,
  })
  if (error) throw error
  return (data as number) ?? 0
}

/** Sube una foto de evidencia al bucket público y devuelve la URL. */
export async function subirEvidencia(file: File): Promise<string> {
  const supabase = createClient()
  const ext = file.name.split('.').pop() || 'jpg'
  const path = `${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage
    .from(BUCKET_EVIDENCIA)
    .upload(path, file, { upsert: false, contentType: file.type || undefined })
  if (error) throw error
  const { data } = supabase.storage.from(BUCKET_EVIDENCIA).getPublicUrl(path)
  return data.publicUrl
}
