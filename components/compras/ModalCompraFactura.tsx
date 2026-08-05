'use client'

import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  Loader2,
  Package,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { MontoARS } from '@/components/shared/MontoARS'
import { useProveedores } from '@/lib/hooks/useProveedores'
import { useBuscarProductos } from '@/lib/hooks/useProductos'
import { useCuentas } from '@/lib/hooks/useCuentas'
import { useRegistrarCompraDirecta } from '@/lib/hooks/useComprasDirectas'
import { useConfigFiscal } from '@/lib/hooks/useFiscal'
import { CATEGORIAS_EGRESO } from '@/lib/queries/finanzas'
import { cn } from '@/lib/utils'
import {
  cuitValido,
  discriminaIva,
  soloDigitos,
  tipoDesdeCondicionIva,
} from '@/lib/utils/fiscal'

interface LineaStock {
  producto_id: number
  nombre: string
  cantidad: string
  costo_sin_iva: string
  /** Margen % del producto (editable si se actualiza el precio de venta). */
  margen: string
  /** IVA de venta % del producto (para el recálculo del precio). */
  iva_venta: string
}

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  contexto: 'pos' | 'finanzas'
  usuarioId: string
  /** Requerido en el POS: el gasto sale del efectivo del turno. */
  turnoId?: number | null
}

const TIPOS_COMPROBANTE = ['A', 'B', 'C', 'M', 'X']

function hoyIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function ModalCompraFactura({
  abierto,
  onCambioAbierto,
  contexto,
  usuarioId,
  turnoId,
}: Props) {
  const { data: proveedores } = useProveedores()
  const { data: cuentas } = useCuentas(true)
  const { data: configFiscal } = useConfigFiscal()
  const registrar = useRegistrarCompraDirecta()

  const [proveedorId, setProveedorId] = useState('')
  const [mueveStock, setMueveStock] = useState(false)
  const [afectaPrecio, setAfectaPrecio] = useState(false)
  const [fecha, setFecha] = useState(hoyIso())

  // Modo mercadería
  const [lineas, setLineas] = useState<LineaStock[]>([])
  const [busqueda, setBusqueda] = useState('')
  const { data: resultados } = useBuscarProductos(busqueda)

  // Modo gasto
  const [gastoDescripcion, setGastoDescripcion] = useState('')
  const [gastoCategoria, setGastoCategoria] = useState('otros')
  const [gastoNeto, setGastoNeto] = useState('')

  // Fiscal
  const [ivaPct, setIvaPct] = useState('21')
  const [tipoComp, setTipoComp] = useState('A')
  const [puntoVenta, setPuntoVenta] = useState('')
  const [numero, setNumero] = useState('')
  // CUIT que va al Libro IVA. Se precarga de la ficha al elegir proveedor pero
  // es editable: si la ficha está vacía, este es el único lugar por donde el
  // dato entra al sistema (antes viajaba null y nadie se enteraba).
  const [cuit, setCuit] = useState('')
  // Solo se valida el CUIT que TIPEÓ el usuario: las fichas viejas pueden
  // tener CUITs con el verificador mal (ni el ABM ni la importación lo
  // chequean), y bloquear por eso dejaría sin poder comprar a alguien que
  // encima no tiene permiso para entrar a Configuración a arreglarlo.
  const [cuitTocado, setCuitTocado] = useState(false)

  // Pago (finanzas)
  const [cuentaId, setCuentaId] = useState('')

  const procesando = registrar.isPending

  function reset() {
    setProveedorId('')
    setMueveStock(false)
    setAfectaPrecio(false)
    setFecha(hoyIso())
    setLineas([])
    setBusqueda('')
    setGastoDescripcion('')
    setGastoCategoria('otros')
    setGastoNeto('')
    setIvaPct('21')
    setTipoComp('A')
    setPuntoVenta('')
    setNumero('')
    setCuit('')
    setCuitTocado(false)
    setCuentaId('')
  }

  /**
   * Elegir proveedor precarga sus datos fiscales. Va acá y no en un useEffect
   * porque el proveedor SOLO se puede elegir de la lista ya cargada: en este
   * punto la ficha está garantizada en memoria, así que no existe el caso de
   * "la ficha resuelve tarde" ni el riesgo de pisar lo tipeado después.
   *
   * El CUIT se REEMPLAZA siempre: lo que hubiera era del proveedor anterior, y
   * dejarlo pegado mandaría el CUIT de otro al Libro IVA.
   */
  function elegirProveedor(v: string | null) {
    const id = v ?? ''
    setProveedorId(id)
    const p = (proveedores ?? []).find((x) => String(x.id) === id)
    setCuit(p?.cuit ?? '')
    setCuitTocado(false)
    aplicarTipo(tipoDesdeCondicionIva(p?.condicion_iva))
  }

  /**
   * El tipo de comprobante manda sobre el IVA: una B, C o X no discrimina IVA,
   * así que dejarle el 21% cargado inventa un crédito fiscal que no existe y
   * mete en el Libro IVA una fila que se contradice sola (letra C con IVA
   * discriminado). Queda editable por si el papel dice otra cosa.
   */
  function aplicarTipo(t: string) {
    setTipoComp(t)
    setIvaPct(discriminaIva(t) ? '21' : '0')
  }

  function agregarLinea(prod: {
    id: number
    nombre: string
    margen?: number | null
    iva_venta?: number | null
  }) {
    // El margen viene del producto: antes se mandaba 0 hardcodeado y, con
    // "actualizar precio de venta" tildado, el RPC repriceaba el producto SIN
    // ganancia (precio = costo + cargas) y le pisaba el margen a 0.
    const margenProd = prod.margen ?? 0
    setLineas((prev) =>
      prev.some((l) => l.producto_id === prod.id)
        ? prev
        : [
            ...prev,
            {
              producto_id: prod.id,
              nombre: prod.nombre,
              cantidad: '1',
              costo_sin_iva: '',
              margen: String(margenProd > 0 ? margenProd : 30),
              iva_venta: String(prod.iva_venta ?? 21),
            },
          ]
    )
    setBusqueda('')
  }

  function editarLinea(
    id: number,
    campo: 'cantidad' | 'costo_sin_iva' | 'margen',
    valor: string
  ) {
    setLineas((prev) =>
      prev.map((l) => (l.producto_id === id ? { ...l, [campo]: valor } : l))
    )
  }

  const neto = useMemo(() => {
    if (mueveStock) {
      return lineas.reduce(
        (acc, l) => acc + (Number(l.cantidad) || 0) * (Number(l.costo_sin_iva) || 0),
        0
      )
    }
    return Number(gastoNeto) || 0
  }, [mueveStock, lineas, gastoNeto])

  const ivaTotal = useMemo(
    () => Math.round(neto * (Number(ivaPct) || 0)) / 100,
    [neto, ivaPct]
  )
  const total = Math.round((neto + ivaTotal) * 100) / 100

  const proveedorSel = (proveedores ?? []).find((p) => String(p.id) === proveedorId)

  // ── Ficha del proveedor: validación del CUIT y aviso de datos faltantes ──
  const hayFicha = proveedorSel != null
  const provCuit = (proveedorSel?.cuit ?? '').trim()
  const razonSocial = (proveedorSel?.razon_social ?? '').trim()
  const nombreProveedor = proveedorSel?.nombre ?? 'el proveedor'
  // Solo bloquea lo que el usuario tipeó mal (ver comentario de `cuitTocado`).
  const cuitError = cuitTocado && cuit.trim() !== '' && !cuitValido(cuit)
  // La factura trae DOS CUIT: el del que emite y el nuestro. Copiar el nuestro
  // es el error más fácil de cometer y pasa la validación sin chistar, así que
  // se bloquea explícito.
  const cuitPropio = soloDigitos(configFiscal?.cuit ?? '')
  const esCuitPropio =
    cuitPropio.length === 11 && soloDigitos(cuit) === cuitPropio
  // La razón social no se arregla desde acá (se edita en Configuración) y en
  // el POS sería ruido para quien está cobrando: solo se avisa en Finanzas.
  const faltaRazonSocial =
    contexto === 'finanzas' && hayFicha && razonSocial === ''
  // El CUIT tipeado completa la ficha sola al registrar, pero solo si es válido
  // de 11 dígitos: hasta entonces el aviso se queda.
  const avisarCuit = hayFicha && provCuit === '' && !cuitValido(cuit)
  const avisoFicha = faltaRazonSocial || avisarCuit

  const cuentaSel = (cuentas ?? []).find((c) => String(c.id) === cuentaId)
  const saldoResultante =
    contexto === 'finanzas' && cuentaSel && total > 0
      ? Number(cuentaSel.saldo_actual) - total
      : null
  const bloqueoBoveda =
    !!cuentaSel?.es_caja_fuerte && saldoResultante !== null && saldoResultante < 0

  const lineasValidas =
    mueveStock &&
    lineas.length > 0 &&
    lineas.every((l) => Number(l.cantidad) > 0 && Number(l.costo_sin_iva) > 0)
  const gastoValido = !mueveStock && neto > 0 && gastoDescripcion.trim().length >= 2

  const puedeConfirmar =
    !procesando &&
    !!proveedorId &&
    !cuitError &&
    !esCuitPropio &&
    total > 0 &&
    (mueveStock ? lineasValidas : gastoValido) &&
    (contexto === 'pos' ? !!turnoId : !!cuentaId && !bloqueoBoveda)

  function confirmar() {
    if (!puedeConfirmar) return
    registrar.mutate(
      {
        usuario_id: usuarioId,
        proveedor_id: Number(proveedorId),
        fecha,
        fiscal: {
          tipo_comprobante: tipoComp || null,
          punto_venta: puntoVenta.trim() || null,
          numero_comprobante: numero.trim() || null,
          // Pelado: así lo guarda la ficha y así lo compara el índice único de
          // comprobantes (si acá fuera con guiones, no cruzaría).
          cuit: soloDigitos(cuit) || null,
          neto: Math.round(neto * 100) / 100,
          iva_total: ivaTotal,
        },
        lineas: mueveStock
          ? lineas.map((l) => ({
              producto_id: l.producto_id,
              cantidad: Number(l.cantidad),
              costo_sin_iva: Number(l.costo_sin_iva),
              iva_compra_porcentaje: Number(ivaPct) || 0,
              margen_porcentaje: Number(l.margen) || 0,
              iva_venta_porcentaje: Number(l.iva_venta) || 21,
            }))
          : [],
        gasto: mueveStock
          ? null
          : { descripcion: gastoDescripcion.trim(), categoria: gastoCategoria },
        mueve_stock: mueveStock,
        afecta_precio_venta: mueveStock && afectaPrecio,
        pago:
          contexto === 'pos'
            ? { origen: 'turno', turno_id: turnoId ?? null }
            : { origen: 'cuenta', cuenta_id: Number(cuentaId) },
      },
      {
        onSuccess: () => {
          reset()
          onCambioAbierto(false)
        },
      }
    )
  }

  return (
    <Dialog open={abierto} onOpenChange={(v) => !procesando && onCambioAbierto(v)}>
      <DialogContent className="sm:max-w-lg p-0 gap-0 overflow-hidden max-h-[92vh] flex flex-col">
        <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6] shrink-0">
          <DialogTitle className="text-[#391511] text-lg flex items-center gap-2">
            <Package className="h-5 w-5 text-[#f9b44c]" />
            Compra con factura
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            {contexto === 'pos'
              ? 'Compra al proveedor pagada con el efectivo del turno.'
              : 'Compra al proveedor pagada desde una cuenta.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {/* Proveedor */}
          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">
              Proveedor <span className="text-[#c43e2c]">*</span>
            </Label>
            <Select value={proveedorId} onValueChange={elegirProveedor} disabled={procesando}>
              <SelectTrigger className="border-[#e4c9b0] focus:ring-[#f9b44c]">
                <SelectValue placeholder="Elegí el proveedor…" />
              </SelectTrigger>
              <SelectContent>
                {(proveedores ?? []).map((p) => {
                  // El CUIT/razón social a la vista evitan confundir dos
                  // proveedores de nombre parecido (el CUIT elegido se copia a
                  // la factura y puede quedar en la ficha).
                  const detalle = [p.razon_social, p.cuit]
                    .filter(Boolean)
                    .join(' · ')
                  return (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.nombre}
                      {detalle ? ` — ${detalle}` : ''}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>

            {avisoFicha && (
              <div className="mt-2 flex items-start gap-2 rounded-lg border border-[#f9b44c]/50 bg-[#f9b44c]/15 px-3 py-2">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#9e6b15]" />
                <div className="min-w-0 space-y-0.5 text-[11px] leading-snug text-[#6f3a2a]">
                  <p className="font-semibold text-[#391511]">
                    La ficha de {nombreProveedor} está incompleta
                  </p>
                  {avisarCuit && (
                    <p>
                      Le falta el <strong>CUIT</strong>. El que pongas más abajo
                      queda guardado en la ficha al registrar la compra.
                    </p>
                  )}
                  {faltaRazonSocial && (
                    <p>
                      Le falta la <strong>razón social</strong>. Cargala en
                      Configuración › Proveedores: es la que sale en el Libro
                      IVA y, si está vacía, sale el nombre de fantasía.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ¿Mueve stock? */}
          <div className="grid grid-cols-2 gap-2">
            {[
              { v: false, t: 'Gasto (sin stock)', d: 'No controla inventario' },
              { v: true, t: 'Mercadería (stock)', d: 'Suma al inventario' },
            ].map((op) => {
              const activo = mueveStock === op.v
              return (
                <button
                  key={String(op.v)}
                  type="button"
                  onClick={() => setMueveStock(op.v)}
                  disabled={procesando}
                  className={cn(
                    'py-2.5 px-3 rounded-xl border-2 text-left transition-all',
                    activo
                      ? 'border-[#f9b44c] bg-[#f9b44c]/15'
                      : 'border-[#e4c9b0] bg-white hover:border-[#c8a58a]'
                  )}
                >
                  <div className="text-sm font-bold text-[#391511]">{op.t}</div>
                  <div className="text-[10px] text-[#6f3a2a]">{op.d}</div>
                </button>
              )
            })}
          </div>

          {mueveStock ? (
            <div className="space-y-2">
              {/* Buscador de productos */}
              <Label className="text-[#391511] font-medium text-sm">Productos</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#c8a58a]" />
                <Input
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  placeholder="Buscar producto para agregar…"
                  disabled={procesando}
                  className="pl-8 border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
                />
                {busqueda.trim().length >= 2 && (resultados ?? []).length > 0 && (
                  <div className="absolute z-20 mt-1 w-full max-h-48 overflow-y-auto rounded-lg border border-[#e4c9b0] bg-white shadow-lg">
                    {(resultados ?? []).slice(0, 8).map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() =>
                          agregarLinea({
                            id: p.id,
                            nombre: p.nombre,
                            margen: p.margen,
                            iva_venta: p.iva_venta,
                          })
                        }
                        className="w-full text-left px-3 py-2 text-sm text-[#391511] hover:bg-[#fdfaf6]"
                      >
                        {p.nombre}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {lineas.length === 0 ? (
                <p className="text-xs text-[#6f3a2a] py-2">
                  Buscá y agregá los productos comprados.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {lineas.map((l) => (
                    <div
                      key={l.producto_id}
                      className="flex items-center gap-2 rounded-lg border border-[#e4c9b0]/60 px-2 py-1.5"
                    >
                      <div className="flex-1 min-w-0 text-sm text-[#391511] truncate">
                        {l.nombre}
                      </div>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={l.cantidad}
                        onChange={(e) => editarLinea(l.producto_id, 'cantidad', e.target.value)}
                        placeholder="Cant."
                        className="w-16 h-8 text-sm tabular-nums border-[#e4c9b0]"
                      />
                      <div className="relative">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[#c8a58a] text-xs">$</span>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={l.costo_sin_iva}
                          onChange={(e) => editarLinea(l.producto_id, 'costo_sin_iva', e.target.value)}
                          placeholder="Costo s/IVA"
                          className="w-24 h-8 pl-5 text-sm tabular-nums border-[#e4c9b0]"
                        />
                      </div>
                      {afectaPrecio && (
                        <div className="relative" title="Margen % para recalcular el precio de venta">
                          <Input
                            type="number"
                            step="0.01"
                            value={l.margen}
                            onChange={(e) => editarLinea(l.producto_id, 'margen', e.target.value)}
                            placeholder="Marg"
                            className="w-16 h-8 pr-5 text-sm tabular-nums border-[#e4c9b0]"
                          />
                          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[#c8a58a] text-xs">%</span>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          setLineas((prev) => prev.filter((x) => x.producto_id !== l.producto_id))
                        }
                        className="text-[#c8a58a] hover:text-[#c43e2c]"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <label className="flex items-center gap-2 text-xs text-[#6f3a2a] cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={afectaPrecio}
                  onChange={(e) => setAfectaPrecio(e.target.checked)}
                  className="accent-[#f9b44c] h-3.5 w-3.5"
                />
                Actualizar también el precio de venta con estos costos
              </label>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-[#391511] font-medium text-sm">
                  Descripción <span className="text-[#c43e2c]">*</span>
                </Label>
                <Input
                  value={gastoDescripcion}
                  onChange={(e) => setGastoDescripcion(e.target.value)}
                  placeholder="Ej: Pan del día"
                  disabled={procesando}
                  className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-[#391511] font-medium text-sm">Categoría</Label>
                  <Select value={gastoCategoria} onValueChange={(v) => setGastoCategoria(v ?? 'otros')} disabled={procesando}>
                    <SelectTrigger className="border-[#e4c9b0] focus:ring-[#f9b44c]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIAS_EGRESO.filter((c) => c.valor !== 'pago_proveedores').map((c) => (
                        <SelectItem key={c.valor} value={c.valor}>
                          {c.etiqueta}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[#391511] font-medium text-sm">
                    Neto (sin IVA) <span className="text-[#c43e2c]">*</span>
                  </Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#c8a58a] text-sm">$</span>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={gastoNeto}
                      onChange={(e) => setGastoNeto(e.target.value)}
                      placeholder="0,00"
                      disabled={procesando}
                      className="pl-7 tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* CUIT del comprobante — fila propia: no entra en el grid de 4 */}
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
              CUIT proveedor
            </Label>
            <Input
              inputMode="numeric"
              placeholder="30xxxxxxxxx"
              value={cuit}
              onChange={(e) => {
                setCuit(e.target.value)
                setCuitTocado(true)
              }}
              disabled={procesando}
              className={cn(
                'h-9 tabular-nums',
                cuitError || esCuitPropio ? 'border-[#c43e2c]' : 'border-[#e4c9b0]'
              )}
            />
            {esCuitPropio ? (
              <p className="text-[10px] text-[#c43e2c]">
                Ese es el CUIT de Hola Express: cargá el del proveedor que
                emite la factura.
              </p>
            ) : cuitError ? (
              <p className="text-[10px] text-[#c43e2c]">
                CUIT inválido (11 dígitos).
              </p>
            ) : null}
          </div>

          {/* Comprobante + IVA */}
          <div className="grid grid-cols-4 gap-2">
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">Tipo</Label>
              <Select value={tipoComp} onValueChange={(v) => aplicarTipo(v ?? 'A')} disabled={procesando}>
                <SelectTrigger className="border-[#e4c9b0] focus:ring-[#f9b44c] h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_COMPROBANTE.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">Pto vta</Label>
              <Input
                value={puntoVenta}
                onChange={(e) => setPuntoVenta(e.target.value)}
                placeholder="0001"
                className="h-9 tabular-nums border-[#e4c9b0]"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">Número</Label>
              <Input
                value={numero}
                onChange={(e) => setNumero(e.target.value)}
                placeholder="00001234"
                className="h-9 tabular-nums border-[#e4c9b0]"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">IVA %</Label>
              <Input
                type="number"
                min="0"
                step="0.5"
                value={ivaPct}
                onChange={(e) => setIvaPct(e.target.value)}
                className="h-9 tabular-nums border-[#e4c9b0]"
              />
            </div>
          </div>
          {!discriminaIva(tipoComp) && Number(ivaPct) > 0 && (
            <p className="-mt-2 flex items-start gap-1 text-[10px] leading-snug text-[#c43e2c]">
              <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
              Un comprobante {tipoComp} no discrimina IVA: cargarle{' '}
              {ivaPct}% suma un crédito fiscal que no existe.
            </p>
          )}

          {/* Pago */}
          {contexto === 'pos' ? (
            <div className="rounded-lg bg-[#fdfaf6] border border-[#e4c9b0]/60 px-3 py-2 text-xs text-[#6f3a2a]">
              Se paga con el <strong>efectivo del turno</strong> (se descuenta al cerrar la caja).
              {!turnoId && (
                <span className="text-[#c43e2c] block mt-0.5">
                  No hay un turno abierto para registrar la compra.
                </span>
              )}
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">
                Pagar desde <span className="text-[#c43e2c]">*</span>
              </Label>
              <Select value={cuentaId} onValueChange={(v) => setCuentaId(v ?? '')} disabled={procesando}>
                <SelectTrigger className="border-[#e4c9b0] focus:ring-[#f9b44c]">
                  <SelectValue placeholder="Elegí la cuenta…" />
                </SelectTrigger>
                <SelectContent>
                  {(cuentas ?? []).map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.nombre} ·{' '}
                      <span className="font-mono tabular-nums">
                        ${Number(c.saldo_actual).toFixed(2)}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {bloqueoBoveda && (
                <p className="text-[#c43e2c] text-xs">
                  La caja fuerte no puede quedar en negativo.
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="px-6 py-4 border-t border-[#e4c9b0]/60 bg-[#fdfaf6] shrink-0 flex-col sm:flex-col gap-2">
          <div className="flex items-center justify-between w-full text-sm">
            <span className="text-[#6f3a2a]">
              Neto <MontoARS monto={neto} /> · IVA <MontoARS monto={ivaTotal} />
            </span>
            <span className="text-lg font-extrabold text-[#391511] tabular-nums">
              Total <MontoARS monto={total} />
            </span>
          </div>
          <div className="flex gap-2 w-full">
            <Button
              type="button"
              variant="outline"
              onClick={() => onCambioAbierto(false)}
              disabled={procesando}
              className="flex-1 border-[#e4c9b0] text-[#6f3a2a]"
            >
              <X className="h-4 w-4 mr-1" /> Cancelar
            </Button>
            <Button
              type="button"
              onClick={confirmar}
              disabled={!puedeConfirmar}
              className="flex-[2] bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold disabled:opacity-40"
            >
              {procesando ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Registrando…
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-1" /> Registrar compra
                </>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
