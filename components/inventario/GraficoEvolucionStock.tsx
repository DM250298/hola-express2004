'use client'

import { useMemo } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { Skeleton } from '@/components/ui/skeleton'
import { useEvolucionStock } from '@/lib/hooks/useInventario'

interface Props {
  producto_id: number
  stock_minimo: number
}

export function GraficoEvolucionStock({ producto_id, stock_minimo }: Props) {
  const { data, isLoading } = useEvolucionStock(producto_id, 30)

  const datosGrafico = useMemo(
    () =>
      (data ?? []).map((p) => ({
        fecha: p.fecha,
        stock: p.stock,
        minimo: stock_minimo,
      })),
    [data, stock_minimo]
  )

  if (isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl bg-[#f9d2a2]/30" />
  }

  if (!datosGrafico.length) {
    return (
      <div className="h-64 flex items-center justify-center text-[#6f3a2a] text-sm">
        Sin datos suficientes para graficar.
      </div>
    )
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={datosGrafico}
          margin={{ top: 5, right: 15, bottom: 5, left: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#e4c9b0" opacity={0.5} />
          <XAxis
            dataKey="fecha"
            tickFormatter={(v: string) =>
              format(parseISO(v), 'dd/MM', { locale: es })
            }
            stroke="#6f3a2a"
            tick={{ fontSize: 11 }}
            axisLine={{ stroke: '#e4c9b0' }}
            tickLine={{ stroke: '#e4c9b0' }}
            interval="preserveStartEnd"
            minTickGap={20}
          />
          <YAxis
            stroke="#6f3a2a"
            tick={{ fontSize: 11 }}
            axisLine={{ stroke: '#e4c9b0' }}
            tickLine={{ stroke: '#e4c9b0' }}
            allowDecimals={false}
          />
          <Tooltip content={<TooltipPersonalizado />} />
          <Line
            type="monotone"
            dataKey="minimo"
            stroke="#c43e2c"
            strokeWidth={1}
            strokeDasharray="4 4"
            dot={false}
            activeDot={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="stock"
            stroke="#f9b44c"
            strokeWidth={2.5}
            dot={{ r: 2.5, fill: '#f9b44c' }}
            activeDot={{ r: 5, fill: '#391511' }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

interface PropsTooltip {
  active?: boolean
  label?: string
  payload?: Array<{ dataKey?: string | number; value?: number }>
}

function TooltipPersonalizado({ active, payload, label }: PropsTooltip) {
  if (!active || !payload || payload.length === 0) return null
  const stock = payload.find((p) => p.dataKey === 'stock')?.value
  const minimo = payload.find((p) => p.dataKey === 'minimo')?.value
  return (
    <div className="bg-white border border-[#e4c9b0] rounded-lg shadow-md px-3 py-2 text-xs">
      <div className="font-semibold text-[#391511]">
        {label
          ? format(parseISO(label), "dd 'de' MMM", { locale: es })
          : null}
      </div>
      <div className="text-[#6f3a2a] mt-0.5 tabular-nums">
        Stock: <span className="font-bold text-[#391511]">{stock}</span>
      </div>
      {minimo != null && (
        <div className="text-[#c43e2c] text-[10px] tabular-nums">
          Mínimo: {minimo}
        </div>
      )}
    </div>
  )
}
