import { createClient } from '@/lib/supabase/client'
import type {
  EstadoTareaTurno,
  TareaRecurrenteInsert,
  TareaRecurrenteRow,
  TareaTurnoInsert,
  TareaTurnoRow,
} from '@/types/database'

const BUCKET_EVIDENCIA = 'tareas-evidencia'

// ─── Plantillas (recurrentes) ─────────────────────────────────────────────────

export async function getPlantillas(): Promise<TareaRecurrenteRow[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('tareas_recurrentes')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as TareaRecurrenteRow[]
}

export async function createPlantilla(
  datos: TareaRecurrenteInsert
): Promise<TareaRecurrenteRow> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('tareas_recurrentes')
    .insert(datos)
    .select()
    .single<TareaRecurrenteRow>()
  if (error) throw error
  return data
}

export async function updatePlantilla(
  id: string,
  datos: Partial<TareaRecurrenteInsert>
): Promise<TareaRecurrenteRow> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('tareas_recurrentes')
    .update(datos)
    .eq('id', id)
    .select()
    .single<TareaRecurrenteRow>()
  if (error) throw error
  return data
}

export async function deletePlantilla(id: string): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.from('tareas_recurrentes').delete().eq('id', id)
  if (error) throw error
}

// ─── Instancias (tareas del día) ───────────────────────────────────────────────

/** Tareas de una fecha. RLS: admin/encargado ven todas; el empleado, las suyas. */
export async function getTareasFecha(fecha: string): Promise<TareaTurnoRow[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('tareas_turno')
    .select('*')
    .eq('fecha', fecha)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as TareaTurnoRow[]
}

export async function createTarea(
  datos: TareaTurnoInsert
): Promise<TareaTurnoRow> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('tareas_turno')
    .insert(datos)
    .select()
    .single<TareaTurnoRow>()
  if (error) throw error
  return data
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

/** Completa una tarea (valida evidencia server-side). */
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
