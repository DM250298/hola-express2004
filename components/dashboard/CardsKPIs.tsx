'use client'

import { Calculator, DollarSign, Receipt, UserCircle2 } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { MontoARS } from '@/components/shared/MontoARS'
import { formatearFechaHora } from '@/lib/utils/formato'
import { useKPIsDia } from '@/lib/hooks/useDashboard'
import { cn } from '@/lib/utils'

export function CardsKPIs() {
  const { data, isLoading, isError } = useKPIsDia()

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-2xl bg-[#f9d2a2]/30" />
        ))}
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="p-6 bg-[#c43e2c]/5 border border-[#c43e2c]/30 rounded-2xl text-center text-[#c43e2c] text-sm">
        No se pudieron cargar los KPIs.
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <Card
        etiqueta="Ventas de hoy"
        valor={<MontoARS monto={data.ventas_total} />}
        icono={DollarSign}
        color="#f9b44c"
        bgColor="bg-[#f9b44c]/10"
        destacar
      />
      <Card
        etiqueta="Tickets de hoy"
        valor={String(data.cantidad_tickets)}
        icono={Receipt}
        color="#6f3a2a"
        bgColor="bg-white"
      />
      <Card
        etiqueta="Ticket promedio"
        valor={<MontoARS monto={data.ticket_promedio} />}
        icono={Calculator}
        color="#6f3a2a"
        bgColor="bg-white"
      />
      <Card
        etiqueta="Turno activo"
        valor={
          data.turno_activo ? (
            <div className="leading-tight">
              <div className="text-base">
                {data.turno_activo.cajero_nombre ?? '—'}
              </div>
              <div className="text-xs text-[#6f3a2a] font-normal mt-0.5">
                Abierto {formatearFechaHora(data.turno_activo.fecha_apertura)}
              </div>
            </div>
          ) : (
            <span className="text-[#c8a58a] italic text-base font-medium">
              Sin turno abierto
            </span>
          )
        }
        icono={UserCircle2}
        color="#391511"
        bgColor={data.turno_activo ? 'bg-[#f9b44c]/15' : 'bg-[#c8a58a]/20'}
        valorComoTexto={!data.turno_activo}
      />
    </div>
  )
}

function Card({
  etiqueta,
  valor,
  icono: Icono,
  color,
  bgColor,
  destacar,
  valorComoTexto,
}: {
  etiqueta: string
  valor: React.ReactNode
  icono: React.ElementType
  color: string
  bgColor: string
  destacar?: boolean
  valorComoTexto?: boolean
}) {
  return (
    <div
      className={cn(
        'rounded-2xl border-2 p-4 flex flex-col gap-2',
        bgColor,
        destacar ? 'border-[#f9b44c]' : 'border-[#e4c9b0]/60'
      )}
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
      <div
        className={cn(
          'font-extrabold text-[#391511] tabular-nums',
          valorComoTexto ? 'text-sm' : 'text-2xl'
        )}
      >
        {valor}
      </div>
    </div>
  )
}
