'use client'

import Link from 'next/link'
import {
  AlertTriangle,
  Calendar,
  ChevronRight,
  CircleCheck,
  Package,
  Wallet,
} from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { useAlertasDashboard } from '@/lib/hooks/useDashboard'
import { cn } from '@/lib/utils'

export function PanelAlertas() {
  const { data, isLoading, isError } = useAlertasDashboard()

  if (isLoading) {
    return <Skeleton className="h-40 rounded-2xl bg-[#f9d2a2]/30" />
  }
  if (isError || !data) return null

  const totalAlertas =
    data.productos_bajo_stock + data.lotes_por_vencer + data.cuentas_vencidas
  const sinAlertas = totalAlertas === 0

  return (
    <div
      className={cn(
        'rounded-2xl border-2 p-5 shadow-sm',
        sinAlertas
          ? 'bg-[#f9b44c]/10 border-[#f9b44c]/40'
          : 'bg-[#c43e2c]/[0.03] border-[#c43e2c]/30'
      )}
    >
      <div className="flex items-center gap-2 mb-3">
        {sinAlertas ? (
          <>
            <CircleCheck className="h-5 w-5 text-[#6f3a2a]" />
            <h2 className="text-[#391511] font-bold">Todo en orden</h2>
            <span className="text-xs text-[#6f3a2a]">
              · sin alertas activas
            </span>
          </>
        ) : (
          <>
            <AlertTriangle className="h-5 w-5 text-[#c43e2c]" />
            <h2 className="text-[#391511] font-bold">Alertas activas</h2>
            <span className="text-xs text-[#9e2f25] font-semibold">
              · {totalAlertas} {totalAlertas === 1 ? 'requiere' : 'requieren'}{' '}
              atención
            </span>
          </>
        )}
      </div>

      {sinAlertas ? (
        <p className="text-[#6f3a2a] text-sm">
          No hay productos bajo stock, vencimientos urgentes ni cuentas
          vencidas. Buen trabajo.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <ItemAlerta
            href="/inventario"
            icono={Package}
            etiqueta="Productos bajo stock mínimo"
            cantidad={data.productos_bajo_stock}
            color="#e4a42a"
          />
          <ItemAlerta
            href="/vencimientos"
            icono={Calendar}
            etiqueta="Lotes vencen en < 3 días"
            cantidad={data.lotes_por_vencer}
            color="#c43e2c"
          />
          <ItemAlerta
            href="/finanzas"
            icono={Wallet}
            etiqueta="Cuentas vencidas"
            cantidad={data.cuentas_vencidas}
            color="#9e2f25"
          />
        </div>
      )}
    </div>
  )
}

function ItemAlerta({
  href,
  icono: Icono,
  etiqueta,
  cantidad,
  color,
}: {
  href: string
  icono: React.ElementType
  etiqueta: string
  cantidad: number
  color: string
}) {
  const cero = cantidad === 0
  return (
    <Link
      href={href}
      className={cn(
        'group flex items-center gap-3 p-3 rounded-xl border bg-white transition-all',
        cero
          ? 'border-[#e4c9b0]/60 opacity-60'
          : 'border-[#e4c9b0]/60 hover:border-[#f9b44c] hover:shadow-md'
      )}
    >
      <div
        className="shrink-0 p-2 rounded-lg"
        style={{ backgroundColor: cero ? '#c8a58a22' : `${color}22` }}
      >
        <Icono
          className="h-4 w-4"
          style={{ color: cero ? '#c8a58a' : color }}
        />
      </div>
      <div className="flex-1 min-w-0">
        <div
          className={cn(
            'text-3xl font-extrabold tabular-nums leading-none',
            cero ? 'text-[#c8a58a]' : 'text-[#391511]'
          )}
        >
          {cantidad}
        </div>
        <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold mt-1">
          {etiqueta}
        </div>
      </div>
      {!cero && (
        <ChevronRight className="h-4 w-4 text-[#c8a58a] group-hover:translate-x-0.5 group-hover:text-[#391511] transition-all" />
      )}
    </Link>
  )
}
