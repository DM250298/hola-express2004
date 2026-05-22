import { createClient } from '@/lib/supabase/client'
import type {
  ClienteInsert,
  ClienteRow,
  ClienteUpdate,
  VentaRow,
  VistaClienteRow,
} from '@/types/database'

export interface FiltrosCliente {
  busqueda?: string
  /** undefined = todos; true/false filtra por estado. */
  activo?: boolean
}

/** Lista de clientes con sus métricas de compra (vista_clientes). */
export async function getClientes(
  filtros: FiltrosCliente = {}
): Promise<VistaClienteRow[]> {
  const supabase = createClient()
  let q = supabase
    .from('vista_clientes')
    .select('*')
    .order('nombre', { ascending: true })

  const busqueda = filtros.busqueda?.trim()
  if (busqueda) {
    const patron = `%${busqueda.replace(/[%_]/g, '\\$&')}%`
    q = q.or(
      `nombre.ilike.${patron},telefono.ilike.${patron},documento.ilike.${patron},email.ilike.${patron}`
    )
  }
  if (filtros.activo !== undefined) {
    q = q.eq('activo', filtros.activo)
  }

  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as VistaClienteRow[]
}

/** Un cliente con sus métricas. */
export async function getCliente(
  id: number
): Promise<VistaClienteRow | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('vista_clientes')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  return (data as VistaClienteRow | null) ?? null
}

export async function createCliente(
  datos: ClienteInsert
): Promise<ClienteRow> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('clientes')
    .insert(datos)
    .select()
    .single<ClienteRow>()

  if (error) throw error
  return data
}

export async function updateCliente(
  id: number,
  datos: ClienteUpdate
): Promise<ClienteRow> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('clientes')
    .update({ ...datos, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single<ClienteRow>()

  if (error) throw error
  return data
}

export async function toggleClienteActivo(
  id: number,
  activo: boolean
): Promise<ClienteRow> {
  return updateCliente(id, { activo })
}

/** Ventas completadas de un cliente, de la más reciente a la más vieja. */
export async function getHistorialCliente(
  clienteId: number
): Promise<VentaRow[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('ventas')
    .select('*')
    .eq('cliente_id', clienteId)
    .eq('estado', 'completada')
    .order('fecha', { ascending: false })

  if (error) throw error
  return (data ?? []) as VentaRow[]
}
