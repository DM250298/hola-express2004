'use client'

import Link from 'next/link'
import { ArrowUpDown, CalendarClock, Package, Eye, Power } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { useToggleProductoActivo } from '@/lib/hooks/useProductos'
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
  hayFiltros: boolean
  /** IDs de productos con lotes por vencer (<7 días), para marcar la fila. */
  idsPorVencer?: Set<number>
  /** Si el usuario puede ver precios de costo y margen (permiso `costos`). */
  puedeVerCosto: boolean
}

export function TablaStock({
  productos,
  isLoading,
  isError,
  orden,
  onCambiarOrden,
  hayFiltros,
  idsPorVencer,
  puedeVerCosto,
}: Props) {
  // Reactivar desde la fila (solo se ofrece en productos inactivos; el
  // detalle sigue teniendo el toggle completo activar/desactivar).
  const toggleActivo = useToggleProductoActivo()
  return (
    <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden shadow-sm">
      {isLoading ? (
        <div className="p-6">
          <SkeletonTabla filas={8} columnas={puedeVerCosto ? 8 : 6} />
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
                {puedeVerCosto && (
                  <TableHead className="text-right text-[#391511] font-semibold">
                    Precio costo
                  </TableHead>
                )}
                <TableHead className="text-right text-[#391511] font-semibold">
                  Precio de venta
                </TableHead>
                {puedeVerCosto && (
                  <TableHead className="text-right text-[#391511] font-semibold">
                    Margen de ganancia
                  </TableHead>
                )}
                <TableHead className="text-right w-24 text-[#391511] font-semibold">
                  Acciones
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {productos.map((p) => {
                const destacar =
                  p.estado_stock === 'bajo' || p.estado_stock === 'critico'
                // Mismo criterio que el detalle del producto: sin costo cargado
                // no hay margen que mostrar.
                const margen = p.precio_costo > 0 ? p.margen : null
                return (
                  <TableRow
                    key={p.id}
                    className={cn(
                      'border-b-[#e4c9b0]/40 hover:bg-[#fdfaf6]',
                      destacar &&
                        'bg-[#c43e2c]/[0.03] hover:bg-[#c43e2c]/[0.06]',
                      !p.activo && 'opacity-60'
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
                        <span className="flex items-center gap-1.5 mt-0.5">
                          {p.marca && (
                            <span className="text-[#6f3a2a] text-xs font-medium">
                              {p.marca}
                            </span>
                          )}
                          {p.codigo_barras && (
                            <span className="text-[#c8a58a] text-xs font-mono">
                              {p.codigo_barras}
                            </span>
                          )}
                          {idsPorVencer?.has(p.id) && (
                            <span
                              className="inline-flex items-center gap-0.5 rounded-full bg-[#c43e2c]/10 text-[#c43e2c] text-[10px] font-semibold px-1.5 py-0.5"
                              title="Tiene mercadería por vencer"
                            >
                              <CalendarClock className="h-3 w-3" />
                              por vencer
                            </span>
                          )}
                          {p.pendiente_precio && (
                            <span
                              className="inline-flex items-center gap-0.5 rounded-full bg-[#c43e2c]/12 text-[#c43e2c] text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5"
                              title="Producto sin precio: no se puede vender hasta cargar la factura o completar el precio"
                            >
                              Sin precio
                            </span>
                          )}
                          {!p.activo && (
                            <span
                              className="inline-flex items-center rounded-full bg-[#c8a58a]/30 text-[#6f3a2a] text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5"
                              title="Producto desactivado: no aparece en el POS ni en las vistas operativas"
                            >
                              Inactivo
                            </span>
                          )}
                        </span>
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
                    {puedeVerCosto && (
                      <TableCell className="text-right tabular-nums text-[#6f3a2a]">
                        {p.precio_costo > 0 ? (
                          <MontoARS monto={p.precio_costo} />
                        ) : (
                          <span className="text-[#c8a58a] italic">—</span>
                        )}
                      </TableCell>
                    )}
                    <TableCell className="text-right tabular-nums font-medium text-[#391511]">
                      {p.precio_venta > 0 ? (
                        <MontoARS monto={p.precio_venta} />
                      ) : (
                        <span className="text-[#c8a58a] italic">—</span>
                      )}
                    </TableCell>
                    {puedeVerCosto && (
                      <TableCell className="text-right tabular-nums font-semibold">
                        {margen != null ? (
                          <span
                            className={
                              margen >= 0 ? 'text-[#2f8f4e]' : 'text-[#c43e2c]'
                            }
                          >
                            {margen >= 0 ? '+' : ''}
                            {margen.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-[#c8a58a] italic">—</span>
                        )}
                      </TableCell>
                    )}
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {!p.activo && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              toggleActivo.mutate({ id: p.id, activo: true })
                            }
                            disabled={toggleActivo.isPending}
                            title="Reactivar producto (vuelve al POS y a las listas)"
                            className="text-[#2f8f4e] hover:bg-[#2f8f4e]/10 hover:text-[#2f8f4e]"
                          >
                            <Power className="h-3.5 w-3.5" />
                          </Button>
                        )}
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
