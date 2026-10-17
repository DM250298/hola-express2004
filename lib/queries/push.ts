import { createClient } from '@/lib/supabase/client'
import type { TemaPush } from '@/types/database'

export interface DatosSuscripcion {
  endpoint: string
  p256dh: string
  auth: string
}

/** Guarda (o actualiza por endpoint) la suscripción Web Push del dispositivo, con sus temas. */
export async function guardarSuscripcion(
  sub: DatosSuscripcion,
  usuarioId: string,
  temas: TemaPush[]
): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      usuario_id: usuarioId,
      endpoint: sub.endpoint,
      p256dh: sub.p256dh,
      auth: sub.auth,
      user_agent:
        typeof navigator !== 'undefined' ? navigator.userAgent : null,
      temas,
    },
    { onConflict: 'endpoint' }
  )
  if (error) throw error
}

/** Borra la suscripción de este dispositivo (al desactivar los avisos). */
export async function borrarSuscripcion(endpoint: string): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', endpoint)
  if (error) throw error
}

/** Temas que recibe este dispositivo (null = no está guardado en la base). */
export async function getTemasSuscripcion(endpoint: string): Promise<TemaPush[] | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('temas')
    .eq('endpoint', endpoint)
    .maybeSingle()
  if (error) throw error
  return (data as { temas: TemaPush[] } | null)?.temas ?? null
}

/** Cambia los temas de este dispositivo (sin tocar la suscripción). */
export async function actualizarTemas(endpoint: string, temas: TemaPush[]): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.from('push_subscriptions').update({ temas }).eq('endpoint', endpoint)
  if (error) throw error
}
