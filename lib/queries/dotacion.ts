import { createClient } from '@/lib/supabase/client'
import type { DotacionRequeridaInsert, DotacionRequeridaRow } from '@/types/database'

/** Mínimos de personas por turno/día (mig 255). Sin filas = "sin configurar". */
export async function getDotacionRequerida(): Promise<DotacionRequeridaRow[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('dotacion_requerida')
    .select('*')
    .order('turno_id', { ascending: true })
  if (error) throw error
  return (data ?? []) as DotacionRequeridaRow[]
}

/**
 * Reemplaza la configuración completa (tabla chica, sin dinero): borra lo que
 * había e inserta lo nuevo, mismo patrón que los miembros de un patrón.
 */
export async function guardarDotacionRequerida(
  filas: DotacionRequeridaInsert[]
): Promise<number> {
  const supabase = createClient()
  const { error: eDel } = await supabase.from('dotacion_requerida').delete().gte('id', 0)
  if (eDel) throw eDel
  if (filas.length === 0) return 0
  const { error } = await supabase.from('dotacion_requerida').insert(filas)
  if (error) throw error
  return filas.length
}
