'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ClipboardList, Eye, Plus } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
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
import { BadgeEstadoPedido } from '@/components/shared/BadgeEstadoPedido'
import { MontoARS } from '@/components/shared/MontoARS'
import { formatearFechaCorta } from '@/lib/utils/formato'
import { usePedidos } from '@/lib/hooks/usePedidos'
import { cn } from '@/lib/utils'
import type { EstadoPedido } from '@/types/database'

const TODOS = '__todos__'

export function PantallaPedidos() {
  const [estadoFiltro, setEstadoFiltro] = useState<string>(TODOS)
  const filtros =
    estadoFiltro === TODOS ? {} : { estado: estadoFiltro as EstadoPedido }
  const { data: pedidos, isLoading, isError } = usePedidos(filtros)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[#6f3a2a] text-sm">
          Órdenes de compra a proveedores. Creá una orden y luego registrá su
          recepción.
        </p>
        <Link
          href="/pedidos/nuevo"
          className={cn(
            buttonVariants({ variant: 'default' }),
            'bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5'
          )}
        >
          <Plus className="h-4 w-4" />
          Nueva orden
        </Link>
      </div>

      <div className="flex flex-wrap gap-2">
        <Select
          value={estadoFiltro}
          onValueChange={(v) => setEstadoFiltro(v ?? TODOS)}
        >
          <SelectTrigger className="w-[200px] border-[#e4c9b0] focus:ring-[#f9b44c] bg-white">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos los estados</SelectItem>
            <SelectItem value="borrador">Borrador</SelectItem>
            <SelectItem value="enviado">Enviado</SelectItem>
            <SelectItem value="recepcion_parcial">Parcial</SelectItem>
            <SelectItem value="recibido">Recibido</SelectItem>
            <SelectItem value="cancelado">Cancelado</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden shadow-sm">
        {isLoading ? (
          <div className="p-6">
            <SkeletonTabla filas={6} columnas={5} />
          </div>
        ) : isError ? (
          <div className="p-10 text-center text-[#c43e2c] text-sm">
            No se pudieron cargar los pedidos.
          </div>
        ) : !pedidos || pedidos.length === 0 ? (
          <div className="p-12 text-center">
            <div className="inline-flex p-3 rounded-full bg-[#f9d2a2]/40 mb-3">
              <ClipboardList className="h-6 w-6 text-[#6f3a2a]" />
            </div>
            <p className="text-[#391511] font-semibold">
              {estadoFiltro === TODOS
                ? 'No hay pedidos cargados'
                : 'Sin pedidos en este estado'}
            </p>
            <p className="text-[#6f3a2a] text-sm mt-1">
              Empezá creando un pedido a un proveedor.
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
                  Proveedor
                </TableHead>
                <TableHead className="text-[#391511] font-semibold">
                  Fecha pedido
                </TableHead>
                <TableHead className="text-[#391511] font-semibold">
                  Entrega esperada
                </TableHead>
                <TableHead className="text-right text-[#391511] font-semibold">
                  Total
                </TableHead>
                <TableHead className="text-center text-[#391511] font-semibold">
                  Estado
                </TableHead>
                <TableHead className="text-right w-16 text-[#391511] font-semibold">
                  Ver
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pedidos.map((p) => (
                <TableRow
                  key={p.id}
                  className="border-b-[#e4c9b0]/40 hover:bg-[#fdfaf6]"
                >
                  <TableCell className="font-mono text-xs text-[#6f3a2a] tabular-nums">
                    #{p.id}
                  </TableCell>
                  <TableCell className="font-medium text-[#391511]">
                    {p.proveedor?.nombre ?? (
                      <span className="text-[#c8a58a] italic">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-[#6f3a2a] text-sm tabular-nums">
                    {formatearFechaCorta(p.fecha_pedido)}
                  </TableCell>
                  <TableCell className="text-[#6f3a2a] text-sm tabular-nums">
                    {p.fecha_entrega_esperada ? (
                      formatearFechaCorta(p.fecha_entrega_esperada)
                    ) : (
                      <span className="text-[#c8a58a] italic">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-semibold text-[#391511] tabular-nums">
                    <MontoARS monto={p.total} />
                  </TableCell>
                  <TableCell className="text-center">
                    <BadgeEstadoPedido estado={p.estado} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={`/pedidos/${p.id}`}
                      className={cn(
                        buttonVariants({ variant: 'ghost', size: 'sm' }),
                        'text-[#6f3a2a] hover:bg-[#f9d2a2]/40 hover:text-[#391511]'
                      )}
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  )
}
