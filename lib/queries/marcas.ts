import { createClient } from '@/lib/supabase/client'
import type { MarcaRow } from '@/types/database'

/** Maestro de marcas (mig 177). Vacío si la migración no corrió. */
export async function getMarcas(): Promise<MarcaRow[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('marcas')
    .select('*')
    .order('nombre')
  if (error) {
    if (error.code === 'PGRST205' || error.code === '42P01') return []
    throw new Error(error.message)
  }
  return (data ?? []) as MarcaRow[]
}
