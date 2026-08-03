import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { getPermisosUsuario } from '@/lib/permisosServidor'
import { tienePermiso } from '@/lib/permisos'
import { VencimientosMovil } from '@/components/movil/VencimientosMovil'

export const metadata = {
  title: 'Vencimientos — Móvil',
}

/**
 * Control de vencimientos desde el celular. El middleware habilita /movil de
 * forma amplia, así que el permiso fino 'vencimientos' se chequea acá (defensa
 * en profundidad): quien no lo tiene vuelve al hub.
 */
export default async function PaginaVencimientosMovil() {
  const { userId, permisos } = await getPermisosUsuario()
  if (!userId) redirect('/login')
  if (!tienePermiso(permisos, 'vencimientos')) redirect('/movil')

  return (
    <div className="mx-auto max-w-md px-4 pb-24 pt-3">
      <Link
        href="/movil"
        className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-[#6f3a2a]"
      >
        <ChevronLeft className="h-4 w-4" /> Volver
      </Link>
      <h1 className="text-xl font-extrabold text-[#391511]">Vencimientos</h1>
      <p className="mb-3 mt-0.5 text-sm text-[#6f3a2a]">
        Semáforo de lotes activos. Tocá “Dar de baja” para registrar la merma.
      </p>
      <VencimientosMovil />
    </div>
  )
}
