'use client'

import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  FileSpreadsheet,
  FileText,
  Search,
  ShoppingBag,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import {
  PaginadorTabla,
  paginarArreglo,
  type PorPagina,
} from '@/components/shared/PaginadorTabla'
import { useProductosAReponer } from '@/lib/hooks/useCompras'
import { useProveedores } from '@/lib/hooks/useProveedores'
import {
  generarCotizacionExcel,
  generarCotizacionPDF,
} from '@/lib/utils/cotizacion'
import { guardarHandoffReposicion } from '@/lib/compras/handoffReposicion'
import { cn } from '@/lib/utils'

const TODOS = '__todos__'

// La lista puede tener miles de productos (catálogo entero bajo mínimo si el
// stock real no está cargado). La selección se guarda de forma DISPERSA:
// todo arranca marcado con la cantidad sugerida, y solo se registran los
// desvíos del usuario. Así no hay que armar un estado gigante por fila.
interface FilaReposicionProps {
  id: number
  nombre: string
  codigo_barras: string | null
  proveedor_nombre: string | null
  stock_actual: number
  stock_minimo: number
  marcado: boolean
  cantidad: string
  onToggle: (id: number) => void
  onCantidad: (id: number, valor: string) => void
}

// memo: al tocar un checkbox o tipear una cantidad solo se re-renderiza la
// fila afectada, no toda la tabla (con 3000+ filas congelaba el navegador).
const FilaReposicion = memo(function FilaReposicion({
  id,
  nombre,
  codigo_barras,
  proveedor_nombre,
  stock_actual,
  stock_minimo,
  marcado,
  cantidad,
  onToggle,
  onCantidad,
}: FilaReposicionProps) {
  return (
    <TableRow className={cn('border-b-[#e4c9b0]/40', !marcado && 'opacity-50')}>
      <TableCell>
        <input
          type="checkbox"
          checked={marcado}
          onChange={() => onToggle(id)}
          className="accent-[#f9b44c] h-4 w-4"
          aria-label={`Incluir ${nombre}`}
        />
      </TableCell>
      <TableCell>
        <div className="font-medium text-[#391511] text-sm">{nombre}</div>
        {codigo_barras && (
          <div className="text-[#c8a58a] text-xs font-mono">{codigo_barras}</div>
        )}
      </TableCell>
      <TableCell className="text-[#6f3a2a] text-sm">
        {proveedor_nombre ?? (
          <span className="text-[#c8a58a] italic">Sin proveedor</span>
        )}
      </TableCell>
      <TableCell className="text-right tabular-nums font-bold text-[#c43e2c]">
        {stock_actual}
      </TableCell>
      <TableCell className="text-right tabular-nums text-[#6f3a2a]">
        {stock_minimo}
      </TableCell>
      <TableCell>
        <Input
          type="number"
          min="0"
          value={cantidad}
          onChange={(e) => onCantidad(id, e.target.value)}
          className="h-8 w-24 text-center tabular-nums border-[#e4c9b0]"
        />
      </TableCell>
    </TableRow>
  )
})

export function TabReposicion() {
  const router = useRouter()
  const { data: proveedores } = useProveedores()
  const [proveedorFiltro, setProveedorFiltro] = useState<string>(TODOS)
  const [busquedaInput, setBusquedaInput] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [pagina, setPagina] = useState(0)
  const [porPagina, setPorPagina] = useState<PorPagina>(50)
  // Desvíos respecto del default (todo marcado, cantidad sugerida).
  const [desmarcados, setDesmarcados] = useState<Set<number>>(new Set())
  const [cantidades, setCantidades] = useState<Record<number, string>>({})

  useEffect(() => {
    const t = setTimeout(() => setBusqueda(busquedaInput), 250)
    return () => clearTimeout(t)
  }, [busquedaInput])

  const proveedorId = proveedorFiltro === TODOS ? null : Number(proveedorFiltro)
  const {
    data: productos,
    isLoading,
    isError,
  } = useProductosAReponer(proveedorId)

  const itemsProveedor = useMemo(() => {
    const r: Record<string, string> = { [TODOS]: 'Todos los proveedores' }
    for (const p of proveedores ?? []) r[String(p.id)] = p.nombre
    return r
  }, [proveedores])

  // Al cambiar de proveedor la lista es otra: se descartan los desvíos.
  function cambiarProveedor(v: string | null) {
    setProveedorFiltro(v ?? TODOS)
    setDesmarcados(new Set())
    setCantidades({})
    setPagina(0)
  }

  useEffect(() => {
    setPagina(0)
  }, [busqueda])

  const filtrados = useMemo(() => {
    if (!productos) return []
    const q = busqueda.trim().toLowerCase()
    if (!q) return productos
    return productos.filter(
      (p) =>
        p.nombre.toLowerCase().includes(q) ||
        (p.codigo_barras ?? '').includes(q)
    )
  }, [productos, busqueda])

  // Si la lista se achica (refetch, búsqueda) y la página quedó fuera de
  // rango, se recorta a la última página válida en vez de mostrar vacío.
  const paginaEfectiva =
    porPagina < 0
      ? 0
      : Math.min(pagina, Math.max(0, Math.ceil(filtrados.length / porPagina) - 1))

  const visibles = useMemo(
    () => paginarArreglo(filtrados, paginaEfectiva, porPagina),
    [filtrados, paginaEfectiva, porPagina]
  )

  const toggle = useCallback((id: number) => {
    setDesmarcados((prev) => {
      const s = new Set(prev)
      if (s.has(id)) s.delete(id)
      else s.add(id)
      return s
    })
  }, [])

  const setCantidad = useCallback((id: number, valor: string) => {
    setCantidades((prev) => ({ ...prev, [id]: valor }))
  }, [])

  function marcarTodos(marcar: boolean) {
    if (marcar) {
      setDesmarcados((prev) => {
        const s = new Set(prev)
        for (const p of filtrados) s.delete(p.id)
        return s
      })
    } else {
      setDesmarcados((prev) => {
        const s = new Set(prev)
        for (const p of filtrados) s.add(p.id)
        return s
      })
    }
  }

  // La selección abarca TODO el listado del proveedor (no solo la página
  // visible ni la búsqueda): igual que antes, todo arranca incluido.
  const itemsSel = useMemo(
    () =>
      (productos ?? [])
        .map((p) => ({
          p,
          cantidad:
            Number(cantidades[p.id] ?? String(p.cantidad_sugerida)) || 0,
        }))
        .filter(({ p, cantidad }) => !desmarcados.has(p.id) && cantidad > 0),
    [productos, desmarcados, cantidades]
  )

  const proveedorElegido = proveedorFiltro !== TODOS
  const nombreProveedor = itemsProveedor[proveedorFiltro] ?? 'Proveedor'
  const puedeGenerar = proveedorElegido && itemsSel.length > 0

  async function descargarExcel() {
    if (!puedeGenerar) return
    try {
      await generarCotizacionExcel(
        nombreProveedor,
        itemsSel.map(({ p, cantidad }) => ({
          codigo: p.codigo_barras ?? '',
          nombre: p.nombre,
          cantidad,
        }))
      )
    } catch {
      toast.error('No se pudo generar la cotización en Excel.')
    }
  }

  async function descargarPDF() {
    if (!puedeGenerar) return
    try {
      await generarCotizacionPDF(
        nombreProveedor,
        itemsSel.map(({ p, cantidad }) => ({
          codigo: p.codigo_barras ?? '',
          nombre: p.nombre,
          cantidad,
        }))
      )
    } catch {
      toast.error('No se pudo generar la cotización en PDF.')
    }
  }

  function armarOrden() {
    if (!puedeGenerar || proveedorId == null) return
    // Pasamos la selección al editor único de orden, donde el usuario revisa
    // costos y la crea/envía. Evita el rebote del borrador suelto.
    guardarHandoffReposicion({
      proveedor_id: proveedorId,
      items: itemsSel.map(({ p, cantidad }) => ({
        producto_id: p.id,
        nombre: p.nombre,
        codigo_barras: p.codigo_barras,
        cantidad_pedida: cantidad,
        precio_costo: p.precio_costo,
      })),
    })
    router.push('/pedidos/nuevo')
  }

  return (
    <div className="space-y-5">
      <p className="text-[#6f3a2a] text-sm">
        Productos por debajo del stock mínimo. Generá la cotización para el
        proveedor o armá la orden de compra.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
            Proveedor
          </Label>
          <Select
            items={itemsProveedor}
            value={proveedorFiltro}
            onValueChange={cambiarProveedor}
          >
            <SelectTrigger className="w-[240px] border-[#e4c9b0] focus:ring-[#f9b44c] bg-white">
              <SelectValue placeholder="Proveedor" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos los proveedores</SelectItem>
              {proveedores?.map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>
                  {p.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
            Buscar
          </Label>
          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#c8a58a]" />
            <Input
              value={busquedaInput}
              onChange={(e) => setBusquedaInput(e.target.value)}
              placeholder="Nombre o código de barras"
              className="w-[240px] pl-8 border-[#e4c9b0] bg-white"
            />
          </div>
        </div>
        <p className="text-sm text-[#6f3a2a] pb-2">
          <span className="font-semibold text-[#391511]">
            {filtrados.length}
          </span>{' '}
          producto(s) a reponer
        </p>
      </div>

      {!proveedorElegido && (productos?.length ?? 0) > 0 && (
        <div className="flex items-center gap-2 text-xs text-[#6f3a2a] bg-[#f9b44c]/15 rounded-lg px-3 py-2">
          <AlertTriangle className="h-3.5 w-3.5 text-[#f9b44c] shrink-0" />
          Elegí un proveedor para generar la cotización o el pedido borrador.
        </div>
      )}

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
              <ShoppingBag className="h-6 w-6 text-[#6f3a2a]" />
            </div>
            <p className="text-[#391511] font-semibold">
              No hay productos para reponer
            </p>
            <p className="text-[#6f3a2a] text-sm mt-1">
              Todo el stock está por encima del mínimo.
            </p>
          </div>
        ) : filtrados.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-[#391511] font-semibold">Sin resultados</p>
            <p className="text-[#6f3a2a] text-sm mt-1">
              Ningún producto coincide con «{busqueda}».
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 px-4 pt-3 text-xs">
              <button
                type="button"
                onClick={() => marcarTodos(true)}
                className="text-[#6f3a2a] underline underline-offset-2 hover:text-[#391511]"
              >
                Marcar todos
              </button>
              <button
                type="button"
                onClick={() => marcarTodos(false)}
                className="text-[#6f3a2a] underline underline-offset-2 hover:text-[#391511]"
              >
                Desmarcar todos
              </button>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-b-[#e4c9b0]/60 bg-[#fdfaf6] hover:bg-[#fdfaf6]">
                    <TableHead className="w-10" />
                    <TableHead className="text-[#391511] font-semibold">
                      Producto
                    </TableHead>
                    <TableHead className="text-[#391511] font-semibold">
                      Proveedor
                    </TableHead>
                    <TableHead className="text-right text-[#391511] font-semibold">
                      Stock
                    </TableHead>
                    <TableHead className="text-right text-[#391511] font-semibold">
                      Mínimo
                    </TableHead>
                    <TableHead className="text-[#391511] font-semibold w-32">
                      Cantidad a pedir
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibles.map((p) => (
                    <FilaReposicion
                      key={p.id}
                      id={p.id}
                      nombre={p.nombre}
                      codigo_barras={p.codigo_barras}
                      proveedor_nombre={p.proveedor_nombre}
                      stock_actual={p.stock_actual}
                      stock_minimo={p.stock_minimo}
                      marcado={!desmarcados.has(p.id)}
                      cantidad={
                        cantidades[p.id] ?? String(p.cantidad_sugerida)
                      }
                      onToggle={toggle}
                      onCantidad={setCantidad}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="px-4 py-3 border-t border-[#e4c9b0]/40">
              <PaginadorTabla
                total={filtrados.length}
                porPagina={porPagina}
                pagina={paginaEfectiva}
                onCambioPorPagina={setPorPagina}
                onCambioPagina={setPagina}
              />
            </div>
          </>
        )}
      </div>

      {productos && productos.length > 0 && (
        <div className="flex items-center justify-between gap-3 flex-wrap bg-white border border-[#e4c9b0]/60 rounded-2xl p-4 shadow-sm">
          <div className="text-sm text-[#6f3a2a]">
            <span className="font-extrabold text-[#391511]">
              {itemsSel.length}
            </span>{' '}
            producto(s) seleccionados para
            {proveedorElegido ? ` ${nombreProveedor}` : ' cotizar'}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={descargarExcel}
              disabled={!puedeGenerar}
              className="border-[#e4c9b0] text-[#6f3a2a] gap-1.5 disabled:opacity-40"
            >
              <FileSpreadsheet className="h-4 w-4" />
              Cotización Excel
            </Button>
            <Button
              variant="outline"
              onClick={descargarPDF}
              disabled={!puedeGenerar}
              className="border-[#e4c9b0] text-[#6f3a2a] gap-1.5 disabled:opacity-40"
            >
              <FileText className="h-4 w-4" />
              Cotización PDF
            </Button>
            <Button
              onClick={armarOrden}
              disabled={!puedeGenerar}
              className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5 disabled:opacity-40"
            >
              <ShoppingBag className="h-4 w-4" />
              Armar orden de compra
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
