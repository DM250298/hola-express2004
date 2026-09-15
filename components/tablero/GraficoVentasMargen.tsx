'use client'

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { formatearMontoEntero } from '@/lib/utils/formato'
import type { PuntoSerieTablero } from '@/lib/queries/tablero'

const formatoUnDecimal = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

interface PuntoGrafico {
  fecha: string
  ventas: number
  margenPct: number | null
  semanal: boolean
}

/**
 * Hasta 35 días se grafica por día; más largo, por tramos de 7 días
 * (el margen % del tramo se recalcula sobre la suma, no se promedia).
 */
function agrupar(serie: PuntoSerieTablero[]): PuntoGrafico[] {
  const semanal = serie.length > 35
  const tamano = semanal ? 7 : 1
  const puntos: PuntoGrafico[] = []
  for (let i = 0; i < serie.length; i += tamano) {
    const tramo = serie.slice(i, i + tamano)
    const ventas = tramo.reduce((s, p) => s + p.ventas, 0)
    const ingresos = tramo.reduce((s, p) => s + p.ingresos, 0)
    const hayMargen = tramo.some((p) => p.margen != null)
    const margen = tramo.reduce((s, p) => s + (p.margen ?? 0), 0)
    puntos.push({
      fecha: tramo[0].fecha,
      ventas,
      margenPct:
        hayMargen && ingresos > 0 ? Math.round((margen / ingresos) * 1000) / 10 : null,
      semanal,
    })
  }
  return puntos
}

function ejeMonto(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `${formatoUnDecimal.format(v / 1_000_000)}M`
  if (Math.abs(v) >= 1000) return `${Math.round(v / 1000)}k`
  return String(v)
}

export function GraficoVentasMargen({
  serie,
  puedeVerCostos,
}: {
  serie: PuntoSerieTablero[]
  puedeVerCostos: boolean
}) {
  const datos = agrupar(serie)
  const semanal = datos[0]?.semanal ?? false

  if (datos.every((p) => p.ventas === 0)) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-[#6f3a2a]">
        Sin ventas en el período.
      </div>
    )
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={datos} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e4c9b0" opacity={0.5} />
          <XAxis
            dataKey="fecha"
            tickFormatter={(v: string) => format(parseISO(v), 'dd MMM', { locale: es })}
            stroke="#6f3a2a"
            tick={{ fontSize: 11 }}
            axisLine={{ stroke: '#e4c9b0' }}
            tickLine={{ stroke: '#e4c9b0' }}
            interval="preserveStartEnd"
            minTickGap={20}
          />
          <YAxis
            yAxisId="monto"
            tickFormatter={ejeMonto}
            stroke="#6f3a2a"
            tick={{ fontSize: 11 }}
            axisLine={{ stroke: '#e4c9b0' }}
            tickLine={{ stroke: '#e4c9b0' }}
            width={44}
          />
          {puedeVerCostos && (
            <YAxis
              yAxisId="pct"
              orientation="right"
              tickFormatter={(v: number) => `${v}%`}
              stroke="#2f7d4f"
              tick={{ fontSize: 11 }}
              axisLine={{ stroke: '#e4c9b0' }}
              tickLine={{ stroke: '#e4c9b0' }}
              width={40}
            />
          )}
          <Tooltip content={<TooltipVentasMargen />} />
          <Legend
            verticalAlign="top"
            height={28}
            iconSize={10}
            wrapperStyle={{ fontSize: '11px', color: '#6f3a2a' }}
          />
          <Bar
            yAxisId="monto"
            name={semanal ? 'Ventas por semana' : 'Ventas por día'}
            dataKey="ventas"
            fill="#f9b44c"
            radius={[4, 4, 0, 0]}
          />
          {puedeVerCostos && (
            <Line
              yAxisId="pct"
              name="Margen %"
              dataKey="margenPct"
              type="monotone"
              stroke="#2f7d4f"
              strokeWidth={2}
              dot={false}
              connectNulls
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

interface PropsTooltip {
  active?: boolean
  label?: string
  payload?: Array<{ payload?: PuntoGrafico }>
}

function TooltipVentasMargen({ active, payload, label }: PropsTooltip) {
  if (!active || !payload || payload.length === 0) return null
  const punto = payload[0]?.payload
  if (!punto) return null
  return (
    <div className="rounded-lg border border-[#e4c9b0] bg-white px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-semibold text-[#391511]">
        {punto.semanal ? 'Semana del ' : ''}
        {label ? format(parseISO(label), "dd 'de' MMM", { locale: es }) : ''}
      </div>
      <div className="tabular-nums text-[#6f3a2a]">
        <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[#f9b44c]" />
        Ventas:{' '}
        <span className="font-bold text-[#391511]">{formatearMontoEntero(punto.ventas)}</span>
      </div>
      {punto.margenPct != null && (
        <div className="tabular-nums text-[#6f3a2a]">
          <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[#2f7d4f]" />
          Margen:{' '}
          <span className="font-bold text-[#391511]">
            {formatoUnDecimal.format(punto.margenPct)}%
          </span>
        </div>
      )}
    </div>
  )
}
