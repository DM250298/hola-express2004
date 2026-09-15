import { redirect } from 'next/navigation'
import { getPermisosUsuario } from '@/lib/permisosServidor'
import { tienePermiso } from '@/lib/permisos'
import { PantallaMapa } from '@/components/mapa/PantallaMapa'

export const metadata = { title: 'Mapa del local — ¡Hola! Express' }

export default async function PaginaMapa() {
  const { permisos } = await getPermisosUsuario()
  if (!tienePermiso(permisos, 'inventario')) redirect('/')
  return <PantallaMapa />
}
