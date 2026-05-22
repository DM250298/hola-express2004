import { createClient } from '@/lib/supabase/client'
import type {
  CategoriaRow,
  CategoriaInsert,
  CategoriaUpdate,
} from '@/types/database'

export async function getCategorias(): Promise<CategoriaRow[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('categorias')
    .select('*')
    .order('nombre', { ascending: true })

  if (error) throw error
  return data ?? []
}

export async function createCategoria(
  datos: CategoriaInsert
): Promise<CategoriaRow> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('categorias')
    .insert(datos)
    .select()
    .single<CategoriaRow>()

  if (error) throw error
  return data
}

export async function updateCategoria(
  id: number,
  datos: CategoriaUpdate
): Promise<CategoriaRow> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('categorias')
    .update(datos)
    .eq('id', id)
    .select()
    .single<CategoriaRow>()

  if (error) throw error
  return data
}
