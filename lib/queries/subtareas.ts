import { createClient } from '@/lib/supabase/client'
import type {
  SubtareaInsert,
  SubtareaRow,
  SubtareaUpdate,
} from '@/types/database'

export async function getSubtareas(
  tareaId: number
): Promise<SubtareaRow[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('subtareas')
    .select('*')
    .eq('tarea_id', tareaId)
    .order('orden', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data ?? []) as SubtareaRow[]
}

export async function createSubtarea(
  datos: SubtareaInsert
): Promise<SubtareaRow> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('subtareas')
    .insert(datos)
    .select()
    .single<SubtareaRow>()
  if (error) throw error
  return data
}

export async function updateSubtarea(
  id: number,
  datos: SubtareaUpdate
): Promise<SubtareaRow> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('subtareas')
    .update({ ...datos, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single<SubtareaRow>()
  if (error) throw error
  return data
}

export async function deleteSubtarea(id: number): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.from('subtareas').delete().eq('id', id)
  if (error) throw error
}

export async function marcarSubtarea(
  id: number,
  hecha: boolean
): Promise<SubtareaRow> {
  return updateSubtarea(id, {
    hecha,
    completada_at: hecha ? new Date().toISOString() : null,
  })
}
