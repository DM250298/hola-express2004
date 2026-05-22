'use client'

import { CheckCircle2, Download, PackageX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { MontoARS } from '@/components/shared/MontoARS'
import { formatearMonto } from '@/lib/utils/formato'
import { useMermasPorCategoria } from '@/lib/hooks/useReportes'
import {
  agregarBloqueKPIs,
  agregarTabla,
  crearDocumentoConHeader,
  guardarPDF,
} from '@/lib/utils/pdf'

interface Props {
  desde: string
  hasta: string
}

export function ReporteMermas({ desde, hasta }: Props) {
  const { data, isLoading, isError } = useMermasPorCategoria(desde, hasta)

  function exportarPDF() {
    if (!data) return
    const doc = crearDocumentoConHeader({
      titulo: 'Mermas del período',
      subtitulo: 'Productos dados de baja por vencimiento u otros motivos',
      desde,
      hasta,
      archivo: 'mermas',
    })

    let y = agregarBloqueKPIs(doc, 62, [
      { etiqueta: 'Unidades', valor: String(data.total_unidades) },
      { etiqueta: 'Costo total', valor: formatearMonto(data.total_monto) },
    ])

    if (data.por_categoria.length > 0) {
      agregarTabla(
        doc,
        y + 4,
        ['Categoría', 'Unidades', 'Costo total', '% del total'],
        data.por_categoria.map((c) => [
          c.categoria_nombre,
          c.unidades,
          formatearMonto(c.monto),
          data.total_monto > 0
            ? `${((c.monto / data.total_monto) * 100).toFixed(1)}%`
            : '0%',
        ]),
        {
          columnStyles: {
            1: { halign: 'right' },
            2: { halign: 'right' },
            3: { halign: 'right' },
          },
        }
      )
    }

    guardarPDF(doc, `mermas_${desde.slice(0, 10)}_${hasta.slice(0, 10)}`)
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 rounded-2xl bg-[#f9d2a2]/30" />
        <Skeleton className="h-48 rounded-2xl bg-[#f9d2a2]/30" />
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="p-10 text-center text-[#c43e2c] text-sm">
        No se pudo cargar el reporte.
      </div>
    )
  }

  const sinMermas = data.total_unidades === 0

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <PackageX className="h-5 w-5 text-[#c43e2c]" />
          <h2 className="text-[#391511] font-bold text-lg">Mermas del período</h2>
        </div>
        <Button
          onClick={exportarPDF}
          disabled={sinMermas}
          variant="outline"
          className="border-[#e4c9b0] text-[#6f3a2a] hover:bg-[#fdfaf6] gap-1.5"
        >
          <Download className="h-3.5 w-3.5" />
          Exportar PDF
        </Button>
      </div>

      {sinMermas ? (
        <div className="bg-[#f9b44c]/10 border-2 border-[#f9b44c]/40 rounded-2xl p-8 text-center">
          <CheckCircle2 className="h-6 w-6 text-[#6f3a2a] mx-auto mb-2" />
          <p className="text-[#391511] font-semibold">Sin mermas en el período</p>
          <p className="text-[#6f3a2a] text-sm mt-1">
            No se registraron productos dados de baja.
          </p>
        </div>
      ) : (
        <>
          {/* Totales */}
          <div className="rounded-2xl border-2 border-[#c43e2c]/30 bg-[#c43e2c]/5 p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-[#c43e2c]/15">
                <PackageX className="h-5 w-5 text-[#9e2f25]" />
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                  Total mermas
                </div>
                <div className="text-xs text-[#6f3a2a]">
                  {data.total_unidades}{' '}
                  {data.total_unidades === 1 ? 'unidad' : 'unidades'} dadas de
                  baja
                </div>
              </div>
            </div>
            <div className="text-3xl font-extrabold text-[#9e2f25] tabular-nums">
              <MontoARS monto={data.total_monto} />
            </div>
          </div>

          {/* Desglose por categoría */}
          <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-5 shadow-sm">
            <h3 className="text-[#391511] font-bold mb-3">Por categoría</h3>
            <ul className="space-y-3">
              {data.por_categoria.map((c) => {
                const porcentaje =
                  data.total_monto > 0
                    ? (c.monto / data.total_monto) * 100
                    : 0
                return (
                  <li key={c.categoria_nombre} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="font-medium text-[#391511]">
                        {c.categoria_nombre}
                      </span>
                      <div className="text-right">
                        <span className="font-bold text-[#391511] tabular-nums">
                          <MontoARS monto={c.monto} />
                        </span>
                        <span className="text-[#6f3a2a] text-xs ml-2 tabular-nums">
                          {porcentaje.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                    <div className="h-2 rounded-full bg-[#fdfaf6] overflow-hidden">
                      <div
                        className="h-full bg-[#c43e2c] rounded-full transition-all"
                        style={{ width: `${porcentaje}%` }}
                      />
                    </div>
                    <div className="text-[10px] text-[#c8a58a] tabular-nums">
                      {c.unidades} {c.unidades === 1 ? 'unidad' : 'unidades'}
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        </>
      )}
    </div>
  )
}
