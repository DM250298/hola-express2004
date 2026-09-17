import { redirect } from 'next/navigation'
import { getPermisosUsuario } from '@/lib/permisosServidor'
import { tienePermiso } from '@/lib/permisos'
import { PantallaTablero } from '@/components/tablero/PantallaTablero'

export const metadata = { title: 'Tablero del dueño — ¡Hola! Express' }

export default async function PaginaTablero() {
  const { permisos } = await getPermisosUsuario()
  if (!tienePermiso(permisos, 'tablero')) redirect('/')
  return <PantallaTablero puedeVerAlertas={tienePermiso(permisos, 'alertas')} />
}
