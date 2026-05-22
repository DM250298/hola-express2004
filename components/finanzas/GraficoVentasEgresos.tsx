'use client'

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { formatearMonto } from '@/lib/utils/formato'
import type { PuntoSemana } from '@/lib/queries/finanzas'

interface Props {
  series: PuntoSemana[]
}

interface PropsTooltip {
  active?: boolean
  label?: string
  payload?: Array<{ dataKey?: string | number; value?: number; color?: string }>
}

export function GraficoVentasEgresos({ series }: Props) {
  if (series.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-[#6f3a2a] text-sm">
        Sin datos del período.
      </div>
    )
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={series}
          margin={{ top: 5, right: 15, bottom: 5, left: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#e4c9b0" opacity={0.5} />
          <XAxis
            dataKey="semana"
            tickFormatter={(v: string) =>
              format(parseISO(v), 'dd MMM', { locale: es })
            }
            stroke="#6f3a2a"
            tick={{ fontSize: 11 }}
            axisLine={{ stroke: '#e4c9b0' }}
            tickLine={{ stroke: '#e4c9b0' }}
            interval="preserveStartEnd"
            minTickGap={20}
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
          <Bar
            name="Ventas"
            dataKey="ventas"
            fill="#f9b44c"
            radius={[6, 6, 0, 0]}
          />
          <Bar
            name="Egresos"
            dataKey="egresos"
            fill="#c43e2c"
            radius={[6, 6, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function TooltipPersonalizado({ active, payload, label }: PropsTooltip) {
  if (!active || !payload || payload.length === 0) return null
  const ventas = payload.find((p) => p.dataKey === 'ventas')?.value ?? 0
  const egresos = payload.find((p) => p.dataKey === 'egresos')?.value ?? 0
  return (
    <div className="bg-white border border-[#e4c9b0] rounded-lg shadow-md px-3 py-2 text-xs">
      <div className="font-semibold text-[#391511] mb-1">
        Semana del{' '}
        {label ? format(parseISO(label), "dd 'de' MMM", { locale: es }) : ''}
      </div>
      <div className="text-[#6f3a2a] tabular-nums">
        <span className="inline-block h-2 w-2 rounded-full bg-[#f9b44c] mr-1.5" />
        Ventas:{' '}
        <span className="font-bold text-[#391511]">
          {formatearMonto(ventas)}
        </span>
      </div>
      <div className="text-[#6f3a2a] tabular-nums">
        <span className="inline-block h-2 w-2 rounded-full bg-[#c43e2c] mr-1.5" />
        Egresos:{' '}
        <span className="font-bold text-[#391511]">
          {formatearMonto(egresos)}
        </span>
      </div>
    </div>
  )
}
