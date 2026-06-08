'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CalendarClock,
  Package,
  Pencil,
  Plus,
  PowerOff,
  Power,
  Search,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
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
import { DrawerProducto } from './DrawerProducto'
import { ModalVencimientoMinimoMasivo } from './ModalVencimientoMinimoMasivo'
import { BotonesImportExport } from '@/components/import/BotonesImportExport'
import { ENTIDAD_PRODUCTOS } from '@/lib/import/entidades'
import {
  PaginadorTabla,
  paginarArreglo,
  type PorPagina,
} from '@/components/shared/PaginadorTabla'
import {
  useOpcionesTipoUnidad,
  useProductos,
  useToggleProductoActivo,
} from '@/lib/hooks/useProductos'
import { useCategorias } from '@/lib/hooks/useCategorias'
import { useProveedores } from '@/lib/hooks/useProveedores'
import type { ProductoConRelaciones } from '@/lib/queries/productos'

const TODAS = '__todas__'

export function TablaProductos() {
  // Input vs valor con debounce para evitar refetch por cada tecla
  const [busquedaInput, setBusquedaInput] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [categoriaFiltro, setCategoriaFiltro] = useState<string>(TODAS)
  const [proveedorFiltro, setProveedorFiltro] = useState<string>(TODAS)
  const [tipoFiltro, setTipoFiltro] = useState<string>(TODAS)
  const [unidadFiltro, setUnidadFiltro] = useState<string>(TODAS)
  const [drawerAbierto, setDrawerAbierto] = useState(false)
  const [modalVencMinAbierto, setModalVencMinAbierto] = useState(false)
  const [productoEditar, setProductoEditar] =
    useState<ProductoConRelaciones | null>(null)
  const [pagina, setPagina] = useState(0)
  const [porPagina, setPorPagina] = useState<PorPagina>(25)

  // Debounce de 250ms
  useEffect(() => {
    const t = setTimeout(() => setBusqueda(busquedaInput), 250)
    return () => clearTimeout(t)
  }, [busquedaInput])

  const filtros = useMemo(
    () => ({
      busqueda: busqueda || undefined,
      categoria_id:
        categoriaFiltro === TODAS ? undefined : Number(categoriaFiltro),
      proveedor_id:
        proveedorFiltro === TODAS ? undefined : Number(proveedorFiltro),
      tipo: tipoFiltro === TODAS ? undefined : tipoFiltro,
      unidad: unidadFiltro === TODAS ? undefined : unidadFiltro,
    }),
    [busqueda, categoriaFiltro, proveedorFiltro, tipoFiltro, unidadFiltro]
  )

  const { data: productos, isLoading, isError } = useProductos(filtros)
  const { data: categorias } = useCategorias()
  const { data: proveedores } = useProveedores()
  const { data: opcionesTU } = useOpcionesTipoUnidad()
  const toggleActivo = useToggleProductoActivo()

  // Resetear a primera página cuando cambian los filtros
  useEffect(() => {
    setPagina(0)
  }, [busqueda, categoriaFiltro, proveedorFiltro, tipoFiltro, unidadFiltro])

  const productosPagina = useMemo(
    () => paginarArreglo(productos ?? [], pagina, porPagina),
    [productos, pagina, porPagina]
  )

  function abrirNuevo() {
    setProductoEditar(null)
    setDrawerAbierto(true)
  }

  function abrirEdicion(producto: ProductoConRelaciones) {
    setProductoEditar(producto)
    setDrawerAbierto(true)
  }

  function handleToggleActivo(producto: ProductoConRelaciones) {
    toggleActivo.mutate({ id: producto.id, activo: !producto.activo })
  }

  const hayFiltrosActivos =
    !!busqueda ||
    categoriaFiltro !== TODAS ||
    proveedorFiltro !== TODAS ||
    tipoFiltro !== TODAS ||
    unidadFiltro !== TODAS

  function limpiarFiltros() {
    setBusquedaInput('')
    setBusqueda('')
    setCategoriaFiltro(TODAS)
    setProveedorFiltro(TODAS)
    setTipoFiltro(TODAS)
    setUnidadFiltro(TODAS)
  }

  return (
    <div className="space-y-4">
      {/* Header + acciones */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[#391511] text-lg font-bold">
            {productos?.length ?? 0} productos
            {hayFiltrosActivos && (
              <span className="text-[#6f3a2a] font-normal text-sm ml-2">
                (filtrados)
              </span>
            )}
          </h2>
          <p className="text-[#6f3a2a] text-sm">
            Gestioná tu catálogo y precios.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setModalVencMinAbierto(true)}
            className="border-[#e4c9b0] text-[#6f3a2a] hover:bg-[#fdfaf6] gap-1.5"
            title="Aplicar vencimiento mínimo masivo por categoría o proveedor"
          >
            <CalendarClock className="h-4 w-4" />
            Vencimiento mín.
          </Button>
          <BotonesImportExport def={ENTIDAD_PRODUCTOS} size="default" />
          <Button
            onClick={abrirNuevo}
            className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5"
          >
            <Plus className="h-4 w-4" />
            Nuevo producto
          </Button>
        </div>
      </div>

      {/* Búsqueda */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#c8a58a]" />
        <Input
          placeholder="Buscar por nombre o código de barras..."
          value={busquedaInput}
          onChange={(e) => setBusquedaInput(e.target.value)}
          className="pl-9 border-[#e4c9b0] focus-visible:ring-[#f9b44c] bg-white"
        />
      </div>

      {/* Grid de 4 filtros */}
      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-4 shadow-sm">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Tipo */}
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
              Tipo de producto
            </label>
            <Select
              value={tipoFiltro}
              onValueChange={(v) => setTipoFiltro(v ?? TODAS)}
            >
              <SelectTrigger className="border-[#e4c9b0] focus:ring-[#f9b44c] bg-white">
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TODAS}>Todos</SelectItem>
                {(opcionesTU?.tipos ?? ['simple', 'combo', 'variante']).map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Categoría */}
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
              Categoría
            </label>
            <Select
              value={categoriaFiltro}
              onValueChange={(v) => setCategoriaFiltro(v ?? TODAS)}
            >
              <SelectTrigger className="border-[#e4c9b0] focus:ring-[#f9b44c] bg-white">
                <SelectValue placeholder="Todas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TODAS}>Todas</SelectItem>
                {categorias?.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Proveedor */}
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
              Proveedor
            </label>
            <Select
              value={proveedorFiltro}
              onValueChange={(v) => setProveedorFiltro(v ?? TODAS)}
            >
              <SelectTrigger className="border-[#e4c9b0] focus:ring-[#f9b44c] bg-white">
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TODAS}>Todos</SelectItem>
                {proveedores?.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Unidad */}
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
              Unidad
            </label>
            <Select
              value={unidadFiltro}
              onValueChange={(v) => setUnidadFiltro(v ?? TODAS)}
            >
              <SelectTrigger className="border-[#e4c9b0] focus:ring-[#f9b44c] bg-white">
                <SelectValue placeholder="Todas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TODAS}>Todas</SelectItem>
                {(opcionesTU?.unidades ?? ['unidad']).map((u) => (
                  <SelectItem key={u} value={u}>
                    {u}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {hayFiltrosActivos && (
          <div className="flex justify-end mt-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={limpiarFiltros}
              className="text-[#6f3a2a] hover:bg-[#fdfaf6] hover:text-[#391511] text-xs"
            >
              Limpiar filtros
            </Button>
          </div>
        )}
      </div>

      {/* Tabla */}
      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden shadow-sm">
        {isLoading ? (
          <div className="p-6">
            <SkeletonTabla filas={8} columnas={6} />
          </div>
        ) : isError ? (
          <div className="p-10 text-center text-[#c43e2c] text-sm">
            No se pudieron cargar los productos.
          </div>
        ) : !productos || productos.length === 0 ? (
          <div className="p-12 text-center">
            <div className="inline-flex p-3 rounded-full bg-[#f9d2a2]/40 mb-3">
              <Package className="h-6 w-6 text-[#6f3a2a]" />
            </div>
            <p className="text-[#391511] font-semibold">
              {hayFiltrosActivos
                ? 'Sin resultados'
                : 'No hay productos cargados'}
            </p>
            <p className="text-[#6f3a2a] text-sm mt-1">
              {hayFiltrosActivos
                ? 'Probá ajustando los filtros.'
                : 'Empezá agregando tu primer producto.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-b-[#e4c9b0]/60 bg-[#fdfaf6] hover:bg-[#fdfaf6]">
                  <TableHead className="text-[#391511] font-semibold">
                    Producto
                  </TableHead>
                  <TableHead className="text-[#391511] font-semibold">
                    Categoría
                  </TableHead>
                  <TableHead className="text-right text-[#391511] font-semibold">
                    Precio venta
                  </TableHead>
                  <TableHead className="text-right text-[#391511] font-semibold">
                    Precio costo
                  </TableHead>
                  <TableHead className="text-right text-[#391511] font-semibold">
                    Stock
                  </TableHead>
                  <TableHead className="text-center text-[#391511] font-semibold">
                    Estado
                  </TableHead>
                  <TableHead className="text-right w-28 text-[#391511] font-semibold">
                    Acciones
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {productosPagina.map((p) => {
                  const stockBajo = p.stock_actual < p.stock_minimo
                  return (
                    <TableRow
                      key={p.id}
                      className="border-b-[#e4c9b0]/40 hover:bg-[#fdfaf6]"
                    >
                      <TableCell>
                        <div className="flex flex-col leading-tight">
                          <span className="font-medium text-[#391511]">
                            {p.nombre}
                          </span>
                          {p.codigo_barras && (
                            <span className="text-[#c8a58a] text-xs font-mono mt-0.5">
                              {p.codigo_barras}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-[#6f3a2a] text-sm">
                        {p.categorias?.nombre ?? (
                          <span className="text-[#c8a58a] italic">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium text-[#391511]">
                        <MontoARS monto={p.precio_venta} />
                      </TableCell>
                      <TableCell className="text-right text-[#6f3a2a]">
                        <MontoARS monto={p.precio_costo} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <div className="inline-flex items-center gap-1.5">
                          {stockBajo && (
                            <AlertTriangle
                              className="h-3.5 w-3.5 text-[#c43e2c]"
                              aria-label="Stock por debajo del mínimo"
                            />
                          )}
                          <span
                            className={
                              stockBajo
                                ? 'text-[#c43e2c] font-semibold'
                                : 'text-[#391511]'
                            }
                          >
                            {p.stock_actual}
                          </span>
                          <span className="text-[#c8a58a] text-xs">
                            / {p.stock_minimo}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        {p.activo ? (
                          <Badge className="bg-[#f9b44c]/20 text-[#6f3a2a] hover:bg-[#f9b44c]/20 font-medium">
                            Activo
                          </Badge>
                        ) : (
                          <Badge className="bg-[#c8a58a]/30 text-[#6f3a2a] hover:bg-[#c8a58a]/30 font-medium">
                            Inactivo
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => abrirEdicion(p)}
                            title="Editar"
                            className="text-[#6f3a2a] hover:bg-[#f9d2a2]/40 hover:text-[#391511]"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleToggleActivo(p)}
                            disabled={toggleActivo.isPending}
                            title={p.activo ? 'Desactivar' : 'Activar'}
                            className="text-[#6f3a2a] hover:bg-[#f9d2a2]/40 hover:text-[#391511]"
                          >
                            {p.activo ? (
                              <PowerOff className="h-3.5 w-3.5" />
                            ) : (
                              <Power className="h-3.5 w-3.5" />
                            )}
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

      {productos && productos.length > 0 && (
        <PaginadorTabla
          total={productos.length}
          porPagina={porPagina}
          pagina={pagina}
          onCambioPorPagina={setPorPagina}
          onCambioPagina={setPagina}
        />
      )}

      <DrawerProducto
        abierto={drawerAbierto}
        onCambioAbierto={setDrawerAbierto}
        producto={productoEditar}
      />

      <ModalVencimientoMinimoMasivo
        abierto={modalVencMinAbierto}
        onCambioAbierto={setModalVencMinAbierto}
      />
    </div>
  )
}
