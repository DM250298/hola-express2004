'use client'

import { TrendingUp } from 'lucide-react'
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
import { Semaforo } from '@/components/shared/Semaforo'
import { useOrdenes, useProductosProduccion } from '@/lib/hooks/useProduccion'

const UMBRAL_MARGEN = 30

export function TabAnalisis() {
  const { data: productos, isLoading } = useProductosProduccion([
    'semi_elaborado',
    'elaborado',
  ])
  const { data: cerradas } = useOrdenes({ estado: 'cerrada' })

  return (
    <div className="space-y-6">
      {/* Márgenes */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-[#391511] flex items-center gap-1.5">
          <TrendingUp className="h-4 w-4 text-[#f9b44c]" />
          Margen de elaborados
        </h2>
        <div className="rounded-xl border border-[#e4c9b0]/60 bg-white overflow-hidden">
          {isLoading ? (
            <div className="p-4">
              <SkeletonTabla filas={4} columnas={5} />
            </div>
          ) : !productos || productos.length === 0 ? (
            <div className="p-8 text-center text-[#6f3a2a] text-sm">
              No hay productos elaborados todavía.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-[#e4c9b0]/40">
                  <TableHead className="text-[#6f3a2a]">Producto</TableHead>
                  <TableHead className="text-[#6f3a2a] text-right">Costo</TableHead>
                  <TableHead className="text-[#6f3a2a] text-right">Precio</TableHead>
                  <TableHead className="text-[#6f3a2a] text-right">Margen</TableHead>
                  <TableHead className="text-[#6f3a2a] text-right">%</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {productos.map((p) => {
                  const margen = p.precio_venta - p.precio_costo
                  const margenPct =
                    p.precio_venta > 0 ? (margen / p.precio_venta) * 100 : 0
                  const bajo = p.precio_venta > 0 && margenPct < UMBRAL_MARGEN
                  return (
                    <TableRow key={p.id} className="border-[#e4c9b0]/30">
                      <TableCell className="font-medium text-[#391511]">
                        {p.nombre}
                        {p.tipo === 'semi_elaborado' && (
                          <span className="ml-1.5 text-[10px] text-[#c8a58a]">
                            (semi)
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <MontoARS monto={p.precio_costo} className="text-[#6f3a2a]" />
                      </TableCell>
                      <TableCell className="text-right">
                        <MontoARS monto={p.precio_venta} className="text-[#391511]" />
                      </TableCell>
                      <TableCell className="text-right">
                        <MontoARS monto={margen} className="text-[#391511]" />
                      </TableCell>
                      <TableCell className="text-right">
                        {p.precio_venta > 0 ? (
                          bajo ? (
                            <Semaforo
                              clase="rojo"
                              etiqueta={`${margenPct.toFixed(0)}%`}
                            />
                          ) : (
                            <span className="font-semibold text-[#2f8f4e]">
                              {margenPct.toFixed(0)}%
                            </span>
                          )
                        ) : (
                          <span className="text-[#c8a58a]">s/precio</span>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </section>

      {/* Historial de producción */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-[#391511]">
          Últimas producciones
        </h2>
        <div className="rounded-xl border border-[#e4c9b0]/60 bg-white overflow-hidden">
          {!cerradas || cerradas.length === 0 ? (
            <div className="p-8 text-center text-[#6f3a2a] text-sm">
              Todavía no se cerró ninguna orden.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-[#e4c9b0]/40">
                  <TableHead className="text-[#6f3a2a]">Producto</TableHead>
                  <TableHead className="text-[#6f3a2a] text-right">Plan.</TableHead>
                  <TableHead className="text-[#6f3a2a] text-right">Prod.</TableHead>
                  <TableHead className="text-[#6f3a2a] text-right">Merma</TableHead>
                  <TableHead className="text-[#6f3a2a] text-right">Costo total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cerradas.slice(0, 15).map((o) => {
                  const merma =
                    o.cantidad_producida != null
                      ? o.cantidad_planificada - o.cantidad_producida
                      : 0
                  return (
                    <TableRow key={o.id} className="border-[#e4c9b0]/30">
                      <TableCell className="font-medium text-[#391511]">
                        {o.producto?.nombre ?? '—'}
                      </TableCell>
                      <TableCell className="text-right text-[#6f3a2a] tabular-nums">
                        {o.cantidad_planificada}
                      </TableCell>
                      <TableCell className="text-right text-[#6f3a2a] tabular-nums">
                        {o.cantidad_producida ?? '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {merma > 0 ? (
                          <span className="text-[#c45e14] font-medium">{merma}</span>
                        ) : (
                          <span className="text-[#c8a58a]">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <MontoARS monto={o.costo_total} className="text-[#391511]" />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </section>
    </div>
  )
}
