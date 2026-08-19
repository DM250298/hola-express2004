'use client'

import { useEffect, useMemo, useState } from 'react'
import { FileSpreadsheet, FileText, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  PaginadorTabla,
  paginarArreglo,
  type PorPagina,
} from '@/components/shared/PaginadorTabla'
import { PanelPendientes } from './PanelPendientes'
import { TablaStock } from './TablaStock'
import { useProductosConStock, useUbicaciones } from '@/lib/hooks/useInventario'
import { useProductosConLotesPorVencer } from '@/lib/hooks/useVencimientos'
import { useCategorias } from '@/lib/hooks/useCategorias'
import { useProveedores } from '@/lib/hooks/useProveedores'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { tienePermiso } from '@/lib/permisos'
import {
  exportarTablaExcel,
  exportarTablaPDF,
  type ColumnaExport,
} from '@/lib/utils/exportarTabla'
import { formatearCantidad, formatearMonto, formatearNumero } from '@/lib/utils/formato'
import type {
  EstadoStock,
  FiltrosInventario,
} from '@/lib/queries/inventario'

const TODAS_CAT = '__todas__'
const TODOS_PROV = '__todos__'
const TODAS_UBIC = '__todas_ubic__'
type OrdenInv = NonNullable<FiltrosInventario['orden']>

const ORDEN_ITEMS: Record<OrdenInv, string> = {
  nombre: 'Nombre (A→Z)',
  stock_asc: 'Stock (menor primero)',
  stock_desc: 'Stock (mayor primero)',
  categoria: 'Categoría',
}

/** Estado del producto: la vista operativa arranca en solo activos. */
type EstadoProducto = 'activos' | 'inactivos' | 'todos'

const ESTADO_PRODUCTO_ITEMS: Record<EstadoProducto, string> = {
  activos: 'Activos',
  inactivos: 'Inactivos',
  todos: 'Activos + inactivos',
}

export function TabStockInventario() {
  const [busquedaInput, setBusquedaInput] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [categoriaFiltro, setCategoriaFiltro] = useState<string>(TODAS_CAT)
  const [proveedorFiltro, setProveedorFiltro] = useState<string>(TODOS_PROV)
  const [ubicacionFiltro, setUbicacionFiltro] = useState<string>(TODAS_UBIC)
  const [estadoFiltro, setEstadoFiltro] = useState<EstadoStock | null>(null)
  // Activos / inactivos / todos: permite encontrar productos dados de baja
  // para reactivarlos sin salir de Stock.
  const [estadoProducto, setEstadoProducto] = useState<EstadoProducto>('activos')
  const [orden, setOrden] = useState<OrdenInv>('nombre')
  const [pagina, setPagina] = useState(0)
  const [porPagina, setPorPagina] = useState<PorPagina>(50)

  useEffect(() => {
    const t = setTimeout(() => setBusqueda(busquedaInput), 250)
    return () => clearTimeout(t)
  }, [busquedaInput])

  const filtros = useMemo<FiltrosInventario>(
    () => ({
      busqueda: busqueda || undefined,
      categoria_id:
        categoriaFiltro === TODAS_CAT ? undefined : Number(categoriaFiltro),
      proveedor_id:
        proveedorFiltro === TODOS_PROV ? undefined : Number(proveedorFiltro),
      ubicacion: ubicacionFiltro === TODAS_UBIC ? undefined : ubicacionFiltro,
      estado_stock: estadoFiltro,
      orden,
      solo_activos: estadoProducto === 'activos',
      // 'inactivos' aísla los dados de baja (manda sobre solo_activos).
      activo: estadoProducto === 'inactivos' ? false : undefined,
    }),
    [busqueda, categoriaFiltro, proveedorFiltro, ubicacionFiltro, estadoFiltro, estadoProducto, orden]
  )

  const { data: productos, isLoading, isError } = useProductosConStock(filtros)
  const { data: categorias } = useCategorias()
  const { data: proveedores } = useProveedores()
  const { data: ubicaciones } = useUbicaciones()
  const { data: usuario } = useUsuario()
  const { data: idsPorVencerArr } = useProductosConLotesPorVencer(
    tienePermiso(usuario?.permisos, 'vencimientos')
  )
  const idsPorVencer = useMemo(
    () => new Set(idsPorVencerArr ?? []),
    [idsPorVencerArr]
  )
  // Costo y margen solo para quien tiene el permiso (cajero/fiambrero no ven costo).
  const puedeVerCosto = tienePermiso(usuario?.permisos, 'costos')

  const itemsUbicacion = useMemo(() => {
    const r: Record<string, string> = { [TODAS_UBIC]: 'Todas las ubicaciones' }
    for (const u of ubicaciones ?? []) r[u] = u
    return r
  }, [ubicaciones])

  const itemsCategoria = useMemo(() => {
    const r: Record<string, string> = { [TODAS_CAT]: 'Todas las categorías' }
    for (const c of categorias ?? []) r[String(c.id)] = c.nombre
    return r
  }, [categorias])

  const itemsProveedor = useMemo(() => {
    const r: Record<string, string> = { [TODOS_PROV]: 'Todos los proveedores' }
    for (const p of proveedores ?? []) r[String(p.id)] = p.nombre
    return r
  }, [proveedores])

  useEffect(() => {
    setPagina(0)
  }, [filtros])

  const productosPagina = useMemo(
    () => paginarArreglo(productos ?? [], pagina, porPagina),
    [productos, pagina, porPagina]
  )

  const hayFiltros =
    !!busqueda ||
    categoriaFiltro !== TODAS_CAT ||
    proveedorFiltro !== TODOS_PROV ||
    ubicacionFiltro !== TODAS_UBIC ||
    estadoFiltro !== null ||
    estadoProducto !== 'activos'

  // Exporta la lista COMPLETA filtrada (no solo la página visible).
  async function exportar(tipo: 'excel' | 'pdf') {
    if (!productos || productos.length === 0) return

    const partes: string[] = []
    if (categoriaFiltro !== TODAS_CAT)
      partes.push(itemsCategoria[categoriaFiltro] ?? 'Categoría')
    if (proveedorFiltro !== TODOS_PROV)
      partes.push(itemsProveedor[proveedorFiltro] ?? 'Proveedor')
    if (ubicacionFiltro !== TODAS_UBIC) partes.push(ubicacionFiltro)
    if (estadoFiltro)
      partes.push(
        { normal: 'Stock normal', bajo: 'Stock bajo', critico: 'Sin stock' }[
          estadoFiltro
        ] ?? estadoFiltro
      )
    if (estadoProducto !== 'activos')
      partes.push(ESTADO_PRODUCTO_ITEMS[estadoProducto])
    if (busqueda) partes.push(`búsqueda: «${busqueda}»`)
    const subtitulo =
      partes.length > 0 ? partes.join(' · ') : 'Todos los productos activos'

    const ESTADO_LABEL: Record<EstadoStock, string> = {
      normal: 'Normal',
      bajo: 'Bajo',
      critico: 'Crítico',
    }

    const columnas: ColumnaExport[] = [
      { titulo: '#', wch: 5, pdfAncho: 9, align: 'right' },
      { titulo: 'Producto', wch: 42, pdfAncho: 48 },
      { titulo: 'Código', wch: 16, pdfAncho: 24 },
      { titulo: 'Categoría', wch: 16, pdfAncho: 20 },
      { titulo: 'Proveedor', wch: 18, pdfAncho: 22 },
      { titulo: 'Stock', wch: 10, pdfAncho: 15, align: 'right' },
      { titulo: 'Mínimo', wch: 9, pdfAncho: 13, align: 'right' },
      { titulo: 'Estado', wch: 9, pdfAncho: 13, align: 'center' },
      { titulo: 'Precio venta', wch: 13, pdfAncho: 18, align: 'right' },
      ...(puedeVerCosto
        ? [
            { titulo: 'Costo', wch: 12, align: 'right' as const },
            { titulo: 'Margen %', wch: 9, align: 'right' as const },
          ]
        : []),
    ]

    const filas = productos.map((p, i) => [
      i + 1,
      p.nombre,
      p.codigo_barras ?? '',
      p.categoria_nombre ?? '',
      p.proveedor_nombre ?? '',
      p.stock_actual,
      p.stock_minimo,
      ESTADO_LABEL[p.estado_stock],
      p.precio_venta,
      ...(puedeVerCosto ? [p.precio_costo, p.margen] : []),
    ])

    const filasPdf = productos.map((p, i) => [
      i + 1,
      p.nombre,
      p.codigo_barras ?? '—',
      p.categoria_nombre ?? '—',
      p.proveedor_nombre ?? '—',
      formatearCantidad(p.stock_actual, p.venta_por_peso),
      formatearCantidad(p.stock_minimo, p.venta_por_peso),
      ESTADO_LABEL[p.estado_stock],
      formatearMonto(p.precio_venta),
      ...(puedeVerCosto
        ? [formatearMonto(p.precio_costo), `${formatearNumero(p.margen)} %`]
        : []),
    ])

    const sinStock = productos.filter((p) => p.estado_stock === 'critico').length
    const bajos = productos.filter((p) => p.estado_stock === 'bajo').length
    const opciones = {
      titulo: 'Inventario de stock',
      subtitulo,
      archivo: 'stock',
      columnas,
      filas,
      filasPdf,
      kpis: [
        { etiqueta: 'Productos', valor: formatearNumero(productos.length) },
        { etiqueta: 'Sin stock', valor: formatearNumero(sinStock) },
        { etiqueta: 'Stock bajo', valor: formatearNumero(bajos) },
      ],
    }

    try {
      if (tipo === 'excel') await exportarTablaExcel(opciones)
      else await exportarTablaPDF(opciones)
    } catch {
      toast.error(`No se pudo generar el ${tipo === 'excel' ? 'Excel' : 'PDF'}.`)
    }
  }

  return (
    <div className="space-y-5">
      <PanelPendientes
        estadoFiltro={estadoFiltro}
        onCambiarFiltro={setEstadoFiltro}
      />

      {/* Filtros */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#c8a58a]" />
          <Input
            placeholder="Buscar por nombre o código…"
            value={busquedaInput}
            onChange={(e) => setBusquedaInput(e.target.value)}
            className="pl-9 border-[#e4c9b0] focus-visible:ring-[#f9b44c] bg-white"
          />
        </div>

        <Select
          items={itemsCategoria}
          value={categoriaFiltro}
          onValueChange={(v) => setCategoriaFiltro(v ?? TODAS_CAT)}
        >
          <SelectTrigger className="w-[180px] border-[#e4c9b0] focus:ring-[#f9b44c] bg-white">
            <SelectValue placeholder="Categoría" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODAS_CAT}>Todas las categorías</SelectItem>
            {categorias?.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          items={itemsProveedor}
          value={proveedorFiltro}
          onValueChange={(v) => setProveedorFiltro(v ?? TODOS_PROV)}
        >
          <SelectTrigger className="w-[180px] border-[#e4c9b0] focus:ring-[#f9b44c] bg-white">
            <SelectValue placeholder="Proveedor" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS_PROV}>Todos los proveedores</SelectItem>
            {proveedores?.map((p) => (
              <SelectItem key={p.id} value={String(p.id)}>
                {p.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {ubicaciones && ubicaciones.length > 0 && (
          <Select
            items={itemsUbicacion}
            value={ubicacionFiltro}
            onValueChange={(v) => setUbicacionFiltro(v ?? TODAS_UBIC)}
          >
            <SelectTrigger className="w-[180px] border-[#e4c9b0] focus:ring-[#f9b44c] bg-white">
              <SelectValue placeholder="Ubicación" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODAS_UBIC}>Todas las ubicaciones</SelectItem>
              {ubicaciones.map((u) => (
                <SelectItem key={u} value={u}>
                  {u}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Select
          items={ESTADO_PRODUCTO_ITEMS}
          value={estadoProducto}
          onValueChange={(v) =>
            setEstadoProducto((v ?? 'activos') as EstadoProducto)
          }
        >
          <SelectTrigger
            className="w-[170px] border-[#e4c9b0] focus:ring-[#f9b44c] bg-white"
            title="Estado del producto: los inactivos no se venden en el POS, pero podés verlos acá para reactivarlos"
          >
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="activos">Activos</SelectItem>
            <SelectItem value="inactivos">Inactivos</SelectItem>
            <SelectItem value="todos">Activos + inactivos</SelectItem>
          </SelectContent>
        </Select>

        <Select
          items={ORDEN_ITEMS}
          value={orden}
          onValueChange={(v) => setOrden((v ?? 'nombre') as OrdenInv)}
        >
          <SelectTrigger className="w-[180px] border-[#e4c9b0] focus:ring-[#f9b44c] bg-white">
            <SelectValue placeholder="Ordenar" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="nombre">Nombre (A→Z)</SelectItem>
            <SelectItem value="stock_asc">Stock (menor primero)</SelectItem>
            <SelectItem value="stock_desc">Stock (mayor primero)</SelectItem>
            <SelectItem value="categoria">Categoría</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between text-sm gap-2 flex-wrap">
        <p className="text-[#6f3a2a]">
          <span className="font-semibold text-[#391511]">
            {productos?.length ?? 0}
          </span>{' '}
          {productos?.length === 1 ? 'producto' : 'productos'}
          {hayFiltros && ' (filtrados)'}
        </p>
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportar('excel')}
            disabled={!productos || productos.length === 0}
            className="h-8 border-[#e4c9b0] text-[#6f3a2a] gap-1.5 disabled:opacity-40"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            Excel
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportar('pdf')}
            disabled={!productos || productos.length === 0}
            className="h-8 border-[#e4c9b0] text-[#6f3a2a] gap-1.5 disabled:opacity-40"
          >
            <FileText className="h-3.5 w-3.5" />
            PDF
          </Button>
        </div>
      </div>

      <TablaStock
        productos={productosPagina}
        isLoading={isLoading}
        isError={isError}
        orden={orden}
        onCambiarOrden={setOrden}
        hayFiltros={hayFiltros}
        idsPorVencer={idsPorVencer}
        puedeVerCosto={puedeVerCosto}
      />

      {productos && productos.length > 0 && (
        <PaginadorTabla
          total={productos.length}
          porPagina={porPagina}
          pagina={pagina}
          onCambioPorPagina={setPorPagina}
          onCambioPagina={setPagina}
        />
      )}
    </div>
  )
}
