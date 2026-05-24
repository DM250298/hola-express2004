import { createClient } from '@/lib/supabase/client'
import type {
  ProyectoInsert,
  ProyectoRow,
  ProyectoUpdate,
  TareaInsert,
  TareaRow,
  TareaUpdate,
  VistaProyectoRow,
} from '@/types/database'

// ─── Proyectos ───────────────────────────────────────────────────────────────

export async function getProyectos(
  tableroId?: number
): Promise<VistaProyectoRow[]> {
  const supabase = createClient()
  let q = supabase
    .from('vista_proyectos')
    .select('*')
    .order('orden', { ascending: true })
    .order('created_at', { ascending: true })

  if (tableroId !== undefined) q = q.eq('tablero_id', tableroId)

  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as VistaProyectoRow[]
}

export async function createProyecto(
  datos: ProyectoInsert
): Promise<ProyectoRow> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('proyectos')
    .insert(datos)
    .select()
    .single<ProyectoRow>()

  if (error) throw error
  return data
}

export async function updateProyecto(
  id: number,
  datos: ProyectoUpdate
): Promise<ProyectoRow> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('proyectos')
    .update({ ...datos, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single<ProyectoRow>()

  if (error) throw error
  return data
}

export async function deleteProyecto(id: number): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.from('proyectos').delete().eq('id', id)
  if (error) throw error
}

// ─── Tareas ──────────────────────────────────────────────────────────────────

export async function getTareas(proyectoId: number): Promise<TareaRow[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('tareas')
    .select('*')
    .eq('proyecto_id', proyectoId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data ?? []) as TareaRow[]
}

export async function createTarea(datos: TareaInsert): Promise<TareaRow> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('tareas')
    .insert(datos)
    .select()
    .single<TareaRow>()

  if (error) throw error
  return data
}

export async function updateTarea(
  id: number,
  datos: TareaUpdate
): Promise<TareaRow> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('tareas')
    .update({ ...datos, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single<TareaRow>()

  if (error) throw error
  return data
}

export async function deleteTarea(id: number): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.from('tareas').delete().eq('id', id)
  if (error) throw error
}

/** Cambia el estado de una tarea, manejando la marca de completada. */
export async function cambiarEstadoTarea(
  id: number,
  estado: string
): Promise<TareaRow> {
  return updateTarea(id, {
    estado,
    completada_at: estado === 'hecha' ? new Date().toISOString() : null,
  })
}
