'use client'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from 'recharts'
import { formatearMonto } from '@/lib/utils/formato'
import type { ProductoABC } from '@/lib/queries/clasificacionAbc'

interface Props {
  productos: ProductoABC[]
  /** Cuántos productos mostrar en el gráfico (default 20). */
  limite?: number
}

const COLOR_CLASE: Record<string, string> = {
  A: '#2f8f4e',
  B: '#f9b44c',
  C: '#c43e2c',
}

export function GraficoABC({ productos, limite = 20 }: Props) {
  const top = productos
    .filter((p) => p.ingresos > 0)
    .slice(0, limite)

  if (top.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-[#6f3a2a] text-sm">
        No hay ventas en el período seleccionado.
      </div>
    )
  }

  const datos = top.map((p) => ({
    nombre:
      p.nombre.length > 22 ? p.nombre.slice(0, 20) + '…' : p.nombre,
    ingresos: p.ingresos,
    clase: p.clase,
    porcentaje: p.porcentaje_ingreso,
  }))

  return (
    <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-5">
      <h3 className="text-[#391511] font-bold text-sm mb-4">
        Top {top.length} productos por ingreso
      </h3>
      <div className="h-[400px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={datos}
            layout="vertical"
            margin={{ top: 0, right: 20, bottom: 0, left: 10 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#e4c9b0"
              opacity={0.5}
              horizontal={false}
            />
            <XAxis
              type="number"
              tickFormatter={(v: number) => formatearMonto(v)}
              tick={{ fontSize: 11, fill: '#6f3a2a' }}
              axisLine={false}
            />
            <YAxis
              type="category"
              dataKey="nombre"
              width={160}
              tick={{ fontSize: 11, fill: '#391511' }}
              axisLine={false}
            />
            <Tooltip
              formatter={(value) => [formatearMonto(Number(value)), 'Ingresos']}
              contentStyle={{
                backgroundColor: '#fdfaf6',
                border: '1px solid #e4c9b0',
                borderRadius: 12,
                fontSize: 13,
              }}
            />
            <Bar dataKey="ingresos" radius={[0, 6, 6, 0]} barSize={18}>
              {datos.map((d, i) => (
                <Cell key={i} fill={COLOR_CLASE[d.clase] ?? '#c8a58a'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {/* Leyenda */}
      <div className="flex items-center gap-4 mt-3 justify-center">
        {(['A', 'B', 'C'] as const).map((c) => (
          <div key={c} className="flex items-center gap-1.5">
            <div
              className="h-3 w-3 rounded-sm"
              style={{ backgroundColor: COLOR_CLASE[c] }}
            />
            <span className="text-xs text-[#6f3a2a] font-medium">
              Clase {c}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
