'use client'

import Link from 'next/link'
import { ArrowUpDown, CalendarClock, Package, Pencil, Eye, Tag } from 'lucide-react'
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
import { Sparkline } from './Sparkline'
import type {
  FiltrosInventario,
  ProductoConStock,
} from '@/lib/queries/inventario'
import { cn } from '@/lib/utils'

type NivelCobertura = 'sin_datos' | 'critico' | 'bajo' | 'normal'

function nivelCobertura(dias: number | null): NivelCobertura {
  if (dias == null) return 'sin_datos'
  if (dias < 3) return 'critico'
  if (dias < 7) return 'bajo'
  return 'normal'
}

const COLOR_COBERTURA: Record<NivelCobertura, string> = {
  sin_datos: '#c8a58a',
  critico: '#c43e2c',
  bajo: '#e4a42a',
  normal: '#2f8f4e',
}

function formatearDias(dias: number | null): string {
  if (dias == null) return 'Sin ventas'
  if (dias >= 999) return '>999 d'
  if (dias < 1) return `${dias.toFixed(1)} d`
  return `${Math.round(dias)} d`
}

interface Props {
  productos: ProductoConStock[] | undefined
  isLoading: boolean
  isError: boolean
  orden: NonNullable<FiltrosInventario['orden']>
  onCambiarOrden: (o: NonNullable<FiltrosInventario['orden']>) => void
  onAjustar: (producto: ProductoConStock) => void
  onImprimirEtiqueta: (producto: ProductoConStock) => void
  hayFiltros: boolean
  /** IDs de productos con lotes por vencer (<7 días), para marcar la fila. */
  idsPorVencer?: Set<number>
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
  idsPorVencer,
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
                <TableHead className="text-[#391511] font-semibold">
                  Ubicación
                </TableHead>
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
                <TableHead className="text-[#391511] font-semibold">
                  <span className="inline-flex flex-col">
                    Días de stock
                    <span className="text-[10px] font-normal text-[#c8a58a]">
                      te dura · 14d
                    </span>
                  </span>
                </TableHead>
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
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-[#6f3a2a] text-sm">
                      {p.categoria_nombre ?? (
                        <span className="text-[#c8a58a] italic">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-[#6f3a2a] text-sm">
                      {p.ubicacion ?? (
                        <span className="text-[#c8a58a] italic">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-semibold text-[#391511] text-base">
                      {p.stock_actual}
                    </TableCell>
                    <TableCell>
                      <CeldaCobertura
                        dias={p.dias_cobertura}
                        serie={p.serie_14d}
                        promedio={p.promedio_diario}
                      />
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

function CeldaCobertura({
  dias,
  serie,
  promedio,
}: {
  dias: number | null
  serie: number[]
  promedio: number
}) {
  const nivel = nivelCobertura(dias)
  const color = COLOR_COBERTURA[nivel]
  const sinVentas = nivel === 'sin_datos'
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex flex-col leading-tight min-w-[58px]">
        <span
          className={cn(
            'font-bold tabular-nums text-sm',
            sinVentas && 'text-[#c8a58a] italic font-medium text-xs'
          )}
          style={!sinVentas ? { color } : undefined}
          title={
            sinVentas
              ? 'Sin ventas en los últimos 14 días'
              : `${promedio.toFixed(1)} unid/día promedio`
          }
        >
          {formatearDias(dias)}
        </span>
        {!sinVentas && (
          <span className="text-[10px] text-[#c8a58a] tabular-nums">
            {promedio.toFixed(1)}/día
          </span>
        )}
      </div>
      <Sparkline
        datos={serie}
        ancho={70}
        alto={18}
        color={sinVentas ? '#c8a58a' : color}
        ariaLabel={`Ventas de los últimos 14 días`}
      />
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
