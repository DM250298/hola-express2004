import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { FormLogin } from '@/components/auth/FormLogin'

export const metadata = {
  title: 'Iniciar sesión — ¡Hola! Express',
}

export default async function PaginaLogin() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) redirect('/')

  return <FormLogin />
}
