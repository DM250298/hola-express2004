import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { PantallaDashboard } from '@/components/dashboard/PantallaDashboard'

export const metadata = {
  title: 'Dashboard — ¡Hola! Express',
}

export default async function PaginaDashboard() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: perfil } = await supabase
    .from('usuarios')
    .select('nombre')
    .eq('id', user.id)
    .single<{ nombre: string }>()

  const nombre = perfil?.nombre ?? user.email ?? 'Usuario'

  return <PantallaDashboard nombreUsuario={nombre} />
}
