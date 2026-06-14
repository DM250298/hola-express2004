import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createServerClient } from '@/lib/supabase/server'
import { BotonSalirMovil } from '@/components/movil/BotonSalirMovil'

/**
 * Layout del modo móvil de la encargada. A diferencia del dashboard, NO incluye
 * el sidebar ni el menú con el POS: es un shell mobile-first y autocontenido
 * (logo + salir). El acceso por permisos lo controla el middleware; acá solo
 * se valida la sesión. Los Providers (TanStack Query, Toaster) viven en el
 * layout raíz, así que los hooks funcionan igual.
 */
export default async function LayoutMovil({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div className="flex min-h-screen flex-col bg-[#fdfaf6]">
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-[#e4c9b0]/60 bg-white px-4">
        <Link href="/movil" className="flex items-baseline gap-1.5">
          <span className="text-xl font-extrabold tracking-tight text-[#391511]">
            ¡Hola!
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#9e6b15]">
            Express
          </span>
        </Link>
        <BotonSalirMovil />
      </header>
      <main className="flex-1">{children}</main>
    </div>
  )
}
