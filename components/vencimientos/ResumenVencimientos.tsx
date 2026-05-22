'use client'

import { AlertTriangle, Package, TrendingDown } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { MontoARS } from '@/components/shared/MontoARS'
import { useResumenVencimientos } from '@/lib/hooks/useVencimientos'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

export function ResumenVencimientos() {
  const { data: resumen, isLoading } = useResumenVencimientos()

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-24 rounded-2xl bg-[#f9d2a2]/30" />
        ))}
      </div>
    )
  }

  const mesEnCurso = format(new Date(), 'MMMM', { locale: es })

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <CardKPI
        etiqueta="Próximas a vencer (<7 días)"
        valor={String(resumen?.unidades_por_vencer ?? 0)}
        sufijo={resumen?.unidades_por_vencer === 1 ? 'unidad' : 'unidades'}
        icono={AlertTriangle}
        color="#e4a42a"
        bgColor="bg-[#e4a42a]/10"
        destacar={(resumen?.unidades_por_vencer ?? 0) > 0}
      />
      <CardKPI
        etiqueta={`Mermas de ${mesEnCurso}`}
        valor={String(resumen?.mermas_mes_unidades ?? 0)}
        sufijo={resumen?.mermas_mes_unidades === 1 ? 'unidad' : 'unidades'}
        icono={Package}
        color="#6f3a2a"
        bgColor="bg-white"
      />
      <CardKPI
        etiqueta="Valor de mermas del mes"
        valor={<MontoARS monto={resumen?.mermas_mes_monto ?? 0} />}
        icono={TrendingDown}
        color="#c43e2c"
        bgColor="bg-[#c43e2c]/5"
      />
    </div>
  )
}

function CardKPI({
  etiqueta,
  valor,
  sufijo,
  icono: Icono,
  color,
  bgColor,
  destacar,
}: {
  etiqueta: string
  valor: React.ReactNode
  sufijo?: string
  icono: React.ElementType
  color: string
  bgColor: string
  destacar?: boolean
}) {
  return (
    <div
      className={`rounded-2xl border-2 p-4 flex items-center gap-3 ${bgColor} ${
        destacar ? 'border-[#e4a42a]' : 'border-[#e4c9b0]/60'
      }`}
    >
      <div
        className="shrink-0 p-2.5 rounded-xl"
        style={{ backgroundColor: `${color}22` }}
      >
        <Icono className="h-5 w-5" style={{ color }} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold capitalize">
          {etiqueta}
        </div>
        <div className="text-3xl font-extrabold text-[#391511] tabular-nums leading-tight flex items-baseline gap-1.5">
          {valor}
          {sufijo && (
            <span className="text-xs text-[#6f3a2a] font-medium">
              {sufijo}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
