import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { PantallaFiscal } from '@/components/configuracion/fiscal/PantallaFiscal'

export const metadata = {
  title: 'Datos fiscales — Configuración',
}

export default function PaginaFiscal() {
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
        <h1 className="text-[#391511] text-2xl font-bold mt-1">Datos fiscales</h1>
        <p className="text-[#6f3a2a] text-sm mt-1">
          CUIT, condición frente al IVA, alícuota de Ingresos Brutos y
          vencimientos. Alimentan el módulo de Impuestos.
        </p>
      </div>

      <PantallaFiscal />
    </div>
  )
}
