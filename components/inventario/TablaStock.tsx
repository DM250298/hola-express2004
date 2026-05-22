'use client'

import Link from 'next/link'
import { ArrowUpDown, Package, Pencil, Eye, Tag } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { SkeletonTabla } from '@/components/shared/SkeletonTabla'
import { BadgeEstadoStock } from '@/components/shared/BadgeEstadoStock'
import type {
  FiltrosInventario,
  ProductoConStock,
} from '@/lib/queries/inventario'
import { cn } from '@/lib/utils'

interface Props {
  productos: ProductoConStock[] | undefined
  isLoading: boolean
  isError: boolean
  orden: NonNullable<FiltrosInventario['orden']>
  onCambiarOrden: (o: NonNullable<FiltrosInventario['orden']>) => void
  onAjustar: (producto: ProductoConStock) => void
  onImprimirEtiqueta: (producto: ProductoConStock) => void
  hayFiltros: boolean
}

export function TablaStock({
  productos,
  isLoading,
  isError,
  orden,
  onCambiarOrden,
  onAjustar,
  onImprimirEtiqueta,
  hayFiltros,
}: Props) {
  return (
    <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden shadow-sm">
      {isLoading ? (
        <div className="p-6">
          <SkeletonTabla filas={8} columnas={6} />
        </div>
      ) : isError ? (
        <div className="p-10 text-center text-[#c43e2c] text-sm">
          No se pudo cargar el inventario.
        </div>
      ) : !productos || productos.length === 0 ? (
        <div className="p-12 text-center">
          <div className="inline-flex p-3 rounded-full bg-[#f9d2a2]/40 mb-3">
            <Package className="h-6 w-6 text-[#6f3a2a]" />
          </div>
          <p className="text-[#391511] font-semibold">
            {hayFiltros ? 'Sin resultados' : 'No hay productos activos'}
          </p>
          <p className="text-[#6f3a2a] text-sm mt-1">
            {hayFiltros
              ? 'Probá ajustando los filtros.'
              : 'Cargá productos desde Configuración para empezar.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-b-[#e4c9b0]/60 bg-[#fdfaf6] hover:bg-[#fdfaf6]">
                <ColumnaOrdenable
                  etiqueta="Producto"
                  ordenActual={orden}
                  ordenes={['nombre']}
                  onClick={() => onCambiarOrden('nombre')}
                />
                <ColumnaOrdenable
                  etiqueta="Categoría"
                  ordenActual={orden}
                  ordenes={['categoria']}
                  onClick={() => onCambiarOrden('categoria')}
                />
                <ColumnaOrdenable
                  etiqueta="Stock actual"
                  align="right"
                  ordenActual={orden}
                  ordenes={['stock_asc', 'stock_desc']}
                  onClick={() =>
                    onCambiarOrden(
                      orden === 'stock_asc' ? 'stock_desc' : 'stock_asc'
                    )
                  }
                />
                <TableHead className="text-right text-[#391511] font-semibold">
                  Stock mín.
                </TableHead>
                <TableHead className="text-center text-[#391511] font-semibold">
                  Estado
                </TableHead>
                <TableHead className="text-right w-36 text-[#391511] font-semibold">
                  Acciones
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {productos.map((p) => {
                const destacar =
                  p.estado_stock === 'bajo' || p.estado_stock === 'critico'
                return (
                  <TableRow
                    key={p.id}
                    className={cn(
                      'border-b-[#e4c9b0]/40 hover:bg-[#fdfaf6]',
                      destacar &&
                        'bg-[#c43e2c]/[0.03] hover:bg-[#c43e2c]/[0.06]'
                    )}
                  >
                    <TableCell>
                      <div className="flex flex-col leading-tight">
                        <Link
                          href={`/inventario/${p.id}`}
                          className="font-medium text-[#391511] hover:text-[#c43e2c] hover:underline"
                        >
                          {p.nombre}
                        </Link>
                        {p.codigo_barras && (
                          <span className="text-[#c8a58a] text-xs font-mono mt-0.5">
                            {p.codigo_barras}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-[#6f3a2a] text-sm">
                      {p.categoria_nombre ?? (
                        <span className="text-[#c8a58a] italic">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-semibold text-[#391511] text-base">
                      {p.stock_actual}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-[#6f3a2a]">
                      {p.stock_minimo}
                    </TableCell>
                    <TableCell className="text-center">
                      <BadgeEstadoStock estado={p.estado_stock} />
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Link
                          href={`/inventario/${p.id}`}
                          title="Ver detalle"
                          className={cn(
                            buttonVariants({ variant: 'ghost', size: 'sm' }),
                            'text-[#6f3a2a] hover:bg-[#f9d2a2]/40 hover:text-[#391511]'
                          )}
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Link>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onImprimirEtiqueta(p)}
                          title="Imprimir etiqueta de precio"
                          className="text-[#6f3a2a] hover:bg-[#f9d2a2]/40 hover:text-[#391511]"
                        >
                          <Tag className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onAjustar(p)}
                          title="Ajustar stock"
                          className="text-[#6f3a2a] hover:bg-[#f9d2a2]/40 hover:text-[#391511]"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

function ColumnaOrdenable({
  etiqueta,
  ordenActual,
  ordenes,
  onClick,
  align = 'left',
}: {
  etiqueta: string
  ordenActual: NonNullable<FiltrosInventario['orden']>
  ordenes: NonNullable<FiltrosInventario['orden']>[]
  onClick: () => void
  align?: 'left' | 'right'
}) {
  const activo = ordenes.includes(ordenActual)
  return (
    <TableHead
      className={cn(
        'text-[#391511] font-semibold cursor-pointer select-none',
        align === 'right' && 'text-right'
      )}
      onClick={onClick}
    >
      <span
        className={cn(
          'inline-flex items-center gap-1',
          align === 'right' && 'justify-end',
          activo && 'text-[#c43e2c]'
        )}
      >
        {etiqueta}
        <ArrowUpDown className="h-3 w-3 opacity-60" />
      </span>
    </TableHead>
  )
}
