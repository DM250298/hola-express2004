import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { TablaProductos } from '@/components/configuracion/productos/TablaProductos'

export const metadata = {
  title: 'Productos — Configuración',
}

export default function PaginaProductos() {
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-5">
        <Link
          href="/configuracion"
          className="inline-flex items-center gap-1 text-sm text-[#6f3a2a] hover:text-[#391511] transition-colors"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Configuración
        </Link>
        <h1 className="text-[#391511] text-2xl font-bold mt-1">Productos</h1>
      </div>

      <TablaProductos />
    </div>
  )
}
