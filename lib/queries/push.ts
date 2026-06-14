import { createClient } from '@/lib/supabase/client'

export interface DatosSuscripcion {
  endpoint: string
  p256dh: string
  auth: string
}

/** Guarda (o actualiza por endpoint) la suscripción Web Push del dispositivo. */
export async function guardarSuscripcion(
  sub: DatosSuscripcion,
  usuarioId: string
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
