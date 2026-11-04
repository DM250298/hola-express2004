import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { getPermisosUsuario } from '@/lib/permisosServidor'
import { puedeCargarPlu } from '@/lib/permisos'
import { AsignarPluMovil } from '@/components/movil/AsignarPluMovil'

export const metadata = {
  title: 'PLU de balanza — Móvil',
}

/**
 * Cargar el PLU de balanza de los pesables desde el celular (mig 327): se
 * escanea la etiqueta de la balanza (trae el PLU) y el envase, o se busca el
 * producto por nombre. Permiso `plu_balanza` o `configuracion`.
 */
export default async function PaginaPluMovil() {
  const { userId, permisos } = await getPermisosUsuario()
  if (!userId) redirect('/login')
  if (!puedeCargarPlu(permisos)) redirect('/movil')

  return (
    <div className="mx-auto max-w-md px-4 pb-24 pt-3">
      <Link
        href="/movil"
        className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-[#6f3a2a]"
      >
        <ChevronLeft className="h-4 w-4" /> Volver
      </Link>
      <h1 className="mb-3 text-xl font-extrabold text-[#391511]">
        PLU de balanza
      </h1>
      <AsignarPluMovil />
    </div>
  )
}
