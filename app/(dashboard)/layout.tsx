import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { Sidebar } from '@/components/shared/Sidebar'
import { Header } from '@/components/shared/Header'
import { PERMISOS_POR_ROL_LEGACY } from '@/lib/permisos'
import type { Rol } from '@/types/database'

export default async function LayoutDashboard({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: perfil } = await supabase
    .from('usuarios')
    .select('nombre, rol')
    .eq('id', user.id)
    .single<{ nombre: string; rol: Rol }>()

  const nombre = perfil?.nombre ?? user.email ?? 'Usuario'
  const rol: Rol = perfil?.rol ?? 'cajero'

  // Permisos del rol: tabla `roles` con fallback al mapeo de roles base.
  let permisos: string[] = PERMISOS_POR_ROL_LEGACY[rol] ?? []
  const { data: rolData } = await supabase
    .from('roles')
    .select('permisos')
    .eq('codigo', rol)
    .maybeSingle<{ permisos: string[] }>()
  if (rolData?.permisos) permisos = rolData.permisos

  return (
    <div className="flex h-screen overflow-hidden bg-[#fdfaf6]">
      <Sidebar permisos={permisos} />

      <div className="flex flex-col flex-1 overflow-hidden min-w-0">
        <Header nombre={nombre} rol={rol} permisos={permisos} />
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
