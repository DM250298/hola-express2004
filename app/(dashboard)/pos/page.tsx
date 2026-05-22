import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { PantallaPOS } from '@/components/pos/PantallaPOS'

export const metadata = {
  title: 'POS — ¡Hola! Express',
}

export default async function PaginaPOS() {
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

  const nombre = perfil?.nombre ?? user.email ?? 'Cajero'

  return <PantallaPOS usuarioId={user.id} nombreUsuario={nombre} />
}
