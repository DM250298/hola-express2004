'use client'

import { useMemo } from 'react'
import { LineChart as LineChartIcon, Timer } from 'lucide-react'
import { MontoARS } from '@/components/shared/MontoARS'
import { AyudaContextual } from '@/components/shared/AyudaContextual'
import { Sparkline } from './Sparkline'
import { cn } from '@/lib/utils'
import { formatearFechaCorta, formatearNumero } from '@/lib/utils/formato'
import { hoyIso, isoMasDias } from '@/lib/utils/periodos'
import { useMetricasSku } from '@/lib/hooks/useMetricasSku'

/**
 * Panel "Margen y quiebres · últimos 30 días" de la ficha de producto
 * (Fase C). Datos de fn_metricas_sku: serie diaria del snapshot (mig 173)
 * + quiebres del rango. Se oculta solo si la migración 178 no corrió.
 * El margen viene NULL para usuarios sin permiso 'costos' (gate en SQL).
 */
export function PanelInteligenciaSku({ productoId }: { productoId: number }) {
  const rango = useMemo(() => {
    const hasta = hoyIso()
    return { desde: isoMasDias(hasta, -29), hasta }
  }, [])
  const { data } = useMetricasSku(productoId, rango.desde, rango.hasta)

  // Migración 178 pendiente (null) o cargando (undefined) → nada.
  if (data == null) return null

  const serie = data.serie
  const ingresos = serie.reduce((s, p) => s + p.ingresos, 0)
  const hayMargen = serie.some((p) => p.margen != null)
  const margen = hayMargen
    ? serie.reduce((s, p) => s + (p.margen ?? 0), 0)
    : null
  const margenPct =
    margen != null && ingresos > 0 ? (margen / ingresos) * 100 : null
  const hayEstimados = serie.some((p) => p.estimado && p.ingresos > 0)

  const quiebres = data.quiebres
  const horasQuiebre = quiebres.reduce((s, q) => s + q.duracion_horas, 0)
  const perdida = quiebres.reduce((s, q) => s + (q.perdida_pesos ?? 0), 0)
  const abiertos = quiebres.filter((q) => q.fin_at == null).length

  const serieGrafico = hayMargen
    ? serie.map((p) => p.margen ?? 0)
    : serie.map((p) => p.ingresos)

  if (serie.length === 0 && quiebres.length === 0) return null

  return (
    <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <LineChartIcon className="h-4 w-4 text-[#f9b44c]" />
        <h2 className="text-[#391511] font-bold">
          {hayMargen ? 'Margen y quiebres' : 'Ventas y quiebres'}
        </h2>
        <span className="text-xs text-[#6f3a2a]">· últimos 30 días</span>
        {hayEstimados && (
          <AyudaContextual titulo="Parcialmente estimado">
            Algunos días no tienen costo congelado (ventas anteriores a la
            migración del costo por ítem, o productos sin costo cargado):
            para esos se usa el costo actual.
          </AyudaContextual>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
            Vendido
          </div>
          <div className="text-2xl font-extrabold text-[#391511] tabular-nums">
            <MontoARS monto={ingresos} />
          </div>
        </div>
        {margen != null && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
              Margen {hayEstimados && '*'}
            </div>
            <div
              className={cn(
                'text-2xl font-extrabold tabular-nums',
                margen >= 0 ? 'text-[#2f7d4f]' : 'text-[#c43e2c]'
              )}
            >
              <MontoARS monto={margen} />
              {margenPct != null && (
                <span className="text-sm font-semibold text-[#6f3a2a]">
                  {' '}
                  {margenPct.toFixed(1)}%
                </span>
              )}
            </div>
          </div>
        )}
        {serieGrafico.length > 1 && (
          <Sparkline
            datos={serieGrafico}
            ancho={180}
            alto={42}
            color={margen != null && margen < 0 ? '#c43e2c' : '#f9b44c'}
            conRelleno
            ariaLabel={
              hayMargen
                ? 'Margen diario de los últimos 30 días'
                : 'Ventas diarias de los últimos 30 días'
            }
          />
        )}
        <div className="ml-auto text-right">
          <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold flex items-center justify-end gap-1">
            <Timer className="h-3 w-3" />
            Quiebres 30 d
            {quiebres.length > 0 && (
              <AyudaContextual titulo="Estimación">
                Venta perdida = venta promedio previa al quiebre × días sin
                stock, a precio de venta. Es una estimación, no un dato
                contable.
              </AyudaContextual>
            )}
          </div>
          {quiebres.length === 0 ? (
            <div className="text-lg font-bold text-[#2f7d4f]">Sin quiebres</div>
          ) : (
            <>
              <div
                className={cn(
                  'text-2xl font-extrabold tabular-nums',
                  abiertos > 0 ? 'text-[#c43e2c]' : 'text-[#391511]'
                )}
              >
                {formatearNumero(quiebres.length)}
                {abiertos > 0 && (
                  <span className="text-xs font-semibold"> ({abiertos} activo{abiertos > 1 ? 's' : ''})</span>
                )}
              </div>
              <div className="text-[11px] text-[#6f3a2a] tabular-nums">
                {formatearNumero(Math.round(horasQuiebre))} h sin stock
                {perdida > 0 && (
                  <>
                    {' '}
                    · perdida est. ~<MontoARS monto={perdida} />
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {(data.ultima_venta || data.ultima_compra) && (
        <div className="flex flex-wrap gap-4 mt-3 pt-3 border-t border-[#e4c9b0]/60 text-xs text-[#6f3a2a]">
          {data.ultima_venta && (
            <span>
              Última venta:{' '}
              <strong className="text-[#391511]">
                {formatearFechaCorta(data.ultima_venta)}
              </strong>
            </span>
          )}
          {data.ultima_compra && (
            <span>
              Última compra:{' '}
              <strong className="text-[#391511]">
                {formatearFechaCorta(data.ultima_compra)}
              </strong>
            </span>
          )}
        </div>
      )}
    </div>
  )
}
