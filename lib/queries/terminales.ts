import { createClient } from '@/lib/supabase/client'
import type {
  TerminalInsert,
  TerminalRow,
  TerminalUpdate,
} from '@/types/database'

// ─── Terminales registradas (tabla local) ───────────────────────────────────

export async function getTerminales(): Promise<TerminalRow[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('terminales')
    .select('*')
    .order('nombre', { ascending: true })

  if (error) throw error
  return (data ?? []) as TerminalRow[]
}

export async function createTerminal(
  datos: TerminalInsert
): Promise<TerminalRow> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('terminales')
    .insert(datos)
    .select()
    .single<TerminalRow>()

  if (error) throw error
  return data
}

export async function updateTerminal(
  id: number,
  datos: TerminalUpdate
): Promise<TerminalRow> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('terminales')
    .update({ ...datos, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single<TerminalRow>()

  if (error) throw error
  return data
}

export async function deleteTerminal(id: number): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.from('terminales').delete().eq('id', id)
  if (error) throw error
}

// ─── Dispositivos Point en vivo (vía route handler del servidor) ─────────────

export interface DispositivoPoint {
  id: string
  operating_mode: string
  pos_id?: number
  store_id?: number
}

/** Lista los dispositivos Point de la cuenta de Mercado Pago. */
export async function getDispositivosPoint(): Promise<DispositivoPoint[]> {
  const res = await fetch('/api/terminales/dispositivos')
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(
      data?.error ?? 'No se pudieron obtener los dispositivos de Mercado Pago.'
    )
  }
  return (data?.dispositivos ?? []) as DispositivoPoint[]
}
