import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { getPermisosUsuario } from '@/lib/permisosServidor'
import { tienePermiso } from '@/lib/permisos'
import { AsignarUbicacionMovil } from '@/components/movil/AsignarUbicacionMovil'

export const metadata = {
  title: 'Ubicar productos — Móvil',
}

/**
 * Carga del mapa por escaneo en cadena: parado frente a una góndola, se
 * elige la ubicación y se escanean sus productos. Requiere el permiso
 * 'inventario' (el mismo que habilita mover productos en el mapa).
 */
export default async function PaginaUbicacionesMovil() {
  const { userId, permisos } = await getPermisosUsuario()
  if (!userId) redirect('/login')
  if (!tienePermiso(permisos, 'inventario')) redirect('/movil')

  return (
    <div className="mx-auto max-w-md px-4 pb-24 pt-3">
      <Link
        href="/movil"
        className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-[#6f3a2a]"
      >
        <ChevronLeft className="h-4 w-4" /> Volver
      </Link>
      <h1 className="mb-3 text-xl font-extrabold text-[#391511]">
        Ubicar productos
      </h1>
      <AsignarUbicacionMovil />
    </div>
  )
}
