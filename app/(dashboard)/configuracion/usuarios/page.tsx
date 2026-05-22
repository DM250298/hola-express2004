import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { PantallaUsuariosRoles } from '@/components/configuracion/usuarios/PantallaUsuariosRoles'

export const metadata = {
  title: 'Usuarios y Roles — Configuración',
}

export default function PaginaUsuarios() {
  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-5">
        <Link
          href="/configuracion"
          className="inline-flex items-center gap-1 text-sm text-[#6f3a2a] hover:text-[#391511] transition-colors"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Configuración
        </Link>
        <h1 className="text-[#391511] text-2xl font-bold mt-1">
          Usuarios y Roles
        </h1>
        <p className="text-[#6f3a2a] text-sm mt-1">
          Empleados, roles personalizados y permisos del sistema.
        </p>
      </div>

      <PantallaUsuariosRoles />
    </div>
  )
}
