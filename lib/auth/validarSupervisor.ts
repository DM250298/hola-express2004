import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/** Roles autorizados a aprobar excepciones de compras. */
const ROLES_SUPERVISOR = ['admin', 'encargado']

export interface ResultadoSupervisor {
  ok: boolean
  nombre?: string
  rol?: string
  error?: string
}

/**
 * Valida las credenciales de un supervisor (encargado/admin) SIN tocar la
 * sesión activa del cajero. Usa un cliente Supabase efímero que no persiste
 * la sesión: si el login es correcto y el rol está autorizado, devuelve ok.
 *
 * Se usa para autorizar excepciones en recepción (ej: recibir más de lo
 * pedido) sin que el cajero tenga que cerrar su turno.
 */
export async function validarSupervisor(
  email: string,
  password: string
): Promise<ResultadoSupervisor> {
  // storageKey propio: aunque no persista, comparte proceso con el cliente
  // del cajero y auth-js avisa "Multiple GoTrueClient instances" si usan la
  // misma clave.
  const cliente = createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        storageKey: 'sb-supervisor',
      },
    }
  )

  try {
    const { data, error } = await cliente.auth.signInWithPassword({
      email: email.trim(),
      password,
    })

    if (error || !data.user) {
      return { ok: false, error: 'Email o contraseña incorrectos.' }
    }

    const { data: perfil } = await cliente
      .from('usuarios')
      .select('nombre, rol, activo')
      .eq('id', data.user.id)
      .single()

    // scope 'local': revoca SOLO esta sesión efímera. El default ('global')
    // tumbaba todas las sesiones del supervisor —incluida la del POS si el
    // encargado era quien tenía la caja abierta— y el turno "desaparecía".
    await cliente.auth.signOut({ scope: 'local' })

    if (!perfil || perfil.activo === false) {
      return { ok: false, error: 'El usuario no está activo.' }
    }
    if (!ROLES_SUPERVISOR.includes(perfil.rol as string)) {
      return {
        ok: false,
        error: 'Ese usuario no tiene permisos de supervisor.',
      }
    }

    return { ok: true, nombre: perfil.nombre as string, rol: perfil.rol as string }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Error al validar.',
    }
  }
}
