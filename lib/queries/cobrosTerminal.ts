import { createClient } from '@/lib/supabase/client'
import type { CobroTerminalRow } from '@/types/database'

/**
 * Cobros con terminal SIN conciliar: plata que se cobró en la maquinita pero
 * cuya venta no quedó registrada. Incluye:
 *  · `aprobado` → MP aprobó el pago pero todavía no hay venta.
 *  · `fallida`  → se intentó registrar y falló.
 *  · `pendiente`→ quedó a mitad de camino (posible huérfano; se verifica en MP).
 *
 * Se filtra `venta_id is null` (las registradas no aparecen). SIN ventana de
 * tiempo: un cobro con plata que entró y nunca se convirtió en venta tiene que
 * seguir visible para recuperarlo, por más viejo que sea (los 'pendiente' que
 * en realidad expiraron se autolimpian al tocar "Registrar venta", que verifica
 * en MP). Cap de 500 por las dudas.
 */
export async function getCobrosSinConciliar(): Promise<CobroTerminalRow[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('cobros_terminal')
    .select('*')
    .is('venta_id', null)
    .in('estado', ['aprobado', 'fallida', 'pendiente'])
    .order('created_at', { ascending: false })
    .limit(500)
  if (error) throw error
  return (data ?? []) as CobroTerminalRow[]
}

export interface ResultadoConciliacion {
  ok: boolean
  venta_id?: number
  ventaId?: number | null
  estado?: string | null
  ya_registrada?: boolean
  mensaje?: string
}

/**
 * Concilia un cobro: verifica en Mercado Pago y, si está aprobado, registra la
 * venta (idempotente). Lo resuelve el endpoint server-side (service role).
 */
export async function conciliarCobro(
  id: string
): Promise<ResultadoConciliacion> {
  const res = await fetch(`/api/terminales/conciliar/${encodeURIComponent(id)}`, {
    method: 'POST',
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data?.error ?? 'No se pudo conciliar el cobro.')
  }
  return data as ResultadoConciliacion
}
