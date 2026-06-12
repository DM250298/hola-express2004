import { createServerClient } from '@/lib/supabase/server'
import { PERMISOS_POR_ROL_LEGACY } from '@/lib/permisos'
import type { Rol } from '@/types/database'

/**
 * Lee rol y permisos del usuario logueado desde un Server Component (mismo
 * patrón que el layout del dashboard). Devuelve permisos vacíos si no hay
 * sesión — el middleware ya bloquea el acceso anónimo a rutas protegidas.
 */
export async function getPermisosUsuario(): Promise<{
  userId: string | null
  rol: Rol
  permisos: string[]
}> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { userId: null, rol: 'cajero', permisos: [] }

  const { data: perfil } = await supabase
    .from('usuarios')
    .select('rol')
    .eq('id', user.id)
    .single<{ rol: Rol }>()

  const rol: Rol = perfil?.rol ?? 'cajero'
  let permisos: string[] = PERMISOS_POR_ROL_LEGACY[rol] ?? []
  const { data: rolData } = await supabase
    .from('roles')
    .select('permisos')
    .eq('codigo', rol)
    .maybeSingle<{ permisos: string[] }>()
  if (rolData?.permisos) permisos = rolData.permisos

  return { userId: user.id, rol, permisos }
}
