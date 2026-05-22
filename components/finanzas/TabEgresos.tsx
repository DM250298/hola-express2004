'use client'

import { useState } from 'react'
import { Pencil, Plus, Receipt, ShoppingCart, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
import { formatearFechaCorta } from '@/lib/utils/formato'
import { ModalNuevoEgreso } from './ModalNuevoEgreso'
import { useEgresos, useEliminarEgreso } from '@/lib/hooks/useFinanzas'
import { CATEGORIAS_EGRESO } from '@/lib/queries/finanzas'
import type { EgresoRow } from '@/types/database'

const TODAS = '__todas__'

const ETIQUETAS_CATEGORIA: Record<string, string> = Object.fromEntries(
  CATEGORIAS_EGRESO.map((c) => [c.valor, c.etiqueta])
)
const CAT_ITEMS: Record<string, string> = {
  [TODAS]: 'Todas las categorías',
  ...ETIQUETAS_CATEGORIA,
}

interface Props {
  desde: string
  hasta: string
}

export function TabEgresos({ desde, hasta }: Props) {
  const [categoria, setCategoria] = useState<string>(TODAS)
  const [modalAbierto, setModalAbierto] = useState(false)
  const [egresoEditar, setEgresoEditar] = useState<EgresoRow | null>(null)

  const {
    data: egresos,
    isLoading,
    isError,
  } = useEgresos(desde, hasta, categoria === TODAS ? null : categoria)
  const eliminar = useEliminarEgreso()

  const total = (egresos ?? []).reduce((acc, e) => acc + Number(e.monto), 0)

  function abrirNuevo() {
    setEgresoEditar(null)
    setModalAbierto(true)
  }

  function abrirEdicion(e: EgresoRow) {
    setEgresoEditar(e)
    setModalAbierto(true)
  }

  function borrar(e: EgresoRow) {
    if (!confirm(`¿Eliminar el gasto "${e.descripcion}"?`)) return
    eliminar.mutate(e.id)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[#391511] font-bold">Egresos del período</h2>
          <p className="text-[#6f3a2a] text-sm">
            Gastos operativos y gastos de caja registrados desde el POS.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select
            items={CAT_ITEMS}
            value={categoria}
            onValueChange={(v) => setCategoria(v ?? TODAS)}
          >
            <SelectTrigger className="w-[200px] border-[#e4c9b0] focus:ring-[#f9b44c] bg-white">
              <SelectValue placeholder="Categoría" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODAS}>Todas las categorías</SelectItem>
              {CATEGORIAS_EGRESO.map((c) => (
                <SelectItem key={c.valor} value={c.valor}>
                  {c.etiqueta}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            onClick={abrirNuevo}
            className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5"
          >
            <Plus className="h-4 w-4" />
            Nuevo egreso
          </Button>
        </div>
      </div>

      {/* Total */}
      <div className="rounded-2xl border-2 border-[#c43e2c]/30 bg-[#c43e2c]/5 p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-[#c43e2c]/15">
            <Receipt className="h-5 w-5 text-[#9e2f25]" />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
              Total del período
            </div>
            <div className="text-xs text-[#6f3a2a]">
              {(egresos ?? []).length} egreso(s)
            </div>
          </div>
        </div>
        <div className="text-3xl font-extrabold text-[#9e2f25] tabular-nums">
          <MontoARS monto={total} />
        </div>
      </div>

      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden shadow-sm">
        {isLoading ? (
          <div className="p-6">
            <SkeletonTabla filas={6} columnas={5} />
          </div>
        ) : isError ? (
          <div className="p-10 text-center text-[#c43e2c] text-sm">
            No se pudieron cargar los egresos.
          </div>
        ) : !egresos || egresos.length === 0 ? (
          <div className="p-12 text-center">
            <div className="inline-flex p-3 rounded-full bg-[#f9d2a2]/40 mb-3">
              <Receipt className="h-6 w-6 text-[#6f3a2a]" />
            </div>
            <p className="text-[#391511] font-semibold">
              Sin egresos registrados
            </p>
            <p className="text-[#6f3a2a] text-sm mt-1">
              No hay gastos en el período y filtros seleccionados.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-b-[#e4c9b0]/60 bg-[#fdfaf6] hover:bg-[#fdfaf6]">
                <TableHead className="text-[#391511] font-semibold">
                  Fecha
                </TableHead>
                <TableHead className="text-[#391511] font-semibold">
                  Descripción
                </TableHead>
                <TableHead className="text-[#391511] font-semibold">
                  Categoría
                </TableHead>
                <TableHead className="text-[#391511] font-semibold">
                  Usuario
                </TableHead>
                <TableHead className="text-right text-[#391511] font-semibold">
                  Monto
                </TableHead>
                <TableHead className="text-right w-20 text-[#391511] font-semibold">
                  Acciones
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {egresos.map((e) => (
                <TableRow
                  key={e.id}
                  className="border-b-[#e4c9b0]/40 hover:bg-[#fdfaf6]"
                >
                  <TableCell className="text-[#6f3a2a] text-sm tabular-nums">
                    {formatearFechaCorta(e.fecha)}
                  </TableCell>
                  <TableCell className="text-[#391511] text-sm">
                    <span className="inline-flex items-center gap-1.5">
                      {e.turno_id != null && (
                        <ShoppingCart
                          className="h-3.5 w-3.5 text-[#c8a58a] shrink-0"
                          aria-label="Gasto de caja del POS"
                        />
                      )}
                      {e.descripcion}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center rounded-full bg-[#c8a58a]/25 text-[#6f3a2a] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                      {ETIQUETAS_CATEGORIA[e.categoria] ?? e.categoria}
                    </span>
                  </TableCell>
                  <TableCell className="text-[#6f3a2a] text-xs">
                    {e.usuario_nombre ?? '—'}
                  </TableCell>
                  <TableCell className="text-right font-bold text-[#391511] tabular-nums">
                    <MontoARS monto={e.monto} />
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => abrirEdicion(e)}
                        title="Editar gasto"
                        className="h-7 w-7 p-0 text-[#6f3a2a] hover:bg-[#f9d2a2]/40"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => borrar(e)}
                        disabled={eliminar.isPending}
                        title="Eliminar gasto"
                        className="h-7 w-7 p-0 text-[#c8a58a] hover:bg-[#c43e2c]/10 hover:text-[#c43e2c]"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <ModalNuevoEgreso
        abierto={modalAbierto}
        onCambioAbierto={setModalAbierto}
        egreso={egresoEditar}
      />
    </div>
  )
}
