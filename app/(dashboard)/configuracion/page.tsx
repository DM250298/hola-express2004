import Link from 'next/link'
import { Tag, Truck, ChevronRight, Users } from 'lucide-react'

const SECCIONES = [
  {
    href: '/configuracion/categorias',
    titulo: 'Categorías',
    descripcion: 'Agrupaciones para reportes y búsqueda rápida.',
    icono: Tag,
    color: '#c43e2c',
  },
  {
    href: '/configuracion/proveedores',
    titulo: 'Proveedores',
    descripcion: 'Datos comerciales, plazos y condiciones de pago.',
    icono: Truck,
    color: '#6f3a2a',
  },
  {
    href: '/configuracion/usuarios',
    titulo: 'Usuarios',
    descripcion: 'Empleados y roles del sistema.',
    icono: Users,
    color: '#9e2f25',
  },
]

export const metadata = {
  title: 'Configuración — ¡Hola! Express',
}

export default function PaginaConfiguracion() {
  return (
    <div className="p-6 max-w-5xl mx-auto">
      <header className="mb-6">
        <h1 className="text-[#391511] text-2xl font-bold">Configuración</h1>
        <p className="text-[#6f3a2a] text-sm mt-1">
          Gestioná los datos maestros del sistema.
        </p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {SECCIONES.map((seccion) => {
          const Icono = seccion.icono
          return (
            <Link
              key={seccion.href}
              href={seccion.href}
              className="group flex items-center gap-4 p-5 bg-white border border-[#e4c9b0]/60 rounded-2xl shadow-sm hover:shadow-md hover:border-[#f9b44c] transition-all"
            >
              <div
                className="shrink-0 p-3 rounded-xl"
                style={{ backgroundColor: `${seccion.color}20` }}
              >
                <Icono className="h-6 w-6" style={{ color: seccion.color }} />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-[#391511] group-hover:text-[#c43e2c] transition-colors">
                  {seccion.titulo}
                </h3>
                <p className="text-[#6f3a2a] text-xs mt-0.5">
                  {seccion.descripcion}
                </p>
              </div>
              <ChevronRight className="h-4 w-4 text-[#c8a58a] group-hover:text-[#391511] group-hover:translate-x-1 transition-all" />
            </Link>
          )
        })}
      </div>
    </div>
  )
}
