'use client'

// ╔══════════════════════════════════════════════════════════════════════╗
// ║  Centro de Compras — tabla de un proveedor                             ║
// ║                                                                        ║
// ║  Patrones heredados de TabReposicion: filas memoizadas, selección      ║
// ║  DISPERSA (arrancan marcados los que requieren compra y solo se        ║
// ║  guardan los desvíos), paginación client-side y handoff al editor      ║
// ║  único de órdenes (/pedidos/nuevo).                                    ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  ChevronLeft,
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
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  PaginadorTabla,
  paginarArreglo,
  type PorPagina,
} from '@/components/shared/PaginadorTabla'
import {
  generarCotizacionExcel,
  generarCotizacionPDF,
} from '@/lib/utils/cotizacion'
import { guardarHandoffReposicion } from '@/lib/compras/handoffReposicion'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { formatearMontoEntero, formatearNumero } from '@/lib/utils/formato'
import type { GrupoProveedor, SugerenciaFila } from './CentroCompras'
import { FilaSugerencia } from './FilaSugerencia'

const FILTROS_ESTADO: Record<string, string> = {
  todos: 'Todos',
  requiere: 'Requieren compra',
  sin_stock: 'Sin stock',
  cerca: 'Cerca del punto',
  sobrestock: 'Sobrestock',
  sin_ventas: 'Sin ventas 30d',
  transito: 'Con tránsito',
  criticos: 'Críticos',
}

const FILTROS_CLASE: Record<string, string> = {
  todas: 'ABC: todas',
  A: 'Clase A',
  B: 'Clase B',
  C: 'Clase C',
}

function pasaFiltroEstado(f: SugerenciaFila, filtro: string): boolean {
  switch (filtro) {
    case 'requiere':
      return f.requiere_compra
    case 'sin_stock':
      return f.stock_actual <= 0
    case 'cerca':
      return f.estado === 'naranja'
    case 'sobrestock':
      return f.es_sobrestock
    case 'sin_ventas':
      return f.estado === 'gris'
    case 'transito':
      return f.stock_en_transito > 0
    case 'criticos':
      return f.es_critico
    default:
      return true
  }
}

interface Props {
  grupo: GrupoProveedor
  onVolver: () => void
}

export function TablaSugerencias({ grupo, onVolver }: Props) {
  const router = useRouter()
  const { data: usuario } = useUsuario()
  // El editor de OC (/pedidos/nuevo) exige el permiso 'pedidos' en el
  // middleware: sin él, el push rebotaría al dashboard perdiendo la
  // selección. Con permisos aún sin cargar se da el beneficio de la duda
  // (mismo criterio que las tabs de PantallaCompras).
  const permisos = usuario?.permisos ?? []
  const puedeArmarOrden = permisos.length === 0 || permisos.includes('pedidos')
  const [busquedaInput, setBusquedaInput] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [filtroEstado, setFiltroEstado] = useState('todos')
  const [filtroClase, setFiltroClase] = useState('todas')
  const [pagina, setPagina] = useState(0)
  const [porPagina, setPorPagina] = useState<PorPagina>(50)
  // Selección dispersa: marcado = override ?? requiere_compra.
  const [overrides, setOverrides] = useState<Map<number, boolean>>(new Map())
  const [cantidades, setCantidades] = useState<Record<number, string>>({})

  useEffect(() => {
    const t = setTimeout(() => setBusqueda(busquedaInput), 250)
    return () => clearTimeout(t)
  }, [busquedaInput])

  useEffect(() => {
    setPagina(0)
  }, [busqueda, filtroEstado, filtroClase])

  const mostrarCostos = useMemo(
    () => grupo.filas.some((f) => f.precio_costo > 0),
    [grupo.filas]
  )

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return grupo.filas
      .filter((f) => {
        if (!pasaFiltroEstado(f, filtroEstado)) return false
        if (filtroClase !== 'todas' && f.clase_abc !== filtroClase) return false
        if (!q) return true
        return (
          f.nombre.toLowerCase().includes(q) ||
          (f.codigo_barras ?? '').includes(q)
        )
      })
      .sort(
        (a, b) =>
          a.urgencia - b.urgencia ||
          a.nombre.localeCompare(b.nombre, 'es-AR')
      )
  }, [grupo.filas, busqueda, filtroEstado, filtroClase])

  const paginaEfectiva =
    porPagina < 0
      ? 0
      : Math.min(
          pagina,
          Math.max(0, Math.ceil(filtrados.length / porPagina) - 1)
        )

  const visibles = useMemo(
    () => paginarArreglo(filtrados, paginaEfectiva, porPagina),
    [filtrados, paginaEfectiva, porPagina]
  )

  const marcado = useCallback(
    (f: SugerenciaFila) => overrides.get(f.producto_id) ?? f.requiere_compra,
    [overrides]
  )

  const toggle = useCallback(
    (id: number) => {
      setOverrides((prev) => {
        const m = new Map(prev)
        const fila = grupo.filas.find((f) => f.producto_id === id)
        const actual = m.get(id) ?? fila?.requiere_compra ?? false
        m.set(id, !actual)
        return m
      })
    },
    [grupo.filas]
  )

  const setCantidad = useCallback((id: number, valor: string) => {
    setCantidades((prev) => ({ ...prev, [id]: valor }))
  }, [])

  function marcarTodos(marcar: boolean) {
    setOverrides((prev) => {
      const m = new Map(prev)
      for (const f of filtrados) m.set(f.producto_id, marcar)
      return m
    })
  }

  // La selección abarca todo el listado del proveedor (no solo lo visible).
  const itemsSel = useMemo(
    () =>
      grupo.filas
        .map((f) => ({
          f,
          cantidad:
            Number(
              (
                cantidades[f.producto_id] ??
                String(f.cantidad_sugerida_redondeada)
              ).replace(',', '.')
            ) || 0,
        }))
        .filter(({ f, cantidad }) => marcado(f) && cantidad > 0),
    [grupo.filas, cantidades, marcado]
  )

  const totalSeleccion = useMemo(
    () =>
      itemsSel.reduce((s, { f, cantidad }) => s + cantidad * f.precio_costo, 0),
    [itemsSel]
  )

  const sinProveedor = grupo.proveedor_id === null
  const puedeGenerar = itemsSel.length > 0

  async function descargarExcel() {
    if (!puedeGenerar) return
    try {
      await generarCotizacionExcel(
        grupo.proveedor_nombre,
        itemsSel.map(({ f, cantidad }) => ({
          codigo: f.codigo_barras ?? '',
          nombre: f.nombre,
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
        grupo.proveedor_nombre,
        itemsSel.map(({ f, cantidad }) => ({
          codigo: f.codigo_barras ?? '',
          nombre: f.nombre,
          cantidad,
        }))
      )
    } catch {
      toast.error('No se pudo generar la cotización en PDF.')
    }
  }

  function armarOrden() {
    if (!puedeGenerar || grupo.proveedor_id == null) return
    guardarHandoffReposicion({
      proveedor_id: grupo.proveedor_id,
      items: itemsSel.map(({ f, cantidad }) => ({
        producto_id: f.producto_id,
        nombre: f.nombre,
        codigo_barras: f.codigo_barras,
        cantidad_pedida: cantidad,
        precio_costo: f.precio_costo,
        venta_por_peso: f.venta_por_peso,
      })),
    })
    router.push('/pedidos/nuevo')
  }

  return (
    <div className="space-y-4">
      {/* Encabezado del proveedor */}
      <div className="flex items-center gap-3 flex-wrap">
        <Button
          variant="outline"
          size="sm"
          onClick={onVolver}
          className="border-[#e4c9b0] text-[#6f3a2a] gap-1"
        >
          <ChevronLeft className="h-4 w-4" />
          Proveedores
        </Button>
        <div>
          <h2 className="text-[#391511] font-bold text-lg leading-tight">
            {grupo.proveedor_nombre}
          </h2>
          <p className="text-xs text-[#6f3a2a]">
            {formatearNumero(grupo.filas.length)} producto(s) ·{' '}
            {formatearNumero(grupo.necesitanCompra)} requieren compra
            {grupo.sinStock > 0 && (
              <span className="text-[#c43e2c] font-semibold">
                {' '}
                · {formatearNumero(grupo.sinStock)} sin stock
              </span>
            )}
          </p>
        </div>
      </div>

      {sinProveedor && (
        <div className="flex items-center gap-2 text-xs text-[#6f3a2a] bg-[#f9b44c]/15 rounded-lg px-3 py-2">
          <AlertTriangle className="h-3.5 w-3.5 text-[#f9b44c] shrink-0" />
          Estos productos no tienen proveedor asignado: asignales uno desde la
          ficha del producto para poder armarles una orden.
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3">
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
              className="w-[220px] pl-8 border-[#e4c9b0] bg-white"
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
            Estado
          </Label>
          <Select
            items={FILTROS_ESTADO}
            value={filtroEstado}
            onValueChange={(v) => setFiltroEstado(v ?? 'todos')}
          >
            <SelectTrigger className="w-[180px] border-[#e4c9b0] focus:ring-[#f9b44c] bg-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(FILTROS_ESTADO).map(([v, etiqueta]) => (
                <SelectItem key={v} value={v}>
                  {etiqueta}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
            Clase
          </Label>
          <Select
            items={FILTROS_CLASE}
            value={filtroClase}
            onValueChange={(v) => setFiltroClase(v ?? 'todas')}
          >
            <SelectTrigger className="w-[130px] border-[#e4c9b0] focus:ring-[#f9b44c] bg-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(FILTROS_CLASE).map(([v, etiqueta]) => (
                <SelectItem key={v} value={v}>
                  {etiqueta}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-sm text-[#6f3a2a] pb-2">
          <span className="font-semibold text-[#391511]">
            {formatearNumero(filtrados.length)}
          </span>{' '}
          producto(s)
        </p>
      </div>

      {/* Tabla */}
      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden shadow-sm">
        {filtrados.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-[#391511] font-semibold">Sin resultados</p>
            <p className="text-[#6f3a2a] text-sm mt-1">
              Ningún producto coincide con el filtro elegido.
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
              <span className="text-[#c8a58a]">
                (arrancan marcados los que requieren compra)
              </span>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-b-[#e4c9b0]/60 bg-[#fdfaf6] hover:bg-[#fdfaf6]">
                    <TableHead className="w-10" />
                    <TableHead className="text-[#391511] font-semibold">
                      Producto
                    </TableHead>
                    <TableHead
                      className="text-center text-[#391511] font-semibold"
                      title="Clase ABC por ingresos de los últimos 30 días"
                    >
                      ABC
                    </TableHead>
                    <TableHead className="text-right text-[#391511] font-semibold">
                      Stock
                    </TableHead>
                    <TableHead className="text-right text-[#391511] font-semibold">
                      Venta 30d
                    </TableHead>
                    <TableHead className="text-right text-[#391511] font-semibold">
                      /día
                    </TableHead>
                    <TableHead
                      className="text-right text-[#391511] font-semibold"
                      title="Cobertura actual: stock ÷ venta diaria"
                    >
                      Días stock
                    </TableHead>
                    <TableHead
                      className="text-right text-[#391511] font-semibold"
                      title="Pedido al proveedor y todavía no recibido"
                    >
                      En tránsito
                    </TableHead>
                    <TableHead
                      className="text-right text-[#391511] font-semibold"
                      title="Punto de reposición: venta diaria × (frecuencia + seguridad)"
                    >
                      Punto
                    </TableHead>
                    <TableHead
                      className="text-right text-[#391511] font-semibold"
                      title="Stock objetivo: venta diaria × días de cobertura objetivo"
                    >
                      Objetivo
                    </TableHead>
                    <TableHead className="text-right text-[#391511] font-semibold">
                      Sugerido
                    </TableHead>
                    <TableHead className="text-center text-[#391511] font-semibold">
                      Present.
                    </TableHead>
                    {mostrarCostos && (
                      <TableHead className="text-right text-[#391511] font-semibold">
                        Costo
                      </TableHead>
                    )}
                    <TableHead className="text-[#391511] font-semibold w-28">
                      Pedido final
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibles.map((f) => (
                    <FilaSugerencia
                      key={f.producto_id}
                      fila={f}
                      marcado={marcado(f)}
                      cantidad={
                        cantidades[f.producto_id] ??
                        String(f.cantidad_sugerida_redondeada)
                      }
                      mostrarCostos={mostrarCostos}
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

      {/* Acciones */}
      <div className="flex items-center justify-between gap-3 flex-wrap bg-white border border-[#e4c9b0]/60 rounded-2xl p-4 shadow-sm">
        <div className="text-sm text-[#6f3a2a]">
          <span className="font-extrabold text-[#391511]">
            {formatearNumero(itemsSel.length)}
          </span>{' '}
          producto(s) seleccionados
          {mostrarCostos && totalSeleccion > 0 && (
            <span>
              {' '}
              ·{' '}
              <span className="font-bold text-[#391511] tabular-nums">
                {formatearMontoEntero(totalSeleccion)}
              </span>
            </span>
          )}
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
            disabled={!puedeGenerar || sinProveedor || !puedeArmarOrden}
            title={
              !puedeArmarOrden
                ? 'Necesitás el permiso de Órdenes para crear la orden de compra.'
                : undefined
            }
            className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5 disabled:opacity-40"
          >
            <ShoppingBag className="h-4 w-4" />
            Armar orden de compra
          </Button>
        </div>
      </div>
    </div>
  )
}
