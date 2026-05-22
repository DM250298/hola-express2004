'use client'

import { useState } from 'react'
import { Ban, BookText, Eye, Plus } from 'lucide-react'
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
import { ModalNuevoAsiento } from './ModalNuevoAsiento'
import { DrawerAsiento } from './DrawerAsiento'
import { useAnularAsiento, useAsientos } from '@/lib/hooks/useContabilidad'
import { formatearFechaCorta } from '@/lib/utils/formato'
import { cn } from '@/lib/utils'

export function TabLibroDiario() {
  const { data: asientos, isLoading, isError } = useAsientos()
  const anular = useAnularAsiento()
  const [modalAbierto, setModalAbierto] = useState(false)
  const [verId, setVerId] = useState<number | null>(null)

  function handleAnular(id: number) {
    if (!confirm(`¿Anular el asiento #${id}? No se puede deshacer.`)) return
    anular.mutate(id)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[#391511] font-bold">Libro diario</h2>
          <p className="text-[#6f3a2a] text-sm">
            Todos los asientos contables, del más reciente al más antiguo.
          </p>
        </div>
        <Button
          onClick={() => setModalAbierto(true)}
          className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5"
        >
          <Plus className="h-4 w-4" />
          Nuevo asiento
        </Button>
      </div>

      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden shadow-sm">
        {isLoading ? (
          <div className="p-6">
            <SkeletonTabla filas={6} columnas={5} />
          </div>
        ) : isError ? (
          <div className="p-10 text-center text-[#c43e2c] text-sm">
            No se pudieron cargar los asientos.
          </div>
        ) : !asientos || asientos.length === 0 ? (
          <div className="p-12 text-center">
            <div className="inline-flex p-3 rounded-full bg-[#f9d2a2]/40 mb-3">
              <BookText className="h-6 w-6 text-[#6f3a2a]" />
            </div>
            <p className="text-[#391511] font-semibold">Sin asientos todavía</p>
            <p className="text-[#6f3a2a] text-sm mt-1">
              Registrá el primer asiento con el botón de arriba.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-b-[#e4c9b0]/60 bg-[#fdfaf6] hover:bg-[#fdfaf6]">
                <TableHead className="text-[#391511] font-semibold w-16">
                  #
                </TableHead>
                <TableHead className="text-[#391511] font-semibold">
                  Fecha
                </TableHead>
                <TableHead className="text-[#391511] font-semibold">
                  Descripción
                </TableHead>
                <TableHead className="text-[#391511] font-semibold">
                  Tipo
                </TableHead>
                <TableHead className="text-right text-[#391511] font-semibold">
                  Importe
                </TableHead>
                <TableHead className="text-right w-24 text-[#391511] font-semibold">
                  Acción
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {asientos.map((a) => (
                <TableRow
                  key={a.id}
                  className={cn(
                    'border-b-[#e4c9b0]/40 hover:bg-[#fdfaf6]',
                    a.anulado && 'opacity-50'
                  )}
                >
                  <TableCell className="font-mono text-xs text-[#6f3a2a]">
                    #{a.id}
                  </TableCell>
                  <TableCell className="text-[#6f3a2a] text-sm tabular-nums">
                    {formatearFechaCorta(a.fecha)}
                  </TableCell>
                  <TableCell className="text-[#391511] text-sm">
                    {a.descripcion}
                    {a.anulado && (
                      <span className="ml-2 text-[10px] uppercase tracking-wider font-bold text-[#c43e2c]">
                        Anulado
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded-full bg-[#c8a58a]/25 text-[#6f3a2a]">
                      {a.tipo}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-bold text-[#391511] tabular-nums">
                    <MontoARS monto={a.total} />
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-0.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setVerId(a.id)}
                        className="h-7 w-7 p-0 text-[#6f3a2a] hover:bg-[#f9d2a2]/40"
                        title="Ver detalle"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleAnular(a.id)}
                        disabled={a.anulado || anular.isPending}
                        className="h-7 w-7 p-0 text-[#c8a58a] hover:bg-[#c43e2c]/10 hover:text-[#c43e2c] disabled:opacity-30"
                        title="Anular asiento"
                      >
                        <Ban className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <ModalNuevoAsiento abierto={modalAbierto} onCambioAbierto={setModalAbierto} />
      <DrawerAsiento
        asientoId={verId}
        onCambioAbierto={(v) => !v && setVerId(null)}
      />
    </div>
  )
}
