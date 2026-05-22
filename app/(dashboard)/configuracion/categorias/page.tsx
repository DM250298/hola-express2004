import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { TablaCategorias } from '@/components/configuracion/categorias/TablaCategorias'

export const metadata = {
  title: 'Categorías — Configuración',
}

export default function PaginaCategorias() {
  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-5">
        <Link
          href="/configuracion"
          className="inline-flex items-center gap-1 text-sm text-[#6f3a2a] hover:text-[#391511] transition-colors"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Configuración
        </Link>
        <h1 className="text-[#391511] text-2xl font-bold mt-1">Categorías</h1>
      </div>

      <TablaCategorias />
    </div>
  )
}
