'use client'

import { Crown, Package, TrendingUp } from 'lucide-react'
import { MontoARS } from '@/components/shared/MontoARS'
import { formatearNumero } from '@/lib/utils/formato'
import type { ResumenABC } from '@/lib/queries/clasificacionAbc'

interface Props {
  resumen: ResumenABC
}

const COLORES_CLASE = {
  A: { bg: 'bg-[#2f8f4e]/10', text: 'text-[#2f8f4e]', border: 'border-[#2f8f4e]/30' },
  B: { bg: 'bg-[#f9b44c]/10', text: 'text-[#b07d1e]', border: 'border-[#f9b44c]/40' },
  C: { bg: 'bg-[#c43e2c]/10', text: 'text-[#c43e2c]', border: 'border-[#c43e2c]/30' },
} as const

export function CardsKPIsABC({ resumen }: Props) {
  return (
    <div className="space-y-3">
      {/* Fila superior: resumen general */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <CardKPI
          etiqueta="Ingresos del período"
          valor={<MontoARS monto={resumen.total_ingresos} />}
          icono={TrendingUp}
          color="#f9b44c"
          bgColor="bg-[#f9b44c]/10"
          destacar
        />
        <CardKPI
          etiqueta="Productos con ventas"
          valor={`${formatearNumero(resumen.productos_con_ventas)} / ${formatearNumero(resumen.productos_totales)}`}
          icono={Package}
          color="#6f3a2a"
          bgColor="bg-white"
        />
        <CardKPI
          etiqueta="Sin movimiento"
          valor={formatearNumero(
            resumen.productos_totales - resumen.productos_con_ventas
          )}
          icono={Package}
          color="#c43e2c"
          bgColor="bg-[#c43e2c]/5"
        />
        <CardKPI
          etiqueta="Productos estrella (A)"
          valor={formatearNumero(resumen.clases.A.cantidad)}
          icono={Crown}
          color="#2f8f4e"
          bgColor="bg-[#2f8f4e]/5"
        />
      </div>

      {/* Fila inferior: desglose por clase */}
      <div className="grid grid-cols-3 gap-3">
        {(['A', 'B', 'C'] as const).map((clase) => {
          const detalle = resumen.clases[clase]
          const col = COLORES_CLASE[clase]
          return (
            <div
              key={clase}
              className={`rounded-2xl border ${col.border} ${col.bg} p-4`}
            >
              <div className="flex items-center justify-between mb-2">
                <span
                  className={`text-2xl font-extrabold ${col.text}`}
                >
                  {clase}
                </span>
                <span className="text-xs font-bold text-[#6f3a2a] bg-white/60 rounded-full px-2 py-0.5">
                  {detalle.cantidad} productos
                </span>
              </div>
              <div className="text-sm font-bold text-[#391511] tabular-nums">
                <MontoARS monto={detalle.ingresos} />
              </div>
              <div className="text-xs text-[#6f3a2a] mt-0.5">
                {detalle.porcentaje_ingreso.toFixed(1)} % del ingreso
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Card individual ────────────────────────────────────────────────────────

interface CardKPIProps {
  etiqueta: string
  valor: React.ReactNode
  icono: React.ElementType
  color: string
  bgColor: string
  destacar?: boolean
}

function CardKPI({
  etiqueta,
  valor,
  icono: Icono,
  color,
  bgColor,
  destacar,
}: CardKPIProps) {
  return (
    <div
      className={`rounded-2xl border border-[#e4c9b0]/60 p-4 ${bgColor} ${
        destacar ? 'ring-2 ring-[#f9b44c]/40' : ''
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        <div
          className="p-1.5 rounded-lg"
          style={{ backgroundColor: `${color}15` }}
        >
          <Icono className="h-4 w-4" style={{ color }} />
        </div>
        <span className="text-xs text-[#6f3a2a] font-medium">
          {etiqueta}
        </span>
      </div>
      <div className="text-lg font-extrabold text-[#391511] tabular-nums leading-tight">
        {valor}
      </div>
    </div>
  )
}
