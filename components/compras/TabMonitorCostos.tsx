'use client'

import { useState } from 'react'
import {
  ArrowDownRight,
  ArrowUpRight,
  Loader2,
  Save,
  TrendingUp,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { SkeletonTabla } from '@/components/shared/SkeletonTabla'
import { MontoARS } from '@/components/shared/MontoARS'
import {
  useHistorialCostos,
  useConfigCompras,
  useActualizarConfigCompras,
} from '@/lib/hooks/useHistorialCostos'
import { formatearFechaHora } from '@/lib/utils/formato'

export function TabMonitorCostos() {
  const { data: historial, isLoading } = useHistorialCostos(100)
  const { data: config } = useConfigCompras()
  const actualizar = useActualizarConfigCompras()
  const [umbral, setUmbral] = useState<string>('')

  const umbralActual = config?.umbral_variacion_costo ?? 10
  const valorUmbral = umbral === '' ? String(umbralActual) : umbral

  function guardarUmbral() {
    const n = Number(valorUmbral)
    if (Number.isNaN(n) || n < 0) return
    actualizar.mutate({ umbral_variacion_costo: n })
  }

  return (
    <div className="space-y-5">
      {/* Config de umbral */}
      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-5 shadow-sm">
        <div className="flex items-start gap-3 flex-wrap justify-between">
          <div>
            <h3 className="text-[#391511] font-semibold flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-[#f9b44c]" />
              Umbral de alerta de variación de costo
            </h3>
            <p className="text-[#6f3a2a] text-sm mt-1 max-w-md">
              Cuando un producto sube de costo por encima de este porcentaje, el
              sistema te alerta para que evalúes remarcar el precio de venta.
            </p>
          </div>
          <div className="flex items-end gap-2">
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                Umbral (%)
              </Label>
              <Input
                type="number"
                min="0"
                step="1"
                value={valorUmbral}
                onChange={(e) => setUmbral(e.target.value)}
                className="w-24 h-10 text-center tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
              />
            </div>
            <Button
              onClick={guardarUmbral}
              disabled={actualizar.isPending}
              className="h-10 bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5"
            >
              {actualizar.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Guardar
            </Button>
          </div>
        </div>
      </div>

      {/* Historial */}
      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden shadow-sm">
        <div className="px-5 py-3 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <h3 className="text-[#391511] font-semibold text-sm">
            Variaciones de costo recientes
          </h3>
        </div>
        {isLoading ? (
          <div className="p-6">
            <SkeletonTabla filas={8} columnas={6} />
          </div>
        ) : !historial || historial.length === 0 ? (
          <div className="p-12 text-center">
            <div className="inline-flex p-3 rounded-full bg-[#f9d2a2]/40 mb-3">
              <TrendingUp className="h-6 w-6 text-[#6f3a2a]" />
            </div>
            <p className="text-[#391511] font-semibold">
              Todavía no hay variaciones registradas
            </p>
            <p className="text-[#6f3a2a] text-sm mt-1">
              Cuando recibas mercadería o cargues facturas con costos distintos,
              vas a verlas acá.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-b-[#e4c9b0]/60 bg-[#fdfaf6] hover:bg-[#fdfaf6]">
                  <TableHead className="text-[#391511] font-semibold">
                    Fecha
                  </TableHead>
                  <TableHead className="text-[#391511] font-semibold">
                    Producto
                  </TableHead>
                  <TableHead className="text-right text-[#391511] font-semibold">
                    Costo anterior
                  </TableHead>
                  <TableHead className="text-right text-[#391511] font-semibold">
                    Costo nuevo
                  </TableHead>
                  <TableHead className="text-right text-[#391511] font-semibold">
                    Variación
                  </TableHead>
                  <TableHead className="text-[#391511] font-semibold">
                    Origen
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {historial.map((v) => {
                  const supera = v.variacion_pct >= umbralActual
                  const baja = v.variacion_pct < 0
                  return (
                    <TableRow
                      key={v.id}
                      className="border-b-[#e4c9b0]/40 hover:bg-[#fdfaf6]"
                    >
                      <TableCell className="text-[#6f3a2a] text-xs tabular-nums whitespace-nowrap">
                        {formatearFechaHora(v.created_at)}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-[#391511] text-sm">
                          {v.producto_nombre}
                        </div>
                        {v.codigo_barras && (
                          <div className="text-[#c8a58a] text-xs font-mono">
                            {v.codigo_barras}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-[#6f3a2a]">
                        <MontoARS monto={v.costo_anterior} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-semibold text-[#391511]">
                        <MontoARS monto={v.costo_nuevo} />
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          className={
                            baja
                              ? 'inline-flex items-center gap-0.5 font-bold tabular-nums text-[#2f7d4f]'
                              : supera
                                ? 'inline-flex items-center gap-0.5 font-bold tabular-nums text-[#c43e2c]'
                                : 'inline-flex items-center gap-0.5 font-bold tabular-nums text-[#9e6b15]'
                          }
                        >
                          {baja ? (
                            <ArrowDownRight className="h-3.5 w-3.5" />
                          ) : (
                            <ArrowUpRight className="h-3.5 w-3.5" />
                          )}
                          {v.variacion_pct > 0 ? '+' : ''}
                          {v.variacion_pct}%
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="text-[10px] uppercase tracking-wider font-semibold text-[#6f3a2a] bg-[#f9d2a2]/30 rounded-full px-2 py-0.5">
                          {v.origen}
                        </span>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  )
}
