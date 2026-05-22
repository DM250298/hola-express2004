import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { PantallaFinanzas } from '@/components/finanzas/PantallaFinanzas'
import { PERMISOS_POR_ROL_LEGACY } from '@/lib/permisos'

export const metadata = {
  title: 'Finanzas — ¡Hola! Express',
}

export default async function PaginaFinanzas() {
  // Doble protección: solo entran los roles con permiso 'finanzas'.
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: perfil } = await supabase
    .from('usuarios')
    .select('rol')
    .eq('id', user.id)
    .single<{ rol: string }>()

  const rol = perfil?.rol ?? 'cajero'

  let permisos: string[] = PERMISOS_POR_ROL_LEGACY[rol] ?? []
  const { data: rolData } = await supabase
    .from('roles')
    .select('permisos')
    .eq('codigo', rol)
    .maybeSingle<{ permisos: string[] }>()
  if (rolData?.permisos) permisos = rolData.permisos

  if (!permisos.includes('finanzas')) {
    redirect('/')
  }

  return <PantallaFinanzas />
}
