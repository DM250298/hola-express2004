'use client'

import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
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

export function TabStockInventario() {
  const [busquedaInput, setBusquedaInput] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [categoriaFiltro, setCategoriaFiltro] = useState<string>(TODAS_CAT)
  const [proveedorFiltro, setProveedorFiltro] = useState<string>(TODOS_PROV)
  const [ubicacionFiltro, setUbicacionFiltro] = useState<string>(TODAS_UBIC)
  const [estadoFiltro, setEstadoFiltro] = useState<EstadoStock | null>(null)
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
      solo_activos: true,
    }),
    [busqueda, categoriaFiltro, proveedorFiltro, ubicacionFiltro, estadoFiltro, orden]
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
    estadoFiltro !== null

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

      <div className="flex items-center justify-between text-sm">
        <p className="text-[#6f3a2a]">
          <span className="font-semibold text-[#391511]">
            {productos?.length ?? 0}
          </span>{' '}
          {productos?.length === 1 ? 'producto' : 'productos'}
          {hayFiltros && ' (filtrados)'}
        </p>
      </div>

      <TablaStock
        productos={productosPagina}
        isLoading={isLoading}
        isError={isError}
        orden={orden}
        onCambiarOrden={setOrden}
        hayFiltros={hayFiltros}
        idsPorVencer={idsPorVencer}
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
