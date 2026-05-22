import { createClient } from '@/lib/supabase/client'
import type {
  ProveedorRow,
  ProveedorInsert,
  ProveedorUpdate,
} from '@/types/database'

export async function getProveedores(): Promise<ProveedorRow[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('proveedores')
    .select('*')
    .order('nombre', { ascending: true })

  if (error) throw error
  return data ?? []
}

export async function createProveedor(
  datos: ProveedorInsert
): Promise<ProveedorRow> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('proveedores')
    .insert(datos)
    .select()
    .single<ProveedorRow>()

  if (error) throw error
  return data
}

export async function updateProveedor(
  id: number,
  datos: ProveedorUpdate
): Promise<ProveedorRow> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('proveedores')
    .update(datos)
    .eq('id', id)
    .select()
    .single<ProveedorRow>()

  if (error) throw error
  return data
}
