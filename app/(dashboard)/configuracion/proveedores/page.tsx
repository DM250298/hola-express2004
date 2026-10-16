import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { TablaProveedores } from '@/components/configuracion/proveedores/TablaProveedores'
import { getPermisosUsuario } from '@/lib/permisosServidor'
import { tienePermiso } from '@/lib/permisos'

export const metadata = {
  title: 'Proveedores — Configuración',
}

export default async function PaginaProveedores() {
  // Quien entra con el permiso 'proveedores' (compras) no tiene el resto de
  // Configuración: el "volver" lo lleva a Compras en vez de rebotar.
  const { permisos } = await getPermisosUsuario()
  const volver = tienePermiso(permisos, 'configuracion')
    ? { href: '/configuracion', etiqueta: 'Configuración' }
    : { href: '/compras', etiqueta: 'Compras' }

  return (
    <div className="p-6">
      <div className="mb-5">
        <Link
          href={volver.href}
          className="inline-flex items-center gap-1 text-sm text-[#6f3a2a] hover:text-[#391511] transition-colors"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          {volver.etiqueta}
        </Link>
        <h1 className="text-[#391511] text-2xl font-bold mt-1">Proveedores</h1>
      </div>

      <TablaProveedores />
    </div>
  )
}
