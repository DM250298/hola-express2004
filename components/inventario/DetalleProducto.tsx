'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  ArrowDown,
  ArrowUp,
  Box,
  ChevronLeft,
  ChevronRight,
  Package,
  Pencil,
  RefreshCcw,
  ShoppingCart,
  Tag,
  TrendingUp,
  Truck,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { MontoARS } from '@/components/shared/MontoARS'
import { BadgeEstadoStock } from '@/components/shared/BadgeEstadoStock'
import { SkeletonTabla } from '@/components/shared/SkeletonTabla'
import {
  useCoberturaProducto,
  useHistorialMovimientos,
  useProductoDetalle,
} from '@/lib/hooks/useInventario'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { tienePermiso } from '@/lib/permisos'
import { calcularEstadoStock } from '@/lib/queries/inventario'
import type { ProductoConRelaciones } from '@/lib/queries/productos'
import { formatearFechaHora } from '@/lib/utils/formato'
import { ModalAjusteStock } from './ModalAjusteStock'
import { DrawerProducto } from '@/components/configuracion/productos/DrawerProducto'
import { GraficoEvolucionStock } from './GraficoEvolucionStock'
import { Sparkline } from './Sparkline'
import { cn } from '@/lib/utils'
import type { TipoMovimiento } from '@/types/database'

interface Props {
  productoId: number
}

const POR_PAGINA = 20

const CONFIG_TIPO: Record<
  TipoMovimiento,
  { etiqueta: string; icono: React.ElementType; clase: string }
> = {
  entrada: {
    etiqueta: 'Entrada',
    icono: ArrowUp,
    clase: 'text-[#6f3a2a] bg-[#f9b44c]/20',
  },
  salida: {
    etiqueta: 'Salida',
    icono: ArrowDown,
    clase: 'text-[#9e2f25] bg-[#c43e2c]/15',
  },
  ajuste: {
    etiqueta: 'Corrección',
    icono: RefreshCcw,
    clase: 'text-[#6f3a2a] bg-[#c8a58a]/30',
  },
  merma: {
    etiqueta: 'Merma',
    icono: ArrowDown,
    clase: 'text-[#9e2f25] bg-[#c43e2c]/15',
  },
  venta: {
    etiqueta: 'Venta',
    icono: ShoppingCart,
    clase: 'text-[#6f3a2a] bg-[#ebd5a1]/40',
  },
  consumo_produccion: {
    etiqueta: 'Consumo prod.',
    icono: ArrowDown,
    clase: 'text-[#9e2f25] bg-[#c43e2c]/15',
  },
  ingreso_produccion: {
    etiqueta: 'Producción',
    icono: Box,
    clase: 'text-[#6f3a2a] bg-[#f9b44c]/20',
  },
}

export function DetalleProducto({ productoId }: Props) {
  const { data: producto, isLoading: cargandoProd, isError } =
    useProductoDetalle(productoId)
  const { data: cobertura } = useCoberturaProducto(productoId)
  const { data: usuario } = useUsuario()
  const [pagina, setPagina] = useState(0)
  const [modalAjusteAbierto, setModalAjusteAbierto] = useState(false)
  const [modalEditarAbierto, setModalEditarAbierto] = useState(false)

  const { data: historial, isLoading: cargandoHist } = useHistorialMovimientos(
    productoId,
    pagina,
    POR_PAGINA
  )

  if (cargandoProd) {
    return (
      <div className="p-6 max-w-5xl mx-auto space-y-4">
        <Skeleton className="h-6 w-40 bg-[#f9d2a2]/30" />
        <Skeleton className="h-40 rounded-2xl bg-[#f9d2a2]/30" />
        <Skeleton className="h-64 rounded-2xl bg-[#f9d2a2]/30" />
      </div>
    )
  }

  if (isError || !producto) {
    return (
      <div className="p-12 text-center">
        <Package className="h-10 w-10 text-[#c8a58a] mx-auto mb-3" />
        <p className="text-[#391511] font-semibold">Producto no encontrado</p>
        <Link
          href="/inventario"
          className="text-[#c43e2c] text-sm hover:underline mt-1 inline-block"
        >
          Volver al inventario
        </Link>
      </div>
    )
  }

  const estadoStock = calcularEstadoStock(
    producto.stock_actual,
    producto.stock_minimo
  )
  const puedeVerCosto = usuario?.rol !== 'cajero'
  const puedeEditar = tienePermiso(usuario?.permisos, 'configuracion')

  // Margen / ganancia: el precio de venta es con IVA; lo bajamos a neto para
  // compararlo contra el costo (neto) y sacar el % de ganancia sobre costo.
  const precioSinIva =
    producto.iva_venta > 0
      ? producto.precio_venta / (1 + producto.iva_venta / 100)
      : producto.precio_venta
  const gananciaUnidad = precioSinIva - producto.precio_costo
  const margenPct =
    producto.precio_costo > 0
      ? (gananciaUnidad / producto.precio_costo) * 100
      : null

  const totalPaginas = Math.ceil((historial?.total ?? 0) / POR_PAGINA)
  const hayPaginaAnterior = pagina > 0
  const hayPaginaSiguiente = pagina < totalPaginas - 1

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5">
      {/* Breadcrumb */}
      <div>
        <Link
          href="/inventario"
          className="inline-flex items-center gap-1 text-sm text-[#6f3a2a] hover:text-[#391511] transition-colors"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Inventario
        </Link>
      </div>

      {/* Header del producto */}
      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
          <div className="flex items-start gap-3 min-w-0">
            {producto.imagen_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={producto.imagen_url}
                alt={producto.nombre}
                className="h-16 w-16 shrink-0 rounded-xl object-cover border border-[#e4c9b0]"
              />
            )}
            <div className="min-w-0">
            <h1 className="text-[#391511] text-2xl font-bold leading-tight">
              {producto.nombre}
            </h1>
            <div className="flex items-center gap-3 mt-1 text-sm text-[#6f3a2a]">
              {producto.codigo_barras && (
                <span className="font-mono text-[#c8a58a]">
                  {producto.codigo_barras}
                </span>
              )}
              {!producto.activo && (
                <span className="text-[10px] uppercase tracking-wider bg-[#c8a58a]/30 text-[#6f3a2a] px-2 py-0.5 rounded-full font-semibold">
                  Inactivo
                </span>
              )}
            </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {puedeEditar && (
              <Button
                variant="outline"
                onClick={() => setModalEditarAbierto(true)}
                className="border-[#e4c9b0] text-[#6f3a2a] hover:bg-[#f9d2a2]/40 gap-1.5"
              >
                <Pencil className="h-4 w-4" />
                Editar producto
              </Button>
            )}
            <Button
              onClick={() => setModalAjusteAbierto(true)}
              className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5"
            >
              <Box className="h-4 w-4" />
              Ajustar stock
            </Button>
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <StatBlock
            etiqueta="Stock actual"
            valor={String(producto.stock_actual)}
            destacar={estadoStock !== 'normal'}
            badge={<BadgeEstadoStock estado={estadoStock} />}
          />
          <StatBlock
            etiqueta="Stock mínimo"
            valor={String(producto.stock_minimo)}
          />
          <StatBlock
            etiqueta="Precio venta"
            valor={<MontoARS monto={producto.precio_venta} />}
          />
          {puedeVerCosto && (
            <StatBlock
              etiqueta="Precio costo"
              valor={<MontoARS monto={producto.precio_costo} />}
            />
          )}
          {puedeVerCosto && (
            <StatBlock
              etiqueta="Ganancia"
              valor={
                margenPct != null ? (
                  <span
                    className={
                      margenPct >= 0 ? 'text-[#2f8f4e]' : 'text-[#c43e2c]'
                    }
                  >
                    {margenPct >= 0 ? '+' : ''}
                    {margenPct.toFixed(0)}%
                  </span>
                ) : (
                  '—'
                )
              }
              badge={
                <span className="text-[11px] text-[#6f3a2a]">
                  <MontoARS monto={gananciaUnidad} /> /u
                </span>
              }
            />
          )}
        </div>

        {/* Meta */}
        <div className="flex flex-wrap gap-3 mt-4 pt-4 border-t border-[#e4c9b0]/60 text-xs text-[#6f3a2a]">
          {producto.categoria_nombre && (
            <span className="inline-flex items-center gap-1">
              <Tag className="h-3 w-3" />
              {producto.categoria_nombre}
            </span>
          )}
          {producto.proveedor_nombre && (
            <span className="inline-flex items-center gap-1">
              <Truck className="h-3 w-3" />
              {producto.proveedor_nombre}
            </span>
          )}
        </div>
      </div>

      {/* Velocidad de venta */}
      <PanelCobertura cobertura={cobertura ?? null} />

      {/* Gráfico de evolución */}
      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="h-4 w-4 text-[#f9b44c]" />
          <h2 className="text-[#391511] font-bold">Evolución del stock</h2>
          <span className="text-xs text-[#6f3a2a]">· últimos 30 días</span>
        </div>
        <GraficoEvolucionStock
          producto_id={producto.id}
          stock_minimo={producto.stock_minimo}
        />
      </div>

      {/* Historial */}
      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden shadow-sm">
        <div className="px-5 py-4 border-b border-[#e4c9b0]/60 bg-[#fdfaf6] flex items-center gap-2">
          <Box className="h-4 w-4 text-[#391511]" />
          <h2 className="text-[#391511] font-bold">Historial de movimientos</h2>
          {historial && (
            <span className="text-xs text-[#6f3a2a]">
              · {historial.total} total
            </span>
          )}
        </div>

        {cargandoHist ? (
          <div className="p-6">
            <SkeletonTabla filas={6} columnas={5} />
          </div>
        ) : !historial || historial.movimientos.length === 0 ? (
          <div className="p-10 text-center text-[#6f3a2a] text-sm">
            Sin movimientos registrados aún.
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-b-[#e4c9b0]/60 bg-[#fdfaf6] hover:bg-[#fdfaf6]">
                    <TableHead className="text-[#391511] font-semibold">
                      Fecha
                    </TableHead>
                    <TableHead className="text-[#391511] font-semibold">
                      Tipo
                    </TableHead>
                    <TableHead className="text-right text-[#391511] font-semibold">
                      Cantidad
                    </TableHead>
                    <TableHead className="text-right text-[#391511] font-semibold">
                      Stock
                    </TableHead>
                    <TableHead className="text-[#391511] font-semibold">
                      Usuario / Nota
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {historial.movimientos.map((m) => {
                    const config = CONFIG_TIPO[m.tipo]
                    const Icono = config.icono
                    const esSuma =
                      m.tipo === 'entrada' ||
                      (m.tipo === 'ajuste' && m.stock_nuevo > m.stock_anterior)
                    return (
                      <TableRow
                        key={m.id}
                        className="border-b-[#e4c9b0]/40 hover:bg-[#fdfaf6]"
                      >
                        <TableCell className="text-[#6f3a2a] text-xs tabular-nums whitespace-nowrap">
                          {formatearFechaHora(m.created_at)}
                        </TableCell>
                        <TableCell>
                          <span
                            className={cn(
                              'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide',
                              config.clase
                            )}
                          >
                            <Icono className="h-3 w-3" />
                            {config.etiqueta}
                          </span>
                        </TableCell>
                        <TableCell
                          className={cn(
                            'text-right font-bold tabular-nums',
                            esSuma ? 'text-[#6f3a2a]' : 'text-[#c43e2c]'
                          )}
                        >
                          {esSuma ? '+' : '−'}
                          {m.cantidad}
                        </TableCell>
                        <TableCell className="text-right text-[#391511] tabular-nums">
                          <span className="text-[#c8a58a] text-xs">
                            {m.stock_anterior} →{' '}
                          </span>
                          <span className="font-semibold">{m.stock_nuevo}</span>
                        </TableCell>
                        <TableCell className="text-[#6f3a2a] text-xs">
                          <div className="font-medium text-[#391511]">
                            {m.usuario_nombre ?? '—'}
                          </div>
                          {m.nota && (
                            <div className="text-[#6f3a2a] mt-0.5">
                              {m.nota}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Paginación */}
            {totalPaginas > 1 && (
              <div className="px-5 py-3 border-t border-[#e4c9b0]/60 bg-[#fdfaf6] flex items-center justify-between">
                <span className="text-xs text-[#6f3a2a]">
                  Página {pagina + 1} de {totalPaginas}
                </span>
                <div className="flex gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!hayPaginaAnterior}
                    onClick={() => setPagina((p) => p - 1)}
                    className="border-[#e4c9b0] text-[#6f3a2a] disabled:opacity-40"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                    Anterior
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!hayPaginaSiguiente}
                    onClick={() => setPagina((p) => p + 1)}
                    className="border-[#e4c9b0] text-[#6f3a2a] disabled:opacity-40"
                  >
                    Siguiente
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <ModalAjusteStock
        abierto={modalAjusteAbierto}
        onCambioAbierto={setModalAjusteAbierto}
        producto={{
          id: producto.id,
          nombre: producto.nombre,
          stock_actual: producto.stock_actual,
        }}
      />

      {puedeEditar && (
        <DrawerProducto
          abierto={modalEditarAbierto}
          onCambioAbierto={setModalEditarAbierto}
          producto={
            {
              ...producto,
              categorias:
                producto.categoria_id != null
                  ? { id: producto.categoria_id, nombre: producto.categoria_nombre ?? '' }
                  : null,
              proveedores:
                producto.proveedor_id != null
                  ? { id: producto.proveedor_id, nombre: producto.proveedor_nombre ?? '' }
                  : null,
            } as ProductoConRelaciones
          }
        />
      )}
    </div>
  )
}

function PanelCobertura({
  cobertura,
}: {
  cobertura:
    | {
        promedio_diario: number
        dias_cobertura: number | null
        serie_14d: number[]
        ventas_14d: number
      }
    | null
}) {
  const dias = cobertura?.dias_cobertura ?? null
  const promedio = cobertura?.promedio_diario ?? 0
  const serie = cobertura?.serie_14d ?? Array(14).fill(0)
  const ventas14d = cobertura?.ventas_14d ?? 0
  const sinVentas = dias == null

  const { color, etiqueta } = (() => {
    if (sinVentas) return { color: '#c8a58a', etiqueta: 'Sin ventas' }
    if (dias! < 3) return { color: '#c43e2c', etiqueta: 'Crítico' }
    if (dias! < 7) return { color: '#e4a42a', etiqueta: 'Apretado' }
    return { color: '#2f8f4e', etiqueta: 'Holgado' }
  })()

  const diasTexto = sinVentas
    ? '—'
    : dias! >= 999
      ? '>999'
      : dias! < 1
        ? dias!.toFixed(1)
        : String(Math.round(dias!))

  return (
    <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <TrendingUp className="h-4 w-4 text-[#f9b44c]" />
        <h2 className="text-[#391511] font-bold">Velocidad de venta</h2>
        <span className="text-xs text-[#6f3a2a]">· últimos 14 días</span>
      </div>
      <div className="flex items-center gap-5 flex-wrap">
        <div className="flex flex-col leading-none">
          <span
            className="font-extrabold tabular-nums text-4xl"
            style={!sinVentas ? { color } : { color: '#c8a58a' }}
          >
            {diasTexto}
            {!sinVentas && (
              <span className="text-base font-bold ml-1 text-[#6f3a2a]">días</span>
            )}
          </span>
          <span
            className="text-[10px] uppercase tracking-wider font-bold mt-1.5"
            style={{ color }}
          >
            {etiqueta}
          </span>
        </div>

        <div className="h-12 w-px bg-[#e4c9b0]/60" />

        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
            Promedio diario
          </span>
          <span className="text-[#391511] font-extrabold text-xl tabular-nums">
            {promedio.toFixed(1)}
            <span className="text-xs font-medium text-[#6f3a2a] ml-1">unid/día</span>
          </span>
        </div>

        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
            Total 14 días
          </span>
          <span className="text-[#391511] font-extrabold text-xl tabular-nums">
            {Math.round(ventas14d)}
          </span>
        </div>

        <div className="ml-auto">
          <Sparkline
            datos={serie}
            ancho={180}
            alto={42}
            color={sinVentas ? '#c8a58a' : color}
            ariaLabel="Ventas de los últimos 14 días"
          />
        </div>
      </div>
    </div>
  )
}

function StatBlock({
  etiqueta,
  valor,
  destacar,
  badge,
}: {
  etiqueta: string
  valor: React.ReactNode
  destacar?: boolean
  badge?: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'rounded-xl px-3 py-3 border',
        destacar
          ? 'bg-[#c43e2c]/5 border-[#c43e2c]/30'
          : 'bg-[#fdfaf6] border-[#e4c9b0]/60'
      )}
    >
      <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
        {etiqueta}
      </div>
      <div className="text-[#391511] font-extrabold text-xl tabular-nums mt-0.5">
        {valor}
      </div>
      {badge && <div className="mt-1.5">{badge}</div>}
    </div>
  )
}
