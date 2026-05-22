'use client'

import { AlertTriangle, Package, XOctagon } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useResumenAlertasStock } from '@/lib/hooks/useInventario'
import type { EstadoStock } from '@/lib/queries/inventario'

interface Props {
  estadoFiltro: EstadoStock | null
  onCambiarFiltro: (estado: EstadoStock | null) => void
}

export function PanelAlertas({ estadoFiltro, onCambiarFiltro }: Props) {
  const { data: resumen, isLoading } = useResumenAlertasStock()

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-24 rounded-2xl bg-[#f9d2a2]/30" />
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <CardKPI
        etiqueta="Productos activos"
        valor={resumen?.total_productos ?? 0}
        icono={Package}
        color="#6f3a2a"
        bgColor="bg-white"
        activo={estadoFiltro === null}
        onClick={() => onCambiarFiltro(null)}
      />
      <CardKPI
        etiqueta="Stock bajo o agotado"
        valor={resumen?.bajo_stock ?? 0}
        icono={AlertTriangle}
        color="#e4a42a"
        bgColor="bg-[#e4a42a]/10"
        activo={estadoFiltro === 'bajo'}
        onClick={() =>
          onCambiarFiltro(estadoFiltro === 'bajo' ? null : 'bajo')
        }
        destacar={(resumen?.bajo_stock ?? 0) > 0}
      />
      <CardKPI
        etiqueta="Sin stock"
        valor={resumen?.agotados ?? 0}
        icono={XOctagon}
        color="#c43e2c"
        bgColor="bg-[#c43e2c]/10"
        activo={estadoFiltro === 'critico'}
        onClick={() =>
          onCambiarFiltro(estadoFiltro === 'critico' ? null : 'critico')
        }
        destacar={(resumen?.agotados ?? 0) > 0}
      />
    </div>
  )
}

function CardKPI({
  etiqueta,
  valor,
  icono: Icono,
  color,
  bgColor,
  activo,
  onClick,
  destacar,
}: {
  etiqueta: string
  valor: number
  icono: React.ElementType
  color: string
  bgColor: string
  activo: boolean
  onClick: () => void
  destacar?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group text-left rounded-2xl border-2 transition-all p-4 flex items-center gap-3',
        bgColor,
        activo
          ? 'border-[#391511] shadow-md'
          : 'border-[#e4c9b0]/60 hover:border-[#c8a58a]',
        destacar && !activo && 'ring-2 ring-offset-1 ring-[#f9b44c]/40'
      )}
    >
      <div
        className="shrink-0 p-2.5 rounded-xl"
        style={{ backgroundColor: `${color}22` }}
      >
        <Icono className="h-5 w-5" style={{ color }} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
          {etiqueta}
        </div>
        <div className="text-3xl font-extrabold text-[#391511] tabular-nums leading-tight">
          {valor}
        </div>
      </div>
      {activo && (
        <span className="text-[10px] font-medium text-[#391511] uppercase tracking-wider opacity-70">
          filtrado
        </span>
      )}
    </button>
  )
}
