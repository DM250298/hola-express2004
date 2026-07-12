import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { PantallaVentas } from '@/components/configuracion/ventas/PantallaVentas'

export const metadata = {
  title: 'Ventas y stock — Configuración',
}

export default function PaginaVentasConfig() {
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
        <h1 className="text-[#391511] text-2xl font-bold mt-1">Ventas y stock</h1>
        <p className="text-[#6f3a2a] text-sm mt-1">
          Reglas del punto de venta, como permitir vender productos sin stock
          disponible.
        </p>
      </div>

      <PantallaVentas />
    </div>
  )
}
