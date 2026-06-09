'use client'

import { useEffect, useMemo, useState } from 'react'
import { FileText, Loader2, Plus, Search, Trash2 } from 'lucide-react'
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
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { MontoARS } from '@/components/shared/MontoARS'
import { GaleriaComprobantes } from '@/components/compras/GaleriaComprobantes'
import { usePedidoDetalle } from '@/lib/hooks/usePedidos'
import { useProductos } from '@/lib/hooks/useProductos'
import { useProveedores } from '@/lib/hooks/useProveedores'
import { useUsuario } from '@/lib/hooks/useUsuario'
import {
  useFacturaCompra,
  useGuardarFacturaCompra,
} from '@/lib/hooks/useFacturasCompra'
import { calcularLinea } from '@/lib/queries/facturasCompra'
import type { CuentaAPagarConProveedor } from '@/lib/queries/finanzas'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  cuenta: CuentaAPagarConProveedor | null
}

interface LineaFactura {
  /** Clave única en el modal (un producto no se repite). */
  key: string
  /** id del item del pedido, o null si es un producto extra (no pedido). */
  item_pedido_id: number | null
  producto_id: number
  nombre: string
  codigo_barras: string | null
  cantidad: string
  costo: string
  descuento: string
  iva_compra: string
  margen: string
  iva_venta: string
}

type CampoEditable =
  | 'cantidad'
  | 'costo'
  | 'descuento'
  | 'iva_compra'
  | 'margen'
  | 'iva_venta'

const DEFAULTS = {
  descuento: '0',
  iva_compra: '21',
  margen: '30',
  iva_venta: '21',
} as const

interface CabeceraState {
  tipo_comprobante: string
  punto_venta: string
  numero_comprobante: string
  cae: string
  cuit_proveedor: string
  fecha_emision: string
}

function hoyIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const CABECERA_DEFAULT: CabeceraState = {
  tipo_comprobante: 'A',
  punto_venta: '',
  numero_comprobante: '',
  cae: '',
  cuit_proveedor: '',
  fecha_emision: hoyIso(),
}

const TIPOS_COMPROBANTE = [
  { valor: 'A', etiqueta: 'Factura A' },
  { valor: 'B', etiqueta: 'Factura B' },
  { valor: 'C', etiqueta: 'Factura C' },
  { valor: 'M', etiqueta: 'Factura M' },
  { valor: 'E', etiqueta: 'Factura E (export.)' },
]

export function ModalEditarFactura({ abierto, onCambioAbierto, cuenta }: Props) {
  const { data: usuario } = useUsuario()
  const { data: pedido, isLoading: cargandoPedido } = usePedidoDetalle(
    cuenta?.pedido_id
  )
  const { data: facturaGuardada, isLoading: cargandoFactura } =
    useFacturaCompra(cuenta?.id ?? null)
  const guardar = useGuardarFacturaCompra()

  const [afectaVenta, setAfectaVenta] = useState(true)
  const [lineas, setLineas] = useState<LineaFactura[]>([])
  const [cab, setCab] = useState<CabeceraState>(CABECERA_DEFAULT)
  const [busqueda, setBusqueda] = useState('')
  // Percepciones sufridas (las que el proveedor carga en la factura).
  const [percepciones, setPercepciones] = useState({
    iibb: '',
    iva: '',
    otros: '',
  })

  const { data: productosBusqueda } = useProductos({
    activo: true,
    busqueda: busqueda || undefined,
  })

  // Proveedor de la cuenta → para autocompletar su CUIT en el comprobante.
  const { data: proveedores } = useProveedores()
  const proveedorCuenta = proveedores?.find(
    (p) => p.id === cuenta?.proveedor_id
  )

  function setCabCampo(campo: keyof CabeceraState, valor: string) {
    setCab((prev) => ({ ...prev, [campo]: valor }))
  }

  const items = useMemo(() => pedido?.items ?? [], [pedido])
  const cargando = cargandoPedido || cargandoFactura

  // Inicializar líneas:
  //  · Con factura guardada → reconstruir lo que se había facturado.
  //  · Sin factura → SOLO los productos efectivamente recibidos (lo que el
  //    proveedor entregó); el resto se agrega a mano con el buscador.
  useEffect(() => {
    if (!abierto || cargando) return
    let nuevas: LineaFactura[]
    if (facturaGuardada && facturaGuardada.items.length > 0) {
      nuevas = facturaGuardada.items.map((g) => {
        const it = items.find((i) => i.producto_id === g.producto_id)
        return {
          key: `prod-${g.producto_id}`,
          item_pedido_id: it?.id ?? null,
          producto_id: g.producto_id,
          nombre: it?.producto?.nombre ?? `Producto #${g.producto_id}`,
          codigo_barras: it?.producto?.codigo_barras ?? null,
          cantidad: String(g.cantidad),
          costo: String(g.costo_sin_iva),
          descuento: String(g.descuento_porcentaje),
          iva_compra: String(g.iva_compra_porcentaje),
          margen: String(g.margen_porcentaje),
          iva_venta: String(g.iva_venta_porcentaje),
        }
      })
    } else {
      nuevas = items
        .filter((it) => (it.cantidad_recibida ?? 0) > 0)
        .map((it) => ({
          key: `prod-${it.producto_id}`,
          item_pedido_id: it.id,
          producto_id: it.producto_id,
          nombre: it.producto?.nombre ?? 'Producto eliminado',
          codigo_barras: it.producto?.codigo_barras ?? null,
          cantidad: String(it.cantidad_recibida ?? 0),
          costo: String(it.precio_costo || 0),
          ...DEFAULTS,
        }))
    }
    setLineas(nuevas)
    setBusqueda('')
    if (facturaGuardada) {
      setAfectaVenta(facturaGuardada.factura.afecta_precio_venta)
      const f = facturaGuardada.factura
      setCab({
        tipo_comprobante: f.tipo_comprobante ?? 'A',
        punto_venta: f.punto_venta ?? '',
        numero_comprobante: f.numero_comprobante ?? '',
        cae: f.cae ?? '',
        cuit_proveedor: f.cuit_proveedor || proveedorCuenta?.cuit || '',
        fecha_emision: f.fecha ?? hoyIso(),
      })
      setPercepciones({
        iibb: f.percepcion_iibb ? String(f.percepcion_iibb) : '',
        iva: f.percepcion_iva ? String(f.percepcion_iva) : '',
        otros: f.percepcion_otros ? String(f.percepcion_otros) : '',
      })
    } else {
      setCab({
        ...CABECERA_DEFAULT,
        cuit_proveedor: proveedorCuenta?.cuit ?? '',
      })
      setPercepciones({ iibb: '', iva: '', otros: '' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, cargando, facturaGuardada, proveedorCuenta?.cuit])

  function setLineaCampo(key: string, campo: CampoEditable, valor: string) {
    setLineas((prev) =>
      prev.map((l) => (l.key === key ? { ...l, [campo]: valor } : l))
    )
  }

  function quitarLinea(key: string) {
    setLineas((prev) => prev.filter((l) => l.key !== key))
  }

  function agregarProducto(p: {
    id: number
    nombre: string
    codigo_barras: string | null
    precio_costo?: number | null
  }) {
    if (lineas.some((l) => l.producto_id === p.id)) {
      toast.info('Ese producto ya está en la factura.')
      setBusqueda('')
      return
    }
    const it = items.find((i) => i.producto_id === p.id)
    setLineas((prev) => [
      ...prev,
      {
        key: `prod-${p.id}`,
        item_pedido_id: it?.id ?? null,
        producto_id: p.id,
        nombre: p.nombre,
        codigo_barras: p.codigo_barras ?? null,
        cantidad: it?.cantidad_recibida ? String(it.cantidad_recibida) : '1',
        costo: String((it?.precio_costo ?? p.precio_costo ?? 0) || 0),
        ...DEFAULTS,
      },
    ])
    setBusqueda('')
  }

  // Productos del buscador que todavía no están en la factura (máx 6).
  const resultados = useMemo(() => {
    if (!busqueda.trim() || !productosBusqueda) return []
    const enFactura = new Set(lineas.map((l) => l.producto_id))
    return productosBusqueda.filter((p) => !enFactura.has(p.id)).slice(0, 6)
  }, [busqueda, productosBusqueda, lineas])

  // Cálculo por línea
  const calculadas = lineas.map((l) => {
    const cantidad = Number(l.cantidad) || 0
    const calc = calcularLinea({
      costo_sin_iva: Number(l.costo) || 0,
      descuento_porcentaje: Number(l.descuento) || 0,
      iva_compra_porcentaje: Number(l.iva_compra) || 0,
      margen_porcentaje: Number(l.margen) || 0,
      iva_venta_porcentaje: Number(l.iva_venta) || 0,
    })
    return { l, calc, cantidad }
  })

  const totales = calculadas.reduce(
    (acc, { calc, cantidad }) => {
      acc.neto += calc.costoNeto * cantidad
      acc.iva += (calc.costoConIva - calc.costoNeto) * cantidad
      return acc
    },
    { neto: 0, iva: 0 }
  )
  const percIibb = Number(percepciones.iibb) || 0
  const percIva = Number(percepciones.iva) || 0
  const percOtros = Number(percepciones.otros) || 0
  const totalPercepciones = percIibb + percIva + percOtros
  const totalConIva = totales.neto + totales.iva + totalPercepciones

  function handleGuardar() {
    if (!pedido || !cuenta || !usuario || guardar.isPending) return
    if (lineas.length === 0) return
    const limpio = (s: string) => {
      const t = s.trim()
      return t === '' ? null : t
    }
    guardar.mutate(
      {
        cuenta_id: cuenta.id,
        pedido_id: pedido.id,
        proveedor_id: cuenta.proveedor_id,
        fecha: cab.fecha_emision || hoyIso(),
        afecta_precio_venta: afectaVenta,
        usuario_id: usuario.id,
        percepciones: { iva: percIva, iibb: percIibb, otros: percOtros },
        comprobante: {
          tipo_comprobante: cab.tipo_comprobante || null,
          punto_venta: limpio(cab.punto_venta),
          numero_comprobante: limpio(cab.numero_comprobante),
          cae: limpio(cab.cae),
          cuit_proveedor: limpio(cab.cuit_proveedor),
        },
        lineas: calculadas.map(({ l, cantidad }) => ({
          item_pedido_id: l.item_pedido_id,
          producto_id: l.producto_id,
          cantidad,
          costo_sin_iva: Number(l.costo) || 0,
          descuento_porcentaje: Number(l.descuento) || 0,
          iva_compra_porcentaje: Number(l.iva_compra) || 0,
          margen_porcentaje: Number(l.margen) || 0,
          iva_venta_porcentaje: Number(l.iva_venta) || 0,
        })),
      },
      { onSuccess: () => onCambioAbierto(false) }
    )
  }

  const inputCls =
    'h-8 w-full text-right tabular-nums border-[#e4c9b0] text-xs px-1.5'

  return (
    <Dialog
      open={abierto}
      onOpenChange={(v) => !guardar.isPending && onCambioAbierto(v)}
    >
      <DialogContent className="sm:max-w-6xl p-0 gap-0 overflow-hidden max-h-[92vh] flex flex-col">
        <DialogHeader className="px-6 py-4 border-b border-[#e4c9b0]/60 bg-[#fdfaf6] shrink-0">
          <DialogTitle className="text-[#391511] text-lg flex items-center gap-2">
            <FileText className="h-5 w-5 text-[#f9b44c]" />
            Cargar factura{cuenta ? ` · Pedido #${cuenta.pedido_id}` : ''}
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            Vienen cargados los productos recibidos. Quitá los que la factura no
            traiga y agregá los que falten. El costo guardado es el neto (sin
            IVA).
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-auto px-6 py-5 space-y-4">
          {/* Cabecera */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-sm text-[#6f3a2a]">
              Proveedor:{' '}
              <span className="font-semibold text-[#391511]">
                {cuenta?.proveedor_nombre ?? 'Sin asignar'}
              </span>
            </div>
            <label className="flex items-center gap-2 text-sm text-[#391511]">
              <Switch checked={afectaVenta} onCheckedChange={setAfectaVenta} />
              Afectar precio de venta
            </label>
          </div>

          {/* Comprobante escaneado en la recepción (se puede agregar más acá) */}
          <GaleriaComprobantes
            pedidoId={cuenta?.pedido_id}
            usuarioId={usuario?.id ?? null}
          />

          {/* Datos formales del comprobante */}
          <div className="rounded-xl border border-[#e4c9b0]/60 bg-[#fdfaf6] p-3">
            <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold mb-2">
              Datos del comprobante (para libro IVA)
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
              <div className="space-y-1">
                <Label className="text-[10px] text-[#6f3a2a]">Tipo</Label>
                <Select
                  value={cab.tipo_comprobante}
                  onValueChange={(v) =>
                    setCabCampo('tipo_comprobante', v ?? 'A')
                  }
                >
                  <SelectTrigger className="h-8 border-[#e4c9b0] bg-white text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIPOS_COMPROBANTE.map((t) => (
                      <SelectItem key={t.valor} value={t.valor}>
                        {t.etiqueta}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-[#6f3a2a]">Pto. venta</Label>
                <Input
                  inputMode="numeric"
                  placeholder="0001"
                  value={cab.punto_venta}
                  onChange={(e) => setCabCampo('punto_venta', e.target.value)}
                  className="h-8 border-[#e4c9b0] bg-white text-xs tabular-nums"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-[#6f3a2a]">Número</Label>
                <Input
                  inputMode="numeric"
                  placeholder="00001234"
                  value={cab.numero_comprobante}
                  onChange={(e) =>
                    setCabCampo('numero_comprobante', e.target.value)
                  }
                  className="h-8 border-[#e4c9b0] bg-white text-xs tabular-nums"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-[#6f3a2a]">
                  CUIT proveedor
                </Label>
                <Input
                  inputMode="numeric"
                  placeholder="30-xxxxxxxx-x"
                  value={cab.cuit_proveedor}
                  onChange={(e) =>
                    setCabCampo('cuit_proveedor', e.target.value)
                  }
                  className="h-8 border-[#e4c9b0] bg-white text-xs tabular-nums"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-[#6f3a2a]">
                  Fecha emisión
                </Label>
                <Input
                  type="date"
                  value={cab.fecha_emision}
                  max={hoyIso()}
                  onChange={(e) => setCabCampo('fecha_emision', e.target.value)}
                  className="h-8 border-[#e4c9b0] bg-white text-xs tabular-nums"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-[#6f3a2a]">CAE</Label>
                <Input
                  inputMode="numeric"
                  placeholder="Opcional"
                  value={cab.cae}
                  onChange={(e) => setCabCampo('cae', e.target.value)}
                  className="h-8 border-[#e4c9b0] bg-white text-xs tabular-nums"
                />
              </div>
            </div>
          </div>

          {/* Buscador para agregar un producto a la factura */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#c8a58a]" />
            <Input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Agregar un producto a la factura (del pedido o uno extra)…"
              className="pl-9 border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
            />
            {busqueda && resultados.length > 0 && (
              <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-[#e4c9b0] rounded-xl shadow-lg max-h-64 overflow-y-auto">
                {resultados.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => agregarProducto(p)}
                    className="w-full px-3 py-2 flex items-center justify-between gap-2 hover:bg-[#fdfaf6] text-left border-b border-[#e4c9b0]/40 last:border-b-0"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-[#391511] text-sm truncate">
                        {p.nombre}
                      </div>
                      {p.codigo_barras && (
                        <div className="text-xs text-[#c8a58a] font-mono">
                          {p.codigo_barras}
                        </div>
                      )}
                    </div>
                    <Plus className="h-4 w-4 text-[#f9b44c] shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {cargando || !pedido ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-10 rounded-lg bg-[#f9d2a2]/30" />
              ))}
            </div>
          ) : lineas.length === 0 ? (
            <p className="text-sm text-[#6f3a2a] py-6 text-center">
              No hay productos en la factura. Usá el buscador de arriba para
              agregar lo que trae el comprobante.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-[#e4c9b0]/60">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-[#391511] text-[#f9d2a2]">
                    <th className="p-2 text-left" rowSpan={2}>
                      Producto
                    </th>
                    <th className="p-2" rowSpan={2}>
                      Cant.
                    </th>
                    <th className="p-2 text-center bg-[#6f3a2a]" colSpan={5}>
                      COMPRA
                    </th>
                    <th className="p-2 text-center bg-[#c43e2c]" colSpan={4}>
                      VENTA
                    </th>
                  </tr>
                  <tr className="bg-[#391511] text-[#f9d2a2]">
                    <th className="p-1.5 font-medium">Costo s/IVA</th>
                    <th className="p-1.5 font-medium">Desc. %</th>
                    <th className="p-1.5 font-medium">Subtotal</th>
                    <th className="p-1.5 font-medium">IVA %</th>
                    <th className="p-1.5 font-medium">Costo c/IVA</th>
                    <th className="p-1.5 font-medium">Margen %</th>
                    <th className="p-1.5 font-medium">Precio s/IVA</th>
                    <th className="p-1.5 font-medium">IVA %</th>
                    <th className="p-1.5 font-medium">Precio c/IVA</th>
                  </tr>
                </thead>
                <tbody>
                  {calculadas.map(({ l, calc, cantidad }) => (
                    <tr
                      key={l.key}
                      className="border-b border-[#e4c9b0]/40 bg-white"
                    >
                      <td className="p-2 text-[#391511] font-medium min-w-[180px]">
                        <div className="flex items-start gap-2">
                          <button
                            type="button"
                            onClick={() => quitarLinea(l.key)}
                            title="Quitar de la factura"
                            className="mt-0.5 shrink-0 text-[#c8a58a] transition-colors hover:text-[#c43e2c]"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                          <div className="min-w-0">
                            {l.nombre}
                            {l.codigo_barras && (
                              <span className="block text-[#c8a58a] font-mono text-[10px]">
                                {l.codigo_barras}
                              </span>
                            )}
                            {l.item_pedido_id === null && (
                              <span className="block text-[10px] font-semibold text-[#9e6b15]">
                                Extra (no pedido)
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="p-1 w-16">
                        <Input
                          type="number"
                          min="0"
                          step="1"
                          value={l.cantidad}
                          onChange={(ev) =>
                            setLineaCampo(l.key, 'cantidad', ev.target.value)
                          }
                          className={inputCls}
                        />
                      </td>
                      <td className="p-1 w-24">
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={l.costo}
                          onChange={(ev) =>
                            setLineaCampo(l.key, 'costo', ev.target.value)
                          }
                          className={inputCls}
                        />
                      </td>
                      <td className="p-1 w-16">
                        <Input
                          type="number"
                          min="0"
                          value={l.descuento}
                          onChange={(ev) =>
                            setLineaCampo(l.key, 'descuento', ev.target.value)
                          }
                          className={inputCls}
                        />
                      </td>
                      <td className="p-2 text-right tabular-nums text-[#6f3a2a]">
                        <MontoARS monto={calc.costoNeto * cantidad} />
                      </td>
                      <td className="p-1 w-16">
                        <Input
                          type="number"
                          min="0"
                          value={l.iva_compra}
                          onChange={(ev) =>
                            setLineaCampo(l.key, 'iva_compra', ev.target.value)
                          }
                          className={inputCls}
                        />
                      </td>
                      <td className="p-2 text-right tabular-nums font-semibold text-[#391511]">
                        <MontoARS monto={calc.costoConIva} />
                      </td>
                      <td className="p-1 w-16">
                        <Input
                          type="number"
                          value={l.margen}
                          onChange={(ev) =>
                            setLineaCampo(l.key, 'margen', ev.target.value)
                          }
                          className={inputCls}
                        />
                      </td>
                      <td className="p-2 text-right tabular-nums text-[#6f3a2a]">
                        <MontoARS monto={calc.precioSinIva} />
                      </td>
                      <td className="p-1 w-16">
                        <Input
                          type="number"
                          min="0"
                          value={l.iva_venta}
                          onChange={(ev) =>
                            setLineaCampo(l.key, 'iva_venta', ev.target.value)
                          }
                          className={inputCls}
                        />
                      </td>
                      <td className="p-2 text-right tabular-nums font-bold text-[#391511]">
                        <MontoARS monto={calc.precioConIva} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="border-t border-[#e4c9b0]/60 bg-[#fdfaf6] px-6 py-4 shrink-0">
          {/* Percepciones sufridas en el comprobante */}
          <div className="flex flex-wrap items-center justify-end gap-3 mb-3">
            <span className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold mr-1">
              Percepciones
            </span>
            {(
              [
                ['IIBB', 'iibb'],
                ['IVA', 'iva'],
                ['Otros', 'otros'],
              ] as const
            ).map(([etiqueta, clave]) => (
              <div key={clave} className="flex items-center gap-1.5">
                <span className="text-xs text-[#6f3a2a]">{etiqueta}</span>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={percepciones[clave]}
                  onChange={(e) =>
                    setPercepciones((p) => ({ ...p, [clave]: e.target.value }))
                  }
                  placeholder="0"
                  className="h-8 w-24 text-right tabular-nums border-[#e4c9b0] text-xs"
                />
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-1 mb-3 text-sm">
            <span className="text-[#6f3a2a]">
              Importe neto:{' '}
              <span className="font-semibold text-[#391511] tabular-nums">
                <MontoARS monto={totales.neto} />
              </span>
            </span>
            <span className="text-[#6f3a2a]">
              IVA:{' '}
              <span className="font-semibold text-[#391511] tabular-nums">
                <MontoARS monto={totales.iva} />
              </span>
            </span>
            {totalPercepciones > 0 && (
              <span className="text-[#6f3a2a]">
                Percepciones:{' '}
                <span className="font-semibold text-[#391511] tabular-nums">
                  <MontoARS monto={totalPercepciones} />
                </span>
              </span>
            )}
            <span className="text-[#391511] font-bold">
              Total a pagar:{' '}
              <span className="text-xl font-extrabold tabular-nums">
                <MontoARS monto={totalConIva} />
              </span>
            </span>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => onCambioAbierto(false)}
              disabled={guardar.isPending}
              className="flex-1 border-[#e4c9b0] text-[#6f3a2a]"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleGuardar}
              disabled={guardar.isPending || lineas.length === 0}
              className="flex-[2] bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-bold disabled:opacity-50"
            >
              {guardar.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Guardando…
                </>
              ) : (
                'Guardar factura'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
