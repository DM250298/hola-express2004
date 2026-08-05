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

/**
 * Completa el CUIT de la ficha del proveedor SOLO si todavía no tiene uno.
 * Lo usa la carga de factura: el CUIT que tipea administración queda guardado
 * para que la próxima factura de ese proveedor venga precargada. El filtro
 * `is('cuit', null)` hace la condición en el server, así nunca pisa un CUIT
 * cargado (aunque el cache del cliente esté desactualizado).
 */
export async function completarCuitProveedor(
  id: number,
  cuit: string
): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase
    .from('proveedores')
    .update({ cuit })
    .eq('id', id)
    .is('cuit', null)

  if (error) throw error
}
