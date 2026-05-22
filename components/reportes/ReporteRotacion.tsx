'use client'

import { AlertOctagon, Download, RefreshCw, Snowflake } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
import { formatearMonto, formatearFechaCorta } from '@/lib/utils/formato'
import { useDeadStock, useRotacionInventario } from '@/lib/hooks/useReportes'
import {
  agregarBloqueKPIs,
  agregarTabla,
  crearDocumentoConHeader,
  guardarPDF,
} from '@/lib/utils/pdf'
import { cn } from '@/lib/utils'

interface Props {
  desde: string
  hasta: string
}

function formatearDiasRotacion(d: number | null): string {
  if (d === null) return '—'
  if (d === 0) return '0 días'
  if (d < 1) return '<1 día'
  if (d > 365) return '>1 año'
  return `${Math.round(d)} días`
}

function colorRotacion(d: number | null): string {
  if (d === null) return 'text-[#c8a58a]'
  if (d > 90) return 'text-[#c43e2c] font-bold'
  if (d > 30) return 'text-[#e4a42a] font-semibold'
  return 'text-[#391511]'
}

export function ReporteRotacion({ desde, hasta }: Props) {
  const { data: rotacion, isLoading: cargandoRot } = useRotacionInventario(desde, hasta)
  const { data: dead, isLoading: cargandoDead } = useDeadStock(30)

  function exportarPDFRotacion() {
    if (!rotacion?.length) return
    const doc = crearDocumentoConHeader({
      titulo: 'Rotación de inventario',
      desde,
      hasta,
      archivo: 'rotacion',
    })

    agregarTabla(
      doc,
      62,
      ['Producto', 'Categoría', 'Stock', 'Vendidas', 'Días rotación'],
      rotacion.map((p) => [
        p.nombre,
        p.categoria_nombre ?? '—',
        p.stock_actual,
        p.unidades_vendidas,
        formatearDiasRotacion(p.dias_rotacion),
      ]),
      {
        columnStyles: {
          2: { halign: 'right' },
          3: { halign: 'right' },
          4: { halign: 'right' },
        },
      }
    )

    guardarPDF(doc, `rotacion_${desde.slice(0, 10)}_${hasta.slice(0, 10)}`)
  }

  function exportarPDFDeadStock() {
    if (!dead?.length) return
    const totalInmovilizado = dead.reduce((acc, p) => acc + p.valor_inmovilizado, 0)
    const doc = crearDocumentoConHeader({
      titulo: 'Dead stock',
      subtitulo: 'Productos sin movimientos en los últimos 30 días',
      desde,
      hasta,
      archivo: 'dead-stock',
    })

    let y = agregarBloqueKPIs(doc, 62, [
      { etiqueta: 'Productos', valor: String(dead.length) },
      {
        etiqueta: 'Valor inmovilizado',
        valor: formatearMonto(totalInmovilizado),
      },
    ])

    agregarTabla(
      doc,
      y + 4,
      ['Producto', 'Categoría', 'Stock', 'Costo unit.', 'Inmovilizado', 'Último mov.'],
      dead.map((p) => [
        p.nombre,
        p.categoria_nombre ?? '—',
        p.stock_actual,
        formatearMonto(p.precio_costo),
        formatearMonto(p.valor_inmovilizado),
        p.ultimo_movimiento
          ? formatearFechaCorta(p.ultimo_movimiento)
          : 'Nunca',
      ]),
      {
        columnStyles: {
          2: { halign: 'right' },
          3: { halign: 'right' },
          4: { halign: 'right' },
        },
      }
    )

    guardarPDF(doc, 'dead-stock')
  }

  const totalInmovilizado = (dead ?? []).reduce(
    (acc, p) => acc + p.valor_inmovilizado,
    0
  )

  return (
    <div className="space-y-5">
      {/* Tabla de rotación */}
      <div>
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <div className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5 text-[#f9b44c]" />
            <h2 className="text-[#391511] font-bold text-lg">
              Rotación de inventario
            </h2>
          </div>
          <Button
            onClick={exportarPDFRotacion}
            disabled={!rotacion?.length}
            variant="outline"
            className="border-[#e4c9b0] text-[#6f3a2a] hover:bg-[#fdfaf6] gap-1.5"
          >
            <Download className="h-3.5 w-3.5" />
            Exportar PDF
          </Button>
        </div>

        <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden shadow-sm">
          {cargandoRot ? (
            <div className="p-6">
              <SkeletonTabla filas={10} columnas={5} />
            </div>
          ) : !rotacion || rotacion.length === 0 ? (
            <div className="p-10 text-center text-[#6f3a2a] text-sm">
              Sin productos para analizar.
            </div>
          ) : (
            <div className="max-h-[450px] overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-[#fdfaf6] z-10">
                  <TableRow className="border-b-[#e4c9b0]/60 hover:bg-[#fdfaf6]">
                    <TableHead className="text-[#391511] font-semibold">
                      Producto
                    </TableHead>
                    <TableHead className="text-[#391511] font-semibold">
                      Categoría
                    </TableHead>
                    <TableHead className="text-right text-[#391511] font-semibold">
                      Stock
                    </TableHead>
                    <TableHead className="text-right text-[#391511] font-semibold">
                      Vendidas
                    </TableHead>
                    <TableHead className="text-right text-[#391511] font-semibold">
                      Días rotación
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rotacion.map((p) => (
                    <TableRow
                      key={p.producto_id}
                      className="border-b-[#e4c9b0]/40 hover:bg-[#fdfaf6]"
                    >
                      <TableCell className="font-medium text-[#391511]">
                        {p.nombre}
                      </TableCell>
                      <TableCell className="text-[#6f3a2a] text-sm">
                        {p.categoria_nombre ?? (
                          <span className="text-[#c8a58a] italic">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-[#391511]">
                        {p.stock_actual}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-[#6f3a2a]">
                        {p.unidades_vendidas}
                      </TableCell>
                      <TableCell
                        className={cn(
                          'text-right tabular-nums',
                          colorRotacion(p.dias_rotacion)
                        )}
                      >
                        {formatearDiasRotacion(p.dias_rotacion)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>

      {/* Dead stock */}
      <div>
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <div className="flex items-center gap-2">
            <Snowflake className="h-5 w-5 text-[#c43e2c]" />
            <h2 className="text-[#391511] font-bold text-lg">
              Dead stock
            </h2>
            <span className="text-xs text-[#6f3a2a]">
              · sin movimientos en &gt; 30 días
            </span>
          </div>
          <Button
            onClick={exportarPDFDeadStock}
            disabled={!dead?.length}
            variant="outline"
            className="border-[#e4c9b0] text-[#6f3a2a] hover:bg-[#fdfaf6] gap-1.5"
          >
            <Download className="h-3.5 w-3.5" />
            Exportar PDF
          </Button>
        </div>

        {dead && dead.length > 0 && (
          <div className="rounded-2xl border-2 border-[#c43e2c]/30 bg-[#c43e2c]/5 p-4 flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-[#c43e2c]/15">
                <AlertOctagon className="h-5 w-5 text-[#9e2f25]" />
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                  Capital inmovilizado
                </div>
                <div className="text-xs text-[#6f3a2a]">
                  {dead.length} {dead.length === 1 ? 'producto' : 'productos'}{' '}
                  detenido(s)
                </div>
              </div>
            </div>
            <div className="text-3xl font-extrabold text-[#9e2f25] tabular-nums">
              <MontoARS monto={totalInmovilizado} />
            </div>
          </div>
        )}

        <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden shadow-sm">
          {cargandoDead ? (
            <div className="p-6">
              <SkeletonTabla filas={6} columnas={5} />
            </div>
          ) : !dead || dead.length === 0 ? (
            <div className="p-10 text-center">
              <Snowflake className="h-6 w-6 text-[#c8a58a] mx-auto mb-2" />
              <p className="text-[#391511] font-semibold">
                Sin productos detenidos
              </p>
              <p className="text-[#6f3a2a] text-sm mt-1">
                Todos los productos activos tuvieron movimientos en los últimos
                30 días.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-b-[#e4c9b0]/60 bg-[#fdfaf6] hover:bg-[#fdfaf6]">
                  <TableHead className="text-[#391511] font-semibold">
                    Producto
                  </TableHead>
                  <TableHead className="text-[#391511] font-semibold">
                    Categoría
                  </TableHead>
                  <TableHead className="text-right text-[#391511] font-semibold">
                    Stock
                  </TableHead>
                  <TableHead className="text-right text-[#391511] font-semibold">
                    Costo unit.
                  </TableHead>
                  <TableHead className="text-right text-[#391511] font-semibold">
                    Inmovilizado
                  </TableHead>
                  <TableHead className="text-right text-[#391511] font-semibold">
                    Último mov.
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dead.map((p) => (
                  <TableRow
                    key={p.producto_id}
                    className="border-b-[#e4c9b0]/40 hover:bg-[#fdfaf6]"
                  >
                    <TableCell className="font-medium text-[#391511]">
                      {p.nombre}
                    </TableCell>
                    <TableCell className="text-[#6f3a2a] text-sm">
                      {p.categoria_nombre ?? (
                        <span className="text-[#c8a58a] italic">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-[#391511]">
                      {p.stock_actual}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-[#6f3a2a]">
                      <MontoARS monto={p.precio_costo} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-bold text-[#9e2f25]">
                      <MontoARS monto={p.valor_inmovilizado} />
                    </TableCell>
                    <TableCell className="text-right text-[#6f3a2a] text-xs tabular-nums">
                      {p.ultimo_movimiento
                        ? `${formatearFechaCorta(p.ultimo_movimiento)} (${p.dias_sin_movimiento}d)`
                        : 'Nunca'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    </div>
  )
}
