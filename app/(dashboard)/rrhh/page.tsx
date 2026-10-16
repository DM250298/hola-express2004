import { PantallaPersonal } from '@/components/rrhh/PantallaPersonal'
import { getPermisosUsuario } from '@/lib/permisosServidor'

export const metadata = {
  title: 'Turnos y equipo — ¡Hola! Express',
}

export default async function PaginaPersonal({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const [{ permisos }, { tab }] = await Promise.all([
    getPermisosUsuario(),
    searchParams,
  ])
  return <PantallaPersonal permisos={permisos} tabInicial={tab} />
}
