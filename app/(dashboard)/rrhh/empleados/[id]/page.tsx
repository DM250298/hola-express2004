import { notFound } from 'next/navigation'
import { getPermisosUsuario } from '@/lib/permisosServidor'
import { FichaEmpleado } from '@/components/rrhh/FichaEmpleado'

export const metadata = {
  title: 'Ficha de empleado — RRHH',
}

interface Props {
  params: Promise<{ id: string }>
}

export default async function PaginaFichaEmpleado({ params }: Props) {
  const { id } = await params
  const empleadoId = Number(id)
  if (!Number.isInteger(empleadoId) || empleadoId <= 0) {
    notFound()
  }

  const { permisos } = await getPermisosUsuario()
  return (
    <FichaEmpleado
      empleadoId={empleadoId}
      puedeVerSueldos={permisos.includes('rrhh_sueldos')}
    />
  )
}
