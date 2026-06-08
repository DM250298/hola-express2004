'use client'

import { useMemo, useState } from 'react'
import { History, Loader2, Save, ScanLine, Trash2 } from 'lucide-react'
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
import { MontoARS } from '@/components/shared/MontoARS'
import { toast } from 'sonner'
import { useUsuario } from '@/lib/hooks/useUsuario'
import {
  useAjustesStock,
  useCrearAjusteStock,
} from '@/lib/hooks/useAjustesStock'
import { getProductoByBarcode } from '@/lib/queries/productos'
import {
  RAZONES_AJUSTE,
  calcularAjuste,
  etiquetaRazon,
  type ItemAjustePayload,
  type TipoAjuste,
} from '@/lib/queries/ajustesStock'
import { formatearFechaHora } from '@/lib/utils/formato'
import { cn } from '@/lib/utils'

interface LineaAjuste {
  uid: string
  producto_id: number
  nombre: string
  codigo_barras: string | null
  stock_actual: number
  precio_costo: number
  tipo: TipoAjuste
  cantidad: string
}

const RAZON_ITEMS: Record<string, string> = Object.fromEntries(
  RAZONES_AJUSTE.map((r) => [r.valor, r.etiqueta])
)
const TIPO_ITEMS: Record<TipoAjuste, string> = {
  entrada: 'Sumar (+)',
  salida: 'Restar (−)',
  ajuste: 'Establecer a',
}

function uid() {
  return Math.random().toString(36).slice(2, 9)
}

export function TabAjustes() {
  const { data: usuario } = useUsuario()
  const { data: historial, isLoading: cargandoHist } = useAjustesStock()
  const crear = useCrearAjusteStock()

  const [razon, setRazon] = useState('merma')
  const [razonDetalle, setRazonDetalle] = useState('')
  const [codigo, setCodigo] = useState('')
  const [buscando, setBuscando] = useState(false)
  const [lineas, setLineas] = useState<LineaAjuste[]>([])

  function agregarProducto(p: {
    id: number
    nombre: string
    codigo_barras: string | null
    stock_actual: number
    precio_costo: number
  }) {
    setLineas((prev) => {
      const existe = prev.find((l) => l.producto_id === p.id)
      if (existe) {
        return prev.map((l) =>
          l.producto_id === p.id && l.tipo !== 'ajuste'
            ? { ...l, cantidad: String((Number(l.cantidad) || 0) + 1) }
            : l
        )
      }
      return [
        ...prev,
        {
          uid: uid(),
          producto_id: p.id,
          nombre: p.nombre,
          codigo_barras: p.codigo_barras,
          stock_actual: p.stock_actual,
          precio_costo: p.precio_costo,
          tipo: 'salida',
          cantidad: '1',
        },
      ]
    })
  }

  async function buscarYAgregar() {
    const cod = codigo.trim()
    if (!cod || buscando) return
    setBuscando(true)
    try {
      const prod = await getProductoByBarcode(cod)
      if (!prod) {
        toast.error(`No se encontró ningún producto con el código ${cod}`)
        return
      }
      agregarProducto({
        id: prod.id,
        nombre: prod.nombre,
        codigo_barras: prod.codigo_barras,
        stock_actual: prod.stock_actual,
        precio_costo: prod.precio_costo,
      })
      setCodigo('')
    } catch {
      toast.error('Error al buscar el producto')
    } finally {
      setBuscando(false)
    }
  }

  function cambiarLinea(uidL: string, patch: Partial<LineaAjuste>) {
    setLineas((prev) =>
      prev.map((l) => (l.uid === uidL ? { ...l, ...patch } : l))
    )
  }

  function quitarLinea(uidL: string) {
    setLineas((prev) => prev.filter((l) => l.uid !== uidL))
  }

  const totalCosto = useMemo(
    () =>
      lineas.reduce((acc, l) => {
        const { subtotal } = calcularAjuste({
          tipo: l.tipo,
          cantidad: Number(l.cantidad) || 0,
          stock_actual: l.stock_actual,
          precio_costo: l.precio_costo,
        })
        return acc + subtotal
      }, 0),
    [lineas]
  )

  const hayLineasInvalidas = lineas.some((l) => {
    const cant = Number(l.cantidad)
    if (!Number.isFinite(cant) || cant < 0) return true
    if (l.tipo !== 'ajuste' && cant <= 0) return true
    const { stockFinal } = calcularAjuste({
      tipo: l.tipo,
      cantidad: cant || 0,
      stock_actual: l.stock_actual,
      precio_costo: l.precio_costo,
    })
    return stockFinal < 0
  })

  const puedeGuardar =
    lineas.length > 0 && !hayLineasInvalidas && !crear.isPending && !!usuario

  function guardar() {
    if (!puedeGuardar || !usuario) return
    const items: ItemAjustePayload[] = lineas.map((l) => ({
      producto_id: l.producto_id,
      nombre: l.nombre,
      tipo: l.tipo,
      cantidad: Number(l.cantidad) || 0,
      stock_actual: l.stock_actual,
      precio_costo: l.precio_costo,
    }))
    crear.mutate(
      {
        usuario_id: usuario.id,
        razon,
        razon_detalle: razonDetalle.trim() || null,
        items,
      },
      {
        onSuccess: () => {
          setLineas([])
          setRazonDetalle('')
        },
      }
    )
  }

  return (
    <div className="space-y-5">
      {/* Formulario de ajuste */}
      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-5 shadow-sm space-y-4">
        <div>
          <h2 className="text-[#391511] font-bold text-lg">
            Nuevo ajuste de stock
          </h2>
          <p className="text-[#6f3a2a] text-sm">
            Escaneá los productos con el lector de código de barras y registralos.
          </p>
        </div>

        {/* Cabecera: razón */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
              Razón
            </Label>
            <Select
              items={RAZON_ITEMS}
              value={razon}
              onValueChange={(v) => setRazon(v ?? 'merma')}
            >
              <SelectTrigger className="w-full border-[#e4c9b0] focus:ring-[#f9b44c] bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RAZONES_AJUSTE.map((r) => (
                  <SelectItem key={r.valor} value={r.valor}>
                    {r.etiqueta}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
              Razón en detalle (opcional)
            </Label>
            <Input
              value={razonDetalle}
              onChange={(e) => setRazonDetalle(e.target.value)}
              placeholder="Ej: caja golpeada en depósito"
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c] bg-white"
            />
          </div>
        </div>

        {/* Buscador por código de barras */}
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
            Escanear / código de barras
          </Label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <ScanLine className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#c8a58a]" />
              <Input
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    buscarYAgregar()
                  }
                }}
                placeholder="Escaneá el código y se agrega solo…"
                autoFocus
                className="pl-9 border-[#e4c9b0] focus-visible:ring-[#f9b44c] bg-white"
              />
            </div>
            <Button
              onClick={buscarYAgregar}
              disabled={buscando || !codigo.trim()}
              className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold"
            >
              {buscando ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                'Agregar'
              )}
            </Button>
          </div>
        </div>

        {/* Tabla de líneas */}
        <div className="rounded-xl border border-[#e4c9b0]/60 overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-b-[#e4c9b0]/60 bg-[#fdfaf6] hover:bg-[#fdfaf6]">
                  <TableHead className="text-[#391511] font-semibold">
                    Producto
                  </TableHead>
                  <TableHead className="text-[#391511] font-semibold w-40">
                    Tipo de ajuste
                  </TableHead>
                  <TableHead className="text-[#391511] font-semibold w-28">
                    Cantidad
                  </TableHead>
                  <TableHead className="text-right text-[#391511] font-semibold w-24">
                    Stock final
                  </TableHead>
                  <TableHead className="text-right text-[#391511] font-semibold w-32">
                    Subtotal
                  </TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lineas.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-center text-[#6f3a2a] text-sm py-8"
                    >
                      Escaneá un producto para empezar el ajuste.
                    </TableCell>
                  </TableRow>
                ) : (
                  lineas.map((l) => {
                    const cant = Number(l.cantidad) || 0
                    const { stockFinal, subtotal } = calcularAjuste({
                      tipo: l.tipo,
                      cantidad: cant,
                      stock_actual: l.stock_actual,
                      precio_costo: l.precio_costo,
                    })
                    const negativo = stockFinal < 0
                    return (
                      <TableRow
                        key={l.uid}
                        className="border-b-[#e4c9b0]/40"
                      >
                        <TableCell>
                          <div className="font-medium text-[#391511] text-sm">
                            {l.nombre}
                          </div>
                          <div className="text-[#c8a58a] text-xs">
                            {l.codigo_barras ?? '—'} · stock {l.stock_actual}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Select
                            items={TIPO_ITEMS}
                            value={l.tipo}
                            onValueChange={(v) =>
                              cambiarLinea(l.uid, {
                                tipo: (v ?? 'salida') as TipoAjuste,
                              })
                            }
                          >
                            <SelectTrigger className="h-8 w-full border-[#e4c9b0] focus:ring-[#f9b44c] bg-white text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="entrada">
                                Sumar (+)
                              </SelectItem>
                              <SelectItem value="salida">Restar (−)</SelectItem>
                              <SelectItem value="ajuste">
                                Establecer a
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min="0"
                            value={l.cantidad}
                            onChange={(e) =>
                              cambiarLinea(l.uid, { cantidad: e.target.value })
                            }
                            className="h-8 w-20 text-center tabular-nums border-[#e4c9b0]"
                          />
                        </TableCell>
                        <TableCell
                          className={cn(
                            'text-right tabular-nums font-bold',
                            negativo ? 'text-[#c43e2c]' : 'text-[#391511]'
                          )}
                        >
                          {stockFinal}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-[#6f3a2a]">
                          <MontoARS monto={subtotal} />
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => quitarLinea(l.uid)}
                            className="h-7 w-7 p-0 text-[#c8a58a] hover:text-[#c43e2c]"
                            aria-label="Quitar"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm text-[#6f3a2a]">
            Valorización del ajuste:{' '}
            <span className="font-extrabold text-[#391511] tabular-nums">
              <MontoARS monto={totalCosto} />
            </span>
          </div>
          <Button
            onClick={guardar}
            disabled={!puedeGuardar}
            className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-extrabold gap-1.5 disabled:opacity-50"
          >
            {crear.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Guardar ajuste
          </Button>
        </div>
        {hayLineasInvalidas && lineas.length > 0 && (
          <p className="text-xs text-[#c43e2c]">
            Revisá las cantidades: hay una línea con valor inválido o que deja
            stock negativo.
          </p>
        )}
      </div>

      {/* Historial de ajustes */}
      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <History className="h-4 w-4 text-[#f9b44c]" />
          <h3 className="text-[#391511] font-bold">Ajustes recientes</h3>
        </div>
        {cargandoHist ? (
          <p className="text-sm text-[#6f3a2a]">Cargando…</p>
        ) : !historial || historial.length === 0 ? (
          <p className="text-sm text-[#6f3a2a]">
            Todavía no se registraron ajustes de stock.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-b-[#e4c9b0]/60 bg-[#fdfaf6] hover:bg-[#fdfaf6]">
                  <TableHead className="text-[#391511] font-semibold w-16">
                    #
                  </TableHead>
                  <TableHead className="text-[#391511] font-semibold">
                    Fecha
                  </TableHead>
                  <TableHead className="text-[#391511] font-semibold">
                    Usuario
                  </TableHead>
                  <TableHead className="text-[#391511] font-semibold">
                    Razón
                  </TableHead>
                  <TableHead className="text-right text-[#391511] font-semibold">
                    Items
                  </TableHead>
                  <TableHead className="text-right text-[#391511] font-semibold">
                    Valorización
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {historial.map((a) => (
                  <TableRow key={a.id} className="border-b-[#e4c9b0]/40">
                    <TableCell className="font-mono text-xs text-[#6f3a2a]">
                      #{a.id}
                    </TableCell>
                    <TableCell className="text-xs text-[#6f3a2a] tabular-nums whitespace-nowrap">
                      {formatearFechaHora(a.fecha)}
                    </TableCell>
                    <TableCell className="text-sm text-[#391511]">
                      {a.usuario_nombre ?? '—'}
                    </TableCell>
                    <TableCell className="text-sm text-[#6f3a2a]">
                      {etiquetaRazon(a.razon)}
                      {a.razon_detalle && (
                        <span className="text-[#c8a58a]">
                          {' '}
                          · {a.razon_detalle}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-[#6f3a2a]">
                      {a.cantidad_items}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-semibold text-[#391511]">
                      <MontoARS monto={a.total_costo} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  )
}
