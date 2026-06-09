import { createClient } from '@supabase/supabase-js'

/**
 * Cliente Supabase con SERVICE ROLE (bypassa RLS).
 *
 * ⚠️ SOLO para route handlers del servidor. NUNCA importar desde código que
 * llegue al browser: la service key es secreta (sin prefijo NEXT_PUBLIC_).
 *
 * Se usa en los endpoints públicos de la tienda (`/api/tienda/*`) para leer
 * el catálogo y crear pedidos sin depender de policies anónimas abiertas, y
 * manteniendo la PII de los pedidos (`pedidos_tienda`) cerrada por RLS a todo
 * acceso directo. Toda la validación (stock, precios) se hace server-side.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error(
      'Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el servidor.'
    )
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
