import { redirect } from 'next/navigation'
import { getPermisosUsuario } from '@/lib/permisosServidor'
import { tienePermiso } from '@/lib/permisos'
import { PantallaAlertas } from '@/components/alertas/PantallaAlertas'

export const metadata = { title: 'Alertas — ¡Hola! Express' }

export default async function PaginaAlertas() {
  const { permisos } = await getPermisosUsuario()
  if (!tienePermiso(permisos, 'alertas')) redirect('/')
  return <PantallaAlertas puedeEditarReglas={tienePermiso(permisos, 'tablero')} />
}
