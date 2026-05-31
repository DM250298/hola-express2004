'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  FileSpreadsheet,
  FileText,
  Loader2,
  ShoppingBag,
} from 'lucide-react'
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
import { toast } from 'sonner'
import { useProductosAReponer } from '@/lib/hooks/useCompras'
import { useProveedores } from '@/lib/hooks/useProveedores'
import { useCrearPedido } from '@/lib/hooks/usePedidos'
import { useUsuario } from '@/lib/hooks/useUsuario'
import {
  generarCotizacionExcel,
  generarCotizacionPDF,
} from '@/lib/utils/cotizacion'
import { cn } from '@/lib/utils'

const TODOS = '__todos__'

interface FilaSel {
  seleccionado: boolean
  cantidad: string
}

export function TabReposicion() {
  const { data: usuario } = useUsuario()
  const { data: proveedores } = useProveedores()
  const [proveedorFiltro, setProveedorFiltro] = useState<string>(TODOS)
  const [seleccion, setSeleccion] = useState<Record<number, FilaSel>>({})

  const proveedorId = proveedorFiltro === TODOS ? null : Number(proveedorFiltro)
  const {
    data: productos,
    isLoading,
    isError,
  } = useProductosAReponer(proveedorId)
  const crearPedido = useCrearPedido()

  const itemsProveedor = useMemo(() => {
    const r: Record<string, string> = { [TODOS]: 'Todos los proveedores' }
    for (const p of proveedores ?? []) r[String(p.id)] = p.nombre
    return r
  }, [proveedores])

  useEffect(() => {
    if (!productos) return
    const inicial: Record<number, FilaSel> = {}
    for (const p of productos) {
      inicial[p.id] = {
        seleccionado: true,
        cantidad: String(p.cantidad_sugerida),
      }
    }
    setSeleccion(inicial)
  }, [productos])

  function toggle(id: number) {
    setSeleccion((prev) => ({
      ...prev,
      [id]: {
        seleccionado: !prev[id]?.seleccionado,
        cantidad: prev[id]?.cantidad ?? '1',
      },
    }))
  }

  function setCantidad(id: number, valor: string) {
    setSeleccion((prev) => ({
      ...prev,
      [id]: { seleccionado: prev[id]?.seleccionado ?? true, cantidad: valor },
    }))
  }

  const itemsSel = useMemo(
    () =>
      (productos ?? [])
        .map((p) => ({ p, cantidad: Number(seleccion[p.id]?.cantidad) || 0 }))
        .filter(
          ({ p, cantidad }) => seleccion[p.id]?.seleccionado && cantidad > 0
        ),
    [productos, seleccion]
  )

  const proveedorElegido = proveedorFiltro !== TODOS
  const nombreProveedor = itemsProveedor[proveedorFiltro] ?? 'Proveedor'
  const puedeGenerar = proveedorElegido && itemsSel.length > 0

  function descargarExcel() {
    if (!puedeGenerar) return
    generarCotizacionExcel(
      nombreProveedor,
      itemsSel.map(({ p, cantidad }) => ({
        codigo: p.codigo_barras ?? '',
        nombre: p.nombre,
        cantidad,
      }))
    )
  }

  function descargarPDF() {
    if (!puedeGenerar) return
    generarCotizacionPDF(
      nombreProveedor,
      itemsSel.map(({ p, cantidad }) => ({
        codigo: p.codigo_barras ?? '',
        nombre: p.nombre,
        cantidad,
      }))
    )
  }

  function crearBorrador() {
    if (!puedeGenerar || !usuario || proveedorId == null) return
    crearPedido.mutate(
      {
        proveedor_id: proveedorId,
        usuario_id: usuario.id,
        fecha_entrega_esperada: null,
        estado: 'borrador',
        items: itemsSel.map(({ p, cantidad }) => ({
          producto_id: p.id,
          cantidad_pedida: cantidad,
          precio_costo: p.precio_costo,
        })),
      },
      {
        onSuccess: () =>
          toast.success('Pedido borrador creado — revisalo en Órdenes'),
      }
    )
  }

  return (
    <div className="space-y-5">
      <p className="text-[#6f3a2a] text-sm">
        Productos por debajo del stock mínimo. Generá la cotización para el
        proveedor o un pedido borrador.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
            Proveedor
          </Label>
          <Select
            items={itemsProveedor}
            value={proveedorFiltro}
            onValueChange={(v) => setProveedorFiltro(v ?? TODOS)}
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
        <p className="text-sm text-[#6f3a2a] pb-2">
          <span className="font-semibold text-[#391511]">
            {productos?.length ?? 0}
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
        ) : (
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
                {productos.map((p) => {
                  const sel = seleccion[p.id]
                  const marcado = sel?.seleccionado ?? false
                  return (
                    <TableRow
                      key={p.id}
                      className={cn(
                        'border-b-[#e4c9b0]/40',
                        !marcado && 'opacity-50'
                      )}
                    >
                      <TableCell>
                        <input
                          type="checkbox"
                          checked={marcado}
                          onChange={() => toggle(p.id)}
                          className="accent-[#f9b44c] h-4 w-4"
                          aria-label={`Incluir ${p.nombre}`}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-[#391511] text-sm">
                          {p.nombre}
                        </div>
                        {p.codigo_barras && (
                          <div className="text-[#c8a58a] text-xs font-mono">
                            {p.codigo_barras}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-[#6f3a2a] text-sm">
                        {p.proveedor_nombre ?? (
                          <span className="text-[#c8a58a] italic">
                            Sin proveedor
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-bold text-[#c43e2c]">
                        {p.stock_actual}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-[#6f3a2a]">
                        {p.stock_minimo}
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min="0"
                          value={sel?.cantidad ?? ''}
                          onChange={(e) => setCantidad(p.id, e.target.value)}
                          className="h-8 w-24 text-center tabular-nums border-[#e4c9b0]"
                        />
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
              onClick={crearBorrador}
              disabled={!puedeGenerar || crearPedido.isPending}
              className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5 disabled:opacity-40"
            >
              {crearPedido.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ShoppingBag className="h-4 w-4" />
              )}
              Crear pedido borrador
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
