'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Layers } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { EstadoError } from '@/components/shared/EstadoError'
import { cn } from '@/lib/utils'
import { formatearMontoEntero, formatearNumero } from '@/lib/utils/formato'
import { useMetricasAgrupadas } from '@/lib/hooks/useTablero'
import {
  ETIQUETA_DIMENSION,
  type DimensionTablero,
} from '@/lib/queries/tablero'

const DIMENSIONES: DimensionTablero[] = [
  'categoria',
  'marca',
  'proveedor',
  'gondola',
  'clase_abc',
]
const FILAS_INICIALES = 15

const formatoUnDecimal = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

interface Props {
  desde: string
  hasta: string
  /** Query string del período, para que el drill-down abra el mismo rango. */
  paramsPeriodo: string
  puedeVerCostos: boolean
}

/**
 * Tabla pivotante del tablero: el negocio agrupado por la dimensión que
 * elijas (fn_metricas_agrupadas, mig 180). Cada fila abre el tab Análisis
 * de Stock filtrado por ese valor.
 */
export function TablaDimensiones({ desde, hasta, paramsPeriodo, puedeVerCostos }: Props) {
  const [dimension, setDimension] = useState<DimensionTablero>('categoria')
  const [verTodas, setVerTodas] = useState(false)
  const { data, isLoading, isError, refetch } = useMetricasAgrupadas(
    dimension,
    desde,
    hasta
  )

  const filas = data ?? []
  const visibles = verTodas ? filas : filas.slice(0, FILAS_INICIALES)
  const maxIngresos = Math.max(1, ...filas.map((f) => f.ingresos))

  return (
    <section className="overflow-hidden rounded-2xl border border-[#e4c9b0]/60 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b border-[#e4c9b0]/60 bg-[#fdfaf6] px-4 py-2.5">
        <Layers className="h-4 w-4 text-[#f9b44c]" />
        <h2 className="text-sm font-semibold text-[#391511]">El negocio por</h2>
        <div className="flex flex-wrap gap-1">
          {DIMENSIONES.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => {
                setDimension(d)
                setVerTodas(false)
              }}
              className={cn(
                'rounded-lg border px-2.5 py-1 text-xs font-semibold',
                dimension === d
                  ? 'border-[#391511] bg-[#391511] text-white'
                  : 'border-[#e4c9b0] text-[#6f3a2a] hover:border-[#c8a58a]'
              )}
            >
              {ETIQUETA_DIMENSION[d]}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2 p-4">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-7 rounded-lg bg-[#f9d2a2]/30" />
          ))}
        </div>
      ) : isError ? (
        <div className="p-4">
          <EstadoError onReintentar={refetch} />
        </div>
      ) : data === null ? (
        <p className="p-4 text-sm text-[#6f3a2a]">
          Falta correr la migración 180 (fn_metricas_agrupadas).
        </p>
      ) : filas.length === 0 ? (
        <p className="p-6 text-center text-sm text-[#c8a58a]">Sin datos en el período.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#e4c9b0]/60 text-left text-[10px] uppercase tracking-wider text-[#6f3a2a]">
                  <th className="px-4 py-2 font-semibold">{ETIQUETA_DIMENSION[dimension]}</th>
                  <th className="px-2 py-2 font-semibold">Ventas</th>
                  {puedeVerCostos && (
                    <>
                      <th className="px-2 py-2 text-right font-semibold">Margen</th>
                      <th className="px-2 py-2 text-right font-semibold">Stock $</th>
                      <th className="px-2 py-2 text-right font-semibold">Días inv.</th>
                    </>
                  )}
                  <th className="px-2 py-2 text-right font-semibold">Productos</th>
                  <th className="px-2 py-2 text-right font-semibold">Sin vender</th>
                  <th className="px-4 py-2 text-right font-semibold">Quiebres</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((f) => (
                  <tr
                    key={f.clave}
                    className="border-b border-[#e4c9b0]/40 last:border-0 hover:bg-[#fdfaf6]"
                  >
                    <td className="px-4 py-2">
                      <Link
                        href={`/inventario?tab=analisis&dim=${dimension}&valor=${encodeURIComponent(f.clave)}&${paramsPeriodo}`}
                        className="font-medium text-[#391511] hover:underline"
                      >
                        {f.clave}
                      </Link>
                    </td>
                    <td className="min-w-44 px-2 py-2">
                      <div className="flex items-baseline justify-between gap-2 tabular-nums">
                        <span className="font-semibold text-[#391511]">
                          {formatearMontoEntero(f.ingresos)}
                        </span>
                        {f.participacion_ingresos != null && (
                          <span className="text-[11px] text-[#6f3a2a]">
                            {formatoUnDecimal.format(f.participacion_ingresos)}%
                          </span>
                        )}
                      </div>
                      <div className="mt-1 h-1 overflow-hidden rounded-full bg-[#f9d2a2]/40">
                        <div
                          className="h-full rounded-full bg-[#f9b44c]"
                          style={{ width: `${Math.max(2, (f.ingresos / maxIngresos) * 100)}%` }}
                        />
                      </div>
                    </td>
                    {puedeVerCostos && (
                      <>
                        <td
                          className={cn(
                            'px-2 py-2 text-right tabular-nums',
                            (f.margen_pesos ?? 0) < 0 && 'font-semibold text-[#c43e2c]'
                          )}
                        >
                          {f.margen_pesos != null ? formatearMontoEntero(f.margen_pesos) : '—'}
                          {f.margen_pct != null && (
                            <span className="block text-[11px] text-[#6f3a2a]">
                              {formatoUnDecimal.format(f.margen_pct)}%
                              {f.costo_estimado && ' *'}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">
                          {f.stock_valorizado != null ? formatearMontoEntero(f.stock_valorizado) : '—'}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">
                          {f.dias_inventario != null ? formatearNumero(f.dias_inventario) : '—'}
                        </td>
                      </>
                    )}
                    <td className="px-2 py-2 text-right tabular-nums text-[#6f3a2a]">
                      {formatearNumero(f.skus_con_venta)}
                      <span className="text-[#c8a58a]"> / {formatearNumero(f.skus)}</span>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-[#6f3a2a]">
                      {f.skus_sin_movimiento > 0 ? formatearNumero(f.skus_sin_movimiento) : '—'}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {f.quiebres > 0 ? (
                        <span className="font-semibold text-[#9e2f25]">
                          {formatearNumero(f.quiebres)}
                          {f.venta_perdida_pesos > 0 && (
                            <span className="block text-[10px] font-normal">
                              ~{formatearMontoEntero(f.venta_perdida_pesos)}
                            </span>
                          )}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filas.length > FILAS_INICIALES && (
            <div className="border-t border-[#e4c9b0]/60 px-4 py-2 text-center">
              <button
                type="button"
                onClick={() => setVerTodas((v) => !v)}
                className="text-xs font-semibold text-[#9e6b15] hover:text-[#391511] hover:underline"
              >
                {verTodas ? 'Ver menos' : `Ver todas (${formatearNumero(filas.length)})`}
              </button>
            </div>
          )}
          <p className="border-t border-[#e4c9b0]/60 px-4 py-2 text-[11px] text-[#c8a58a]">
            Productos = con ventas / total activos. Días inv. = stock a costo ÷ costo de lo
            vendido por día. {puedeVerCostos && '* margen parcialmente estimado con costo actual.'}
          </p>
        </>
      )}
    </section>
  )
}
