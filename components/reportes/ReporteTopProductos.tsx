'use client'

import { useMemo, useState } from 'react'
import { Download, Package, Trophy } from 'lucide-react'
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
import { formatearMonto } from '@/lib/utils/formato'
import { useTopProductosReporte } from '@/lib/hooks/useReportes'
import {
  agregarTabla,
  crearDocumentoConHeader,
  guardarPDF,
} from '@/lib/utils/pdf'
import { cn } from '@/lib/utils'

type Criterio = 'unidades' | 'monto'

interface Props {
  desde: string
  hasta: string
}

export function ReporteTopProductos({ desde, hasta }: Props) {
  const { data, isLoading, isError } = useTopProductosReporte(desde, hasta)
  const [criterio, setCriterio] = useState<Criterio>('unidades')

  const productos = useMemo(() => {
    if (!data) return []
    return [...data].sort((a, b) =>
      criterio === 'unidades'
        ? b.unidades - a.unidades
        : b.total_vendido - a.total_vendido
    )
  }, [data, criterio])

  function exportarPDF() {
    if (!productos.length) return
    const doc = crearDocumentoConHeader({
      titulo: 'Top 20 productos',
      subtitulo: `Ordenado por ${criterio === 'unidades' ? 'unidades vendidas' : 'monto generado'}`,
      desde,
      hasta,
      archivo: 'top-productos',
    })

    agregarTabla(
      doc,
      62,
      ['#', 'Producto', 'Categoría', 'Unidades', 'Total $', '% del total'],
      productos.map((p, i) => [
        i + 1,
        p.nombre,
        p.categoria_nombre ?? '—',
        p.unidades,
        formatearMonto(p.total_vendido),
        `${(criterio === 'unidades' ? p.porcentaje_unidades : p.porcentaje_monto).toFixed(1)}%`,
      ]),
      {
        columnStyles: {
          0: { halign: 'center', cellWidth: 10 },
          3: { halign: 'right' },
          4: { halign: 'right' },
          5: { halign: 'right' },
        },
      }
    )

    guardarPDF(doc, `top-productos_${desde.slice(0, 10)}_${hasta.slice(0, 10)}`)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Trophy className="h-5 w-5 text-[#f9b44c]" />
          <h2 className="text-[#391511] font-bold text-lg">Top 20 productos</h2>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Toggle */}
          <div className="inline-flex rounded-lg border border-[#e4c9b0] bg-white p-0.5">
            <ToggleBoton
              activo={criterio === 'unidades'}
              onClick={() => setCriterio('unidades')}
            >
              Por unidades
            </ToggleBoton>
            <ToggleBoton
              activo={criterio === 'monto'}
              onClick={() => setCriterio('monto')}
            >
              Por monto
            </ToggleBoton>
          </div>
          <Button
            onClick={exportarPDF}
            disabled={productos.length === 0}
            variant="outline"
            className="border-[#e4c9b0] text-[#6f3a2a] hover:bg-[#fdfaf6] gap-1.5"
          >
            <Download className="h-3.5 w-3.5" />
            Exportar PDF
          </Button>
        </div>
      </div>

      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden shadow-sm">
        {isLoading ? (
          <div className="p-6">
            <SkeletonTabla filas={10} columnas={5} />
          </div>
        ) : isError ? (
          <div className="p-10 text-center text-[#c43e2c] text-sm">
            No se pudo cargar el reporte.
          </div>
        ) : productos.length === 0 ? (
          <div className="p-12 text-center">
            <div className="inline-flex p-3 rounded-full bg-[#f9d2a2]/40 mb-3">
              <Package className="h-6 w-6 text-[#6f3a2a]" />
            </div>
            <p className="text-[#391511] font-semibold">Sin ventas en el período</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-b-[#e4c9b0]/60 bg-[#fdfaf6] hover:bg-[#fdfaf6]">
                <TableHead className="text-[#391511] font-semibold w-12 text-center">
                  #
                </TableHead>
                <TableHead className="text-[#391511] font-semibold">
                  Producto
                </TableHead>
                <TableHead className="text-[#391511] font-semibold">
                  Categoría
                </TableHead>
                <TableHead className="text-right text-[#391511] font-semibold">
                  Unidades
                </TableHead>
                <TableHead className="text-right text-[#391511] font-semibold">
                  Total $
                </TableHead>
                <TableHead className="text-right text-[#391511] font-semibold">
                  % del total
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {productos.map((p, i) => {
                const porcentaje =
                  criterio === 'unidades'
                    ? p.porcentaje_unidades
                    : p.porcentaje_monto
                return (
                  <TableRow
                    key={p.producto_id}
                    className="border-b-[#e4c9b0]/40 hover:bg-[#fdfaf6]"
                  >
                    <TableCell className="text-center font-bold text-[#6f3a2a] tabular-nums">
                      {i + 1}
                    </TableCell>
                    <TableCell className="font-medium text-[#391511]">
                      {p.nombre}
                    </TableCell>
                    <TableCell className="text-[#6f3a2a] text-sm">
                      {p.categoria_nombre ?? (
                        <span className="text-[#c8a58a] italic">—</span>
                      )}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right tabular-nums',
                        criterio === 'unidades'
                          ? 'text-[#391511] font-bold'
                          : 'text-[#6f3a2a]'
                      )}
                    >
                      {p.unidades}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right tabular-nums',
                        criterio === 'monto'
                          ? 'text-[#391511] font-bold'
                          : 'text-[#6f3a2a]'
                      )}
                    >
                      <MontoARS monto={p.total_vendido} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <div className="flex items-center gap-2 justify-end">
                        <div className="w-16 h-1.5 rounded-full bg-[#fdfaf6] overflow-hidden">
                          <div
                            className="h-full bg-[#f9b44c] rounded-full"
                            style={{ width: `${Math.min(100, porcentaje)}%` }}
                          />
                        </div>
                        <span className="text-[#391511] font-semibold text-xs w-10 text-right">
                          {porcentaje.toFixed(1)}%
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  )
}

function ToggleBoton({
  activo,
  onClick,
  children,
}: {
  activo: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'px-3 py-1 text-xs font-semibold rounded-md transition-all',
        activo
          ? 'bg-[#f9b44c] text-[#391511] shadow-sm'
          : 'text-[#6f3a2a] hover:bg-[#fdfaf6]'
      )}
    >
      {children}
    </button>
  )
}
