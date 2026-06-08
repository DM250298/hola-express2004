'use client'

import { useState } from 'react'
import { ArrowLeft, RefreshCcw } from 'lucide-react'
import Link from 'next/link'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useClasificacionABC, ABC_KEY } from '@/lib/hooks/useClasificacionAbc'
import { cn } from '@/lib/utils'
import { CardsKPIsABC } from './CardsKPIsABC'
import { GraficoABC } from './GraficoABC'
import { TablaABC } from './TablaABC'

const OPCIONES_PERIODO: { dias: number; etiqueta: string }[] = [
  { dias: 30, etiqueta: '30 días' },
  { dias: 60, etiqueta: '60 días' },
  { dias: 90, etiqueta: '90 días' },
]

interface Props {
  /** True cuando se renderiza dentro de una pestaña (oculta breadcrumb y título). */
  embebido?: boolean
}

export function PantallaABC({ embebido = false }: Props) {
  const [dias, setDias] = useState(30)
  const queryClient = useQueryClient()
  const { data, isLoading, isError, isFetching } = useClasificacionABC(dias)

  function recalcular() {
    queryClient.invalidateQueries({ queryKey: ABC_KEY })
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        {embebido ? (
          <p className="text-[#6f3a2a] text-sm">
            Tus productos ordenados por lo que más venden (últimos {dias} días).
          </p>
        ) : (
          <div className="flex items-center gap-3">
            <Link
              href="/inventario"
              className="p-2 rounded-xl hover:bg-[#f9d2a2]/40 text-[#6f3a2a] transition-colors"
              title="Volver al inventario"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <h1 className="text-[#391511] text-2xl font-extrabold tracking-tight">
                Ranking de ventas
              </h1>
              <p className="text-[#6f3a2a] text-sm">
                Qué productos te dejan más plata (análisis ABC por ingresos)
              </p>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          {/* Selector de período */}
          <div className="flex items-center gap-1 bg-[#fdfaf6] border border-[#e4c9b0]/60 rounded-xl p-1">
            {OPCIONES_PERIODO.map((op) => (
              <button
                key={op.dias}
                type="button"
                onClick={() => setDias(op.dias)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-bold transition-all',
                  dias === op.dias
                    ? 'bg-[#391511] text-white shadow-sm'
                    : 'text-[#6f3a2a] hover:bg-[#f9d2a2]/40'
                )}
              >
                {op.etiqueta}
              </button>
            ))}
          </div>

          {/* Botón recalcular */}
          <Button
            variant="outline"
            size="sm"
            onClick={recalcular}
            disabled={isFetching}
            className="gap-1.5 border-[#e4c9b0] text-[#6f3a2a] hover:bg-[#f9d2a2]/40"
          >
            <RefreshCcw
              className={cn(
                'h-3.5 w-3.5',
                isFetching && 'animate-spin'
              )}
            />
            Recalcular
          </Button>
        </div>
      </div>

      {/* Contenido */}
      {isLoading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton
                key={i}
                className="h-24 rounded-2xl bg-[#f9d2a2]/30"
              />
            ))}
          </div>
          <div className="grid grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton
                key={i}
                className="h-28 rounded-2xl bg-[#f9d2a2]/30"
              />
            ))}
          </div>
          <Skeleton className="h-[400px] rounded-2xl bg-[#f9d2a2]/30" />
          <Skeleton className="h-96 rounded-2xl bg-[#f9d2a2]/30" />
        </div>
      ) : isError || !data ? (
        <div className="p-10 bg-[#c43e2c]/5 border border-[#c43e2c]/30 rounded-2xl text-center">
          <p className="text-[#c43e2c] font-bold">
            No se pudo calcular la clasificación ABC.
          </p>
          <p className="text-[#6f3a2a] text-sm mt-1">
            Revisá la conexión y volvé a intentar.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={recalcular}
            className="mt-3 border-[#c43e2c]/40 text-[#c43e2c]"
          >
            Reintentar
          </Button>
        </div>
      ) : (
        <>
          <CardsKPIsABC resumen={data} />
          <GraficoABC productos={data.productos} />
          <TablaABC productos={data.productos} />
        </>
      )}
    </div>
  )
}
