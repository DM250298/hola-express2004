import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { getPermisosUsuario } from '@/lib/permisosServidor'
import { ConsultaPrecioMovil } from '@/components/movil/ConsultaPrecioMovil'

export const metadata = {
  title: 'Consultar precio — Móvil',
}

/**
 * Consulta rápida de precio y stock por escaneo. Accesible para todo el
 * personal que entra al hub móvil (no expone el costo). El acceso a /movil ya
 * lo controla el middleware; acá sólo se valida la sesión.
 */
export default async function PaginaConsultaMovil() {
  const { userId } = await getPermisosUsuario()
  if (!userId) redirect('/login')

  return (
    <div className="mx-auto max-w-md px-4 pb-24 pt-3">
      <Link
        href="/movil"
        className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-[#6f3a2a]"
      >
        <ChevronLeft className="h-4 w-4" /> Volver
      </Link>
      <h1 className="mb-3 text-xl font-extrabold text-[#391511]">
        Consultar precio
      </h1>
      <ConsultaPrecioMovil />
    </div>
  )
}
