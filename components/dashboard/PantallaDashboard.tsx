'use client'

import { TrendingUp } from 'lucide-react'
import { CardsKPIs } from './CardsKPIs'
import { PanelAlertas } from './PanelAlertas'
import { GraficoVentasPorHora } from './GraficoVentasPorHora'
import { TopProductosDia } from './TopProductosDia'
import { TablaTurnosDia } from './TablaTurnosDia'
import { AvisoProduccionPendiente } from '@/components/produccion/AvisoProduccionPendiente'
import { useRealtimeDashboard } from '@/lib/hooks/useDashboard'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

interface Props {
  nombreUsuario: string
}

export function PantallaDashboard({ nombreUsuario }: Props) {
  // Suscribe el dashboard a cambios en tiempo real (ventas, turnos)
  useRealtimeDashboard()

  const hoy = format(new Date(), "EEEE d 'de' MMMM", { locale: es })
  const saludo = obtenerSaludo()

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-5">
      <header>
        <h1 className="text-[#391511] text-2xl font-bold">
          {saludo}, {nombreUsuario.split(' ')[0]} 👋
        </h1>
        <p className="text-[#6f3a2a] text-sm mt-1 capitalize">
          {hoy} · Resumen operativo en tiempo real
        </p>
      </header>

      <AvisoProduccionPendiente />

      <CardsKPIs />

      <PanelAlertas />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white border border-[#e4c9b0]/60 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="h-4 w-4 text-[#f9b44c]" />
            <h2 className="text-[#391511] font-bold">
              Ventas por hora
            </h2>
            <span className="text-xs text-[#6f3a2a]">
              · hoy vs misma día semana pasada
            </span>
          </div>
          <GraficoVentasPorHora />
        </div>

        <TopProductosDia />
      </div>

      <TablaTurnosDia />
    </div>
  )
}

function obtenerSaludo(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Buen día'
  if (h < 19) return 'Buenas tardes'
  return 'Buenas noches'
}
