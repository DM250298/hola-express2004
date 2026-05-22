'use client'

import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  PackageX,
  Receipt,
  ShoppingCart,
  TrendingUp,
} from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { MontoARS } from '@/components/shared/MontoARS'
import { GraficoVentasEgresos } from './GraficoVentasEgresos'
import { useResumenFinanciero } from '@/lib/hooks/useFinanzas'
import { cn } from '@/lib/utils'

interface Props {
  desde: string
  hasta: string
}

export function TabResumen({ desde, hasta }: Props) {
  const { data, isLoading, isError } = useResumenFinanciero(desde, hasta)

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl bg-[#f9d2a2]/30" />
          ))}
        </div>
        <Skeleton className="h-72 rounded-2xl bg-[#f9d2a2]/30" />
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="p-10 text-center text-[#c43e2c] text-sm">
        No se pudo cargar el resumen financiero.
      </div>
    )
  }

  const positivo = data.resultado_neto >= 0

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <CardKPI
          etiqueta="Ventas brutas"
          valor={data.ventas_brutas}
          icono={ShoppingCart}
          color="#f9b44c"
          bgColor="bg-[#f9b44c]/10"
          subtitulo={`${data.cantidad_ventas} ${data.cantidad_ventas === 1 ? 'venta' : 'ventas'}`}
        />
        <CardKPI
          etiqueta="Costo de mercadería"
          valor={data.cmv}
          icono={ArrowDown}
          color="#9e2f25"
          bgColor="bg-[#c43e2c]/8"
        />
        <CardKPI
          etiqueta="Margen bruto"
          valor={data.margen_bruto}
          icono={TrendingUp}
          color="#6f3a2a"
          bgColor="bg-white"
          subtitulo={
            data.ventas_brutas > 0
              ? `${Math.round((data.margen_bruto / data.ventas_brutas) * 100)}% s/ ventas`
              : undefined
          }
        />
        <CardKPI
          etiqueta="Mermas"
          valor={data.mermas}
          icono={PackageX}
          color="#c43e2c"
          bgColor="bg-[#c43e2c]/8"
        />
        <CardKPI
          etiqueta="Egresos"
          valor={data.egresos}
          icono={Receipt}
          color="#9e2f25"
          bgColor="bg-[#c43e2c]/8"
        />
        <CardKPI
          etiqueta="Resultado neto"
          valor={data.resultado_neto}
          icono={positivo ? ArrowUp : ArrowDown}
          color={positivo ? '#6f3a2a' : '#c43e2c'}
          bgColor={positivo ? 'bg-[#f9b44c]/15' : 'bg-[#c43e2c]/10'}
          destacar
        />
      </div>

      {data.cantidad_ventas > 0 && (
        <div className="bg-[#fdfaf6] border border-[#e4c9b0]/60 rounded-2xl p-3 flex items-center justify-between">
          <span className="text-xs uppercase tracking-wider text-[#6f3a2a] font-semibold">
            Ticket promedio
          </span>
          <span className="font-bold text-[#391511] tabular-nums">
            <MontoARS monto={data.ticket_promedio} />
          </span>
        </div>
      )}

      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <BarChart3 className="h-4 w-4 text-[#f9b44c]" />
          <h2 className="text-[#391511] font-bold">
            Ventas vs egresos por semana
          </h2>
        </div>
        <GraficoVentasEgresos series={data.series_semanales} />
      </div>
    </div>
  )
}

function CardKPI({
  etiqueta,
  valor,
  icono: Icono,
  color,
  bgColor,
  subtitulo,
  destacar,
}: {
  etiqueta: string
  valor: number
  icono: React.ElementType
  color: string
  bgColor: string
  subtitulo?: string
  destacar?: boolean
}) {
  return (
    <div
      className={cn(
        'rounded-2xl border-2 p-4 flex flex-col gap-2',
        bgColor,
        destacar ? 'border-current' : 'border-[#e4c9b0]/60'
      )}
      style={destacar ? { borderColor: color } : undefined}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
          {etiqueta}
        </span>
        <div
          className="p-1.5 rounded-lg"
          style={{ backgroundColor: `${color}22` }}
        >
          <Icono className="h-3.5 w-3.5" style={{ color }} />
        </div>
      </div>
      <div className="font-extrabold tabular-nums text-2xl text-[#391511]">
        <MontoARS monto={valor} />
      </div>
      {subtitulo && (
        <div className="text-[10px] text-[#6f3a2a]">{subtitulo}</div>
      )}
    </div>
  )
}
