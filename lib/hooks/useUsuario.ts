'use client'

import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { PERMISOS_POR_ROL_LEGACY } from '@/lib/permisos'
import type { Rol, UsuarioRow } from '@/types/database'

interface UsuarioActual {
  id: string
  email: string
  nombre: string
  rol: Rol
  activo: boolean
  /** Permisos efectivos del rol del usuario. */
  permisos: string[]
}

async function obtenerUsuarioActual(): Promise<UsuarioActual | null> {
  const supabase = createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) return null

  const { data: perfil, error: perfilError } = await supabase
    .from('usuarios')
    .select('id, email, nombre, rol, activo')
    .eq('id', user.id)
    .single<UsuarioRow>()

  if (perfilError || !perfil) return null

  // Permisos del rol: se leen de la tabla `roles`. Si todavía no existe
  // (migración 009 sin correr) se usa el fallback por rol base.
  let permisos: string[] = PERMISOS_POR_ROL_LEGACY[perfil.rol] ?? []
  try {
    const { data: rolData } = await supabase
      .from('roles')
      .select('permisos')
      .eq('codigo', perfil.rol)
      .maybeSingle<{ permisos: string[] }>()
    if (rolData?.permisos) permisos = rolData.permisos
  } catch {
    // la tabla roles puede no existir aún — se mantiene el fallback
  }

  return {
    id: perfil.id,
    email: perfil.email,
    nombre: perfil.nombre,
    rol: perfil.rol,
    activo: perfil.activo,
    permisos,
  }
}

export function useUsuario() {
  return useQuery({
    queryKey: ['usuario-actual'],
    queryFn: obtenerUsuarioActual,
    staleTime: 5 * 60 * 1000,
    retry: false,
  })
}
