'use client'

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Skeleton } from '@/components/ui/skeleton'
import { useVentasPorHora } from '@/lib/hooks/useDashboard'
import { formatearMonto } from '@/lib/utils/formato'

interface PropsTooltip {
  active?: boolean
  label?: string | number
  payload?: Array<{ dataKey?: string | number; value?: number | null }>
}

export function GraficoVentasPorHora() {
  const { data, isLoading, isError } = useVentasPorHora()

  if (isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl bg-[#f9d2a2]/30" />
  }
  if (isError || !data) {
    return (
      <div className="h-64 flex items-center justify-center text-[#c43e2c] text-sm">
        No se pudo cargar el gráfico.
      </div>
    )
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 5, right: 15, bottom: 5, left: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#e4c9b0" opacity={0.5} />
          <XAxis
            dataKey="hora"
            tickFormatter={(v: number) => `${v}h`}
            stroke="#6f3a2a"
            tick={{ fontSize: 11 }}
            axisLine={{ stroke: '#e4c9b0' }}
            tickLine={{ stroke: '#e4c9b0' }}
            interval={2}
          />
          <YAxis
            tickFormatter={(v: number) =>
              v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)
            }
            stroke="#6f3a2a"
            tick={{ fontSize: 11 }}
            axisLine={{ stroke: '#e4c9b0' }}
            tickLine={{ stroke: '#e4c9b0' }}
          />
          <Tooltip content={<TooltipPersonalizado />} />
          <Legend
            verticalAlign="top"
            height={28}
            iconSize={10}
            wrapperStyle={{ fontSize: '11px', color: '#6f3a2a' }}
          />
          <Line
            name="Mismo día semana pasada"
            type="monotone"
            dataKey="hace_7_dias"
            stroke="#c8a58a"
            strokeWidth={2}
            strokeDasharray="4 4"
            dot={false}
            activeDot={{ r: 4, fill: '#6f3a2a' }}
            isAnimationActive={false}
          />
          <Line
            name="Hoy"
            type="monotone"
            dataKey="hoy"
            stroke="#f9b44c"
            strokeWidth={2.5}
            dot={{ r: 2.5, fill: '#f9b44c' }}
            activeDot={{ r: 5, fill: '#391511' }}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function TooltipPersonalizado({ active, payload, label }: PropsTooltip) {
  if (!active || !payload || payload.length === 0) return null
  const hoy = payload.find((p) => p.dataKey === 'hoy')?.value
  const hace = payload.find((p) => p.dataKey === 'hace_7_dias')?.value ?? 0
  return (
    <div className="bg-white border border-[#e4c9b0] rounded-lg shadow-md px-3 py-2 text-xs">
      <div className="font-semibold text-[#391511] mb-1">{label}:00 h</div>
      <div className="text-[#6f3a2a] tabular-nums">
        <span className="inline-block h-2 w-2 rounded-full bg-[#f9b44c] mr-1.5" />
        Hoy:{' '}
        <span className="font-bold text-[#391511]">
          {hoy == null ? '—' : formatearMonto(hoy)}
        </span>
      </div>
      <div className="text-[#6f3a2a] tabular-nums">
        <span className="inline-block h-2 w-2 rounded-full bg-[#c8a58a] mr-1.5" />
        Hace 7 días:{' '}
        <span className="font-bold text-[#391511]">
          {formatearMonto(hace)}
        </span>
      </div>
    </div>
  )
}
