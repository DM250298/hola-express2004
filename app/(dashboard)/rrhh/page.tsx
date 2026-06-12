import { PantallaRrhh } from '@/components/rrhh/PantallaRrhh'
import { getPermisosUsuario } from '@/lib/permisosServidor'

export const metadata = {
  title: 'Recursos Humanos — ¡Hola! Express',
}

export default async function PaginaRrhh() {
  const { permisos } = await getPermisosUsuario()
  return <PantallaRrhh permisos={permisos} />
}
