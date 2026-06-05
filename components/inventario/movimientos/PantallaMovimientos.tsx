'use client'

import { useState } from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  useMovimientosStock,
  useUsuariosConMovimientos,
} from '@/lib/hooks/useMovimientosStock'
import { useCategorias } from '@/lib/hooks/useCategorias'
import type { FiltrosMovimientos } from '@/lib/queries/movimientosStock'
import { FiltrosMovimientosBar } from './FiltrosMovimientosBar'
import { TablaMovimientos } from './TablaMovimientos'
import { exportarMovimientosCSV } from './exportarCSV'

export function PantallaMovimientos() {
  const [filtros, setFiltros] = useState<FiltrosMovimientos>({})
  const [pagina, setPagina] = useState(0)
  const porPagina = 50

  const { data, isLoading, isError } = useMovimientosStock(
    filtros,
    pagina,
    porPagina
  )
  const { data: usuarios } = useUsuariosConMovimientos()
  const { data: categorias } = useCategorias()

  function cambiarFiltros(nuevosFiltros: FiltrosMovimientos) {
    setFiltros(nuevosFiltros)
    setPagina(0)
  }

  const totalPaginas = data ? Math.ceil(data.total / porPagina) : 0

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[#391511] font-bold text-lg">
            Historial de movimientos
          </h2>
          <p className="text-[#6f3a2a] text-sm">
            Entradas, salidas, ajustes y mermas — registro completo.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (data) exportarMovimientosCSV(data.movimientos)
          }}
          disabled={!data || data.movimientos.length === 0}
          className="gap-1.5 border-[#e4c9b0] text-[#6f3a2a] hover:bg-[#f9d2a2]/40"
        >
          <Download className="h-3.5 w-3.5" />
          Exportar CSV
        </Button>
      </div>

      {/* Filtros */}
      <FiltrosMovimientosBar
        filtros={filtros}
        onChange={cambiarFiltros}
        usuarios={usuarios ?? []}
        categorias={categorias ?? []}
      />

      {/* Contenido */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton
              key={i}
              className="h-14 rounded-xl bg-[#f9d2a2]/30"
            />
          ))}
        </div>
      ) : isError || !data ? (
        <div className="p-10 bg-[#c43e2c]/5 border border-[#c43e2c]/30 rounded-2xl text-center">
          <p className="text-[#c43e2c] font-bold">
            No se pudieron cargar los movimientos.
          </p>
          <p className="text-[#6f3a2a] text-sm mt-1">
            Revisá la conexión y volvé a intentar.
          </p>
        </div>
      ) : (
        <>
          <TablaMovimientos movimientos={data.movimientos} />

          {/* Paginación */}
          {totalPaginas > 1 && (
            <div className="flex items-center justify-between border-t border-[#e4c9b0]/60 pt-4">
              <p className="text-xs text-[#6f3a2a]">
                Página {pagina + 1} de {totalPaginas} ·{' '}
                {data.total} movimientos
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPagina((p) => Math.max(0, p - 1))}
                  disabled={pagina === 0}
                  className="border-[#e4c9b0] text-[#6f3a2a]"
                >
                  Anterior
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setPagina((p) =>
                      Math.min(totalPaginas - 1, p + 1)
                    )
                  }
                  disabled={pagina >= totalPaginas - 1}
                  className="border-[#e4c9b0] text-[#6f3a2a]"
                >
                  Siguiente
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
