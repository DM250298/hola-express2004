import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { FormLogin } from '@/components/auth/FormLogin'

export const metadata = {
  title: 'Iniciar sesión — ¡Hola! Express',
}

export default async function PaginaLogin({
  searchParams,
}: {
  searchParams: Promise<{ motivo?: string }>
}) {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) redirect('/')

  // `?motivo=turno_cerrado`: el POS cierra la sesión al cerrar la caja y
  // manda acá; el formulario muestra el aviso correspondiente.
  const { motivo } = await searchParams

  return <FormLogin motivo={motivo ?? null} />
}
