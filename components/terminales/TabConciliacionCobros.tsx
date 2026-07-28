'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from 'lucide-react'
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
import {
  PaginadorTabla,
  paginarArreglo,
  type PorPagina,
} from '@/components/shared/PaginadorTabla'
import {
  useCobrosSinConciliar,
  useConciliarCobro,
} from '@/lib/hooks/useCobrosTerminal'
import { formatearFechaHora } from '@/lib/utils/formato'
import { cn } from '@/lib/utils'
import type { CobroTerminalRow } from '@/types/database'

const ETIQUETA_ESTADO: Record<string, { texto: string; clase: string }> = {
  aprobado: {
    texto: 'Cobrado, sin venta',
    clase: 'bg-[#c43e2c]/10 text-[#c43e2c] border-[#c43e2c]/30',
  },
  fallida: {
    texto: 'Falló el registro',
    clase: 'bg-[#c43e2c]/10 text-[#c43e2c] border-[#c43e2c]/30',
  },
  pendiente: {
    texto: 'Por verificar',
    clase: 'bg-[#f9b44c]/15 text-[#6f3a2a] border-[#f9b44c]/40',
  },
}

function cantidadItems(items: CobroTerminalRow['items']): number {
  return Array.isArray(items) ? items.length : 0
}

export function TabConciliacionCobros() {
  const { data: cobros, isLoading, isError, refetch, isFetching } =
    useCobrosSinConciliar()
  const conciliar = useConciliarCobro()
  const [pagina, setPagina] = useState(0)
  const [porPagina, setPorPagina] = useState<PorPagina>(25)

  const lista = cobros ?? []
  const cobrosPagina = useMemo(
    () => paginarArreglo(lista, pagina, porPagina),
    [lista, pagina, porPagina]
  )

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[#e4c9b0]/60 bg-[#fdfaf6] p-4 flex items-start gap-3">
        <AlertTriangle className="h-4 w-4 text-[#6f3a2a] shrink-0 mt-0.5" />
        <div className="text-xs text-[#6f3a2a] space-y-1">
          <p className="font-semibold text-[#391511]">
            Cobros con maquinita que no quedaron como venta
          </p>
          <p>
            Acá aparece la plata que entró por la terminal pero cuya venta no se
            registró (por ejemplo, si se cerró la pantalla del POS justo después
            de cobrar). Tocá <strong>Registrar venta</strong>: el sistema
            verifica el pago en Mercado Pago y, si está aprobado, crea la venta
            (descuenta stock e impacta finanzas). No vuelve a cobrar.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-[#6f3a2a]">
          {lista.length === 0
            ? 'Sin cobros pendientes de conciliar.'
            : `${lista.length} cobro${lista.length === 1 ? '' : 's'} sin conciliar`}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          className="h-8 gap-1.5 border-[#e4c9b0] text-[#6f3a2a]"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
          Actualizar
        </Button>
      </div>

      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden shadow-sm">
        {isLoading ? (
          <div className="p-6">
            <SkeletonTabla filas={3} columnas={5} />
          </div>
        ) : isError ? (
          <div className="p-10 text-center text-[#c43e2c] text-sm">
            No se pudieron cargar los cobros.
          </div>
        ) : lista.length === 0 ? (
          <div className="p-12 text-center">
            <div className="inline-flex p-3 rounded-full bg-[#2f8f4e]/10 mb-3">
              <CheckCircle2 className="h-6 w-6 text-[#2f8f4e]" />
            </div>
            <p className="text-[#391511] font-semibold">Todo conciliado</p>
            <p className="text-[#6f3a2a] text-sm mt-1">
              No hay cobros de terminal sin su venta registrada.
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
                    Monto
                  </TableHead>
                  <TableHead className="text-[#391511] font-semibold">
                    Productos
                  </TableHead>
                  <TableHead className="text-[#391511] font-semibold">
                    Estado
                  </TableHead>
                  <TableHead className="text-right w-40 text-[#391511] font-semibold" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {cobrosPagina.map((c) => {
                  const est = ETIQUETA_ESTADO[c.estado] ?? {
                    texto: c.estado,
                    clase: 'bg-[#f9d2a2]/30 text-[#6f3a2a] border-[#e4c9b0]',
                  }
                  const enviando =
                    conciliar.isPending && conciliar.variables === c.id
                  const n = cantidadItems(c.items)
                  return (
                    <TableRow key={c.id} className="border-b-[#e4c9b0]/40">
                      <TableCell className="text-[#6f3a2a] text-xs whitespace-nowrap">
                        {formatearFechaHora(c.created_at)}
                      </TableCell>
                      <TableCell className="text-[#391511] font-bold tabular-nums">
                        <MontoARS monto={c.monto} />
                      </TableCell>
                      <TableCell className="text-[#6f3a2a] text-sm">
                        {n} {n === 1 ? 'ítem' : 'ítems'}
                      </TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold',
                            est.clase
                          )}
                        >
                          {est.texto}
                        </span>
                        {c.error && (
                          <p className="text-[10px] text-[#c8a58a] mt-1 max-w-xs truncate">
                            {c.error}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          onClick={() => conciliar.mutate(c.id)}
                          disabled={conciliar.isPending}
                          className="h-7 px-2.5 text-[11px] font-semibold bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] gap-1"
                        >
                          {enviando ? (
                            <>
                              <Loader2 className="h-3 w-3 animate-spin" />
                              Registrando…
                            </>
                          ) : (
                            'Registrar venta'
                          )}
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {lista.length > 0 && (
        <PaginadorTabla
          total={lista.length}
          porPagina={porPagina}
          pagina={pagina}
          onCambioPorPagina={(v) => {
            setPorPagina(v)
            setPagina(0)
          }}
          onCambioPagina={setPagina}
        />
      )}
    </div>
  )
}
