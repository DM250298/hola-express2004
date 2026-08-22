'use client'

import { useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Loader2,
  Package,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
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
import {
  EditorCuotas,
  cuotasValidas,
  type CuotaForm,
} from '@/components/finanzas/EditorCuotas'
import { useProveedores } from '@/lib/hooks/useProveedores'
import { useBuscarProductos } from '@/lib/hooks/useProductos'
import { useCuentas } from '@/lib/hooks/useCuentas'
import { useRegistrarCompraDirecta } from '@/lib/hooks/useComprasDirectas'
import { useConfigFiscal } from '@/lib/hooks/useFiscal'
import { useUsuario } from '@/lib/hooks/useUsuario'
import {
  CATEGORIAS_EGRESO,
  FORMAS_PAGO,
  labelComprobante,
  requiereComprobante,
  type FormaPago,
} from '@/lib/queries/finanzas'
import { cn } from '@/lib/utils'
import {
  TIPOS_COMPROBANTE_COMPRA,
  TIPOS_COMPROBANTE_COMPRA_ITEMS,
  cuitValido,
  discriminaIva,
  exigeDatosFiscales,
  numeroComprobanteValido,
  puntoVentaValido,
  soloDigitos,
  tipoDesdeCondicionIva,
} from '@/lib/utils/fiscal'
import { hoyIso } from '@/lib/utils/periodos'

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

const r2 = (n: number) => Math.round(n * 100) / 100

/**
 * Cómo se cancela la compra directa (mig 155): elección explícita. No existe
 * "programado" acá — fn_registrar_compra_directa paga en el acto o deja el
 * saldo a cuenta corriente (mig 149).
 */
type ModoPagoDirecta = 'ahora' | 'cuenta_corriente'

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
  const { data: usuarioActual } = useUsuario()
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

  // ── Pago parcial / saldo a cuenta corriente (mig 149) ────────────────
  // Sin tocar nada se paga el total, como siempre. `pagoTocado` distingue
  // "no tocó el importe" (sigue al total vivo) de "escribió un importe".
  const [montoPago, setMontoPago] = useState('')
  const [pagoTocado, setPagoTocado] = useState(false)
  const [vencimientoCC, setVencimientoCC] = useState('')
  const [usarCuotas, setUsarCuotas] = useState(false)
  const [cuotas, setCuotas] = useState<CuotaForm[]>([])
  // ── Modo de pago explícito + forma + comprobante (mig 155) ───────────
  // Finanzas: null hasta que elija. POS: 'ahora' (efectivo del turno), y las
  // tarjetas solo aparecen si el usuario puede dejar saldo.
  const [modoPago, setModoPago] = useState<ModoPagoDirecta | null>(null)
  const [formaPago, setFormaPago] = useState<FormaPago>('transferencia')
  const [comprobantePago, setComprobantePago] = useState('')
  // "Falta …" en ámbar hasta que se intenta confirmar; después en rojo, con
  // foco al primer campo faltante (en modo mercadería el bloque fiscal queda
  // lejos de la tabla).
  const [intentoConfirmar, setIntentoConfirmar] = useState(false)
  const ptoRef = useRef<HTMLInputElement>(null)
  const nroRef = useRef<HTMLInputElement>(null)
  const cuitRef = useRef<HTMLInputElement>(null)
  const comprobanteRef = useRef<HTMLInputElement>(null)

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
    setMontoPago('')
    setPagoTocado(false)
    setVencimientoCC('')
    setUsarCuotas(false)
    setCuotas([])
    setModoPago(null)
    setFormaPago('transferencia')
    setComprobantePago('')
    setIntentoConfirmar(false)
  }

  /** Elegir la cuenta de pago sugiere la forma por su tipo (editable). */
  function elegirCuenta(v: string | null) {
    const id = v ?? ''
    setCuentaId(id)
    const c = (cuentas ?? []).find((x) => String(x.id) === id)
    if (c) setFormaPago(c.tipo === 'caja' ? 'efectivo' : 'transferencia')
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
  // ── Datos fiscales obligatorios (mig 155), salvo tipo X ──────────────
  // Errores de FORMATO deshabilitan; los FALTANTES se avisan en ámbar y, al
  // intentar confirmar, en rojo (el botón queda habilitado para poder avisar).
  // CUIT obligatorio = 11 dígitos; el verificador se valida solo con
  // cuitTocado (fichas viejas con CUIT mal no bloquean la compra).
  const fiscalObligatorio = exigeDatosFiscales(tipoComp)
  const ptoError = puntoVenta.trim() !== '' && !puntoVentaValido(puntoVenta)
  const nroError = numero.trim() !== '' && !numeroComprobanteValido(numero)
  const faltaPto = fiscalObligatorio && puntoVenta.trim() === ''
  const faltaNro = fiscalObligatorio && numero.trim() === ''
  const faltaCuit = fiscalObligatorio && soloDigitos(cuit).length !== 11 && !cuitError
  const faltanDatos = faltaPto || faltaNro || faltaCuit
  const clsFalta = intentoConfirmar ? 'text-[#c43e2c]' : 'text-[#b3821b]'
  const bordeFalta = intentoConfirmar ? 'border-[#c43e2c]' : 'border-[#f9b44c]'
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

  // Fecha de emisión de la factura. Como en el egreso de Finanzas
  // (fn_crear_egreso v2), la misma fecha define el período fiscal y el
  // momento en que el gasto pesa: por eso se avisa cuando no es hoy. Una
  // factura no puede estar emitida en el futuro, y si cae en un mes contable
  // cerrado el RPC la rechaza (fn_periodo_cerrado).
  const fechaError = !fecha || fecha > hoyIso()
  const fechaPasada = !!fecha && fecha < hoyIso()

  const cuentaSel = (cuentas ?? []).find((c) => String(c.id) === cuentaId)

  // Dejar deuda exige permiso 'finanzas' (espejo del guard del RPC). En el
  // contexto finanzas la pantalla ya está gateada por ese permiso; el rol
  // admin bypassa fn_tiene_permiso, así que acá también.
  const puedeDejarSaldo =
    contexto === 'finanzas' ||
    usuarioActual?.rol === 'admin' ||
    (usuarioActual?.permisos ?? []).includes('finanzas')

  // ── Modo de pago explícito (mig 155) + pago parcial / saldo a CC (mig 149) ──
  // Sin permiso para dejar saldo no hay nada que elegir: se paga todo.
  const modoEfectivo: ModoPagoDirecta | null = !puedeDejarSaldo
    ? 'ahora'
    : (modoPago ?? (contexto === 'pos' ? 'ahora' : null))
  const montoPagoNum =
    modoEfectivo === 'ahora'
      ? pagoTocado
        ? Number(montoPago) || 0
        : total
      : 0
  const saldoCC = r2(total - montoPagoNum)
  // Sin modo elegido todavía no hay "deuda" que mostrar ni validar.
  const hayDeuda = modoEfectivo !== null && saldoCC > 0.009
  const pagoInvalido = montoPagoNum < 0 || montoPagoNum > total + 0.009
  // Forma de pago: desde el turno siempre efectivo (sin número que cargar);
  // desde una cuenta, la elegida. Transferencia/cheque/débito exigen el n°.
  const formaEfectiva: FormaPago = contexto === 'pos' ? 'efectivo' : formaPago
  const comprobanteFaltante =
    montoPagoNum > 0.009 &&
    requiereComprobante(formaEfectiva) &&
    comprobantePago.trim() === ''
  const cuotasOk = cuotasValidas(cuotas, saldoCC)
  const totalUnidades = lineas.reduce(
    (acc, l) => acc + (Number(l.cantidad) || 0),
    0
  )

  // El guard de la bóveda se evalúa sobre lo que SALE ahora (lo pagado),
  // no sobre el total: un pago parcial no se bloquea por el resto a CC.
  const saldoResultante =
    contexto === 'finanzas' && cuentaSel && montoPagoNum > 0
      ? Number(cuentaSel.saldo_actual) - montoPagoNum
      : null
  const bloqueoBoveda =
    !!cuentaSel?.es_caja_fuerte && saldoResultante !== null && saldoResultante < 0

  const lineasValidas =
    mueveStock &&
    lineas.length > 0 &&
    lineas.every((l) => Number(l.cantidad) > 0 && Number(l.costo_sin_iva) > 0)
  const gastoValido = !mueveStock && neto > 0 && gastoDescripcion.trim().length >= 2

  // Validez "dura" (deshabilita el botón). Los FALTANTES obligatorios (datos
  // fiscales, modo, comprobante) se chequean al confirmar, con aviso y foco.
  const puedeConfirmar =
    !procesando &&
    !!proveedorId &&
    !cuitError &&
    !esCuitPropio &&
    !ptoError &&
    !nroError &&
    !fechaError &&
    total > 0 &&
    !pagoInvalido &&
    (mueveStock ? lineasValidas : gastoValido) &&
    (montoPagoNum <= 0.009
      ? true
      : contexto === 'pos'
        ? !!turnoId
        : !!cuentaId && !bloqueoBoveda) &&
    (!hayDeuda || (puedeDejarSaldo && (!usarCuotas || cuotasOk)))

  function confirmar() {
    if (!puedeConfirmar) return
    // Obligatorios (mig 155): se avisa qué falta en vez de dejar el botón
    // gris sin explicación.
    if (faltanDatos) {
      setIntentoConfirmar(true)
      const faltantes = [
        faltaPto && 'punto de venta',
        faltaNro && 'número',
        faltaCuit && 'CUIT del proveedor',
      ].filter((s): s is string => typeof s === 'string')
      toast.error(
        `Faltan datos del comprobante: ${faltantes.join(', ')}.${
          contexto === 'pos' ? ' Si es un ticket sin datos fiscales, elegí tipo X.' : ''
        }`
      )
      ;(faltaPto ? ptoRef : faltaNro ? nroRef : cuitRef).current?.focus()
      return
    }
    if (modoEfectivo === null) {
      setIntentoConfirmar(true)
      toast.error('Elegí cómo se paga la compra: ahora o a cuenta corriente.')
      return
    }
    if (comprobanteFaltante) {
      setIntentoConfirmar(true)
      toast.error(`Poné el ${labelComprobante(formaEfectiva)} del pago.`)
      comprobanteRef.current?.focus()
      return
    }
    if (hayDeuda && !usarCuotas && !vencimientoCC) {
      setIntentoConfirmar(true)
      toast.error('Poné la fecha de vencimiento del saldo a cuenta corriente.')
      return
    }
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
        // Saldo a cuenta corriente (mig 149): vencimiento único o cuotas.
        cta_cte:
          hayDeuda && !usarCuotas
            ? { fecha_vencimiento: vencimientoCC }
            : null,
        cuotas:
          hayDeuda && usarCuotas
            ? cuotas.map((c) => ({
                monto: r2(Number(c.monto) || 0),
                fecha_vencimiento: c.fecha,
              }))
            : null,
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
          montoPagoNum <= 0.009
            ? { origen: 'ninguno', monto: 0 }
            : contexto === 'pos'
              ? {
                  origen: 'turno',
                  turno_id: turnoId ?? null,
                  monto: r2(montoPagoNum),
                }
              : {
                  origen: 'cuenta',
                  cuenta_id: Number(cuentaId),
                  monto: r2(montoPagoNum),
                  // mig 155: forma + n° de comprobante (obligatorio según forma)
                  forma_pago: formaEfectiva,
                  comprobante: comprobantePago.trim() || null,
                },
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
    <Dialog
      open={abierto}
      onOpenChange={(v, detalles) => {
        // Ni Escape ni el click afuera cierran: es un form largo y un cierre
        // accidental tira toda la carga. Cerrar = X o Cancelar.
        if (
          !v &&
          (procesando ||
            detalles.reason === 'escape-key' ||
            detalles.reason === 'outside-press')
        ) {
          detalles.cancel()
          return
        }
        onCambioAbierto(v)
      }}
    >
      <DialogContent
        className={cn(
          'p-0 gap-0 overflow-hidden flex flex-col',
          // En modo mercadería el modal se agranda: la lista de productos es
          // la protagonista. En modo gasto (y en el POS por defecto) queda
          // angosto como siempre.
          mueveStock
            ? 'sm:max-w-[min(1500px,96vw)] h-[min(94vh,1100px)] max-h-[94vh]'
            : 'sm:max-w-lg max-h-[92vh]'
        )}
      >
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

        {/* En modo mercadería (lg+): grilla de 2 columnas — los productos a la
            izquierda ocupando todo el alto, proveedor/fiscal/pago en la
            columna derecha angosta. En gasto o pantallas chicas: apilado. */}
        <div
          className={cn(
            'flex-1 min-h-0 overflow-y-auto',
            mueveStock &&
              'lg:grid lg:grid-cols-[minmax(0,1fr)_420px] lg:grid-rows-[auto_minmax(0,1fr)] lg:overflow-hidden'
          )}
        >
          <div
            className={cn(
              'px-6 pt-5 space-y-4',
              mueveStock
                ? 'lg:col-start-2 lg:row-start-1 lg:border-l lg:border-[#e4c9b0]/60 lg:bg-[#fdfaf6] lg:pt-4 lg:pb-2'
                : 'pb-2'
            )}
          >
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
          </div>

          {mueveStock ? (
            <div className="px-6 pt-4 space-y-2 lg:col-start-1 lg:row-start-1 lg:row-span-2 lg:flex lg:flex-col lg:min-h-0 lg:overflow-hidden lg:pb-4">
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
                <div className="rounded-xl border border-[#e4c9b0]/60 overflow-x-auto lg:flex-1 lg:min-h-0 lg:overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-[#391511] text-[#f9d2a2]">
                        <th className="p-2 text-left">Producto</th>
                        <th className="p-2 w-20">Cant.</th>
                        <th className="p-2 w-28">Costo s/IVA</th>
                        {afectaPrecio && (
                          <th
                            className="p-2 w-20"
                            title="Margen % para recalcular el precio de venta"
                          >
                            Margen %
                          </th>
                        )}
                        <th className="p-2 w-9" aria-label="Quitar" />
                      </tr>
                    </thead>
                    <tbody>
                      {lineas.map((l) => (
                        <tr
                          key={l.producto_id}
                          className="border-b border-[#e4c9b0]/40 bg-white"
                        >
                          <td className="p-2 text-sm text-[#391511] min-w-[160px]">
                            {l.nombre}
                          </td>
                          <td className="p-1">
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              value={l.cantidad}
                              onChange={(e) => editarLinea(l.producto_id, 'cantidad', e.target.value)}
                              placeholder="Cant."
                              className="w-full h-8 text-right text-sm tabular-nums border-[#e4c9b0]"
                            />
                          </td>
                          <td className="p-1">
                            <div className="relative">
                              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[#c8a58a] text-xs">$</span>
                              <Input
                                type="number"
                                min="0"
                                step="0.01"
                                value={l.costo_sin_iva}
                                onChange={(e) => editarLinea(l.producto_id, 'costo_sin_iva', e.target.value)}
                                placeholder="Costo s/IVA"
                                className="w-full h-8 pl-5 text-right text-sm tabular-nums border-[#e4c9b0]"
                              />
                            </div>
                          </td>
                          {afectaPrecio && (
                            <td className="p-1">
                              <div className="relative">
                                <Input
                                  type="number"
                                  step="0.01"
                                  value={l.margen}
                                  onChange={(e) => editarLinea(l.producto_id, 'margen', e.target.value)}
                                  placeholder="Marg"
                                  className="w-full h-8 pr-5 text-right text-sm tabular-nums border-[#e4c9b0]"
                                />
                                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[#c8a58a] text-xs">%</span>
                              </div>
                            </td>
                          )}
                          <td className="p-1 text-center">
                            <button
                              type="button"
                              onClick={() =>
                                setLineas((prev) => prev.filter((x) => x.producto_id !== l.producto_id))
                              }
                              title="Quitar"
                              className="text-[#c8a58a] hover:text-[#c43e2c]"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-[#e4c9b0] bg-[#fdfaf6] text-[11px] font-semibold text-[#391511]">
                        <td className="p-2">
                          {lineas.length}{' '}
                          {lineas.length === 1 ? 'producto' : 'productos'}
                        </td>
                        <td className="p-2 text-right tabular-nums">
                          {new Intl.NumberFormat('es-AR', {
                            maximumFractionDigits: 3,
                          }).format(totalUnidades)}{' '}
                          u.
                        </td>
                        <td className="p-2" colSpan={afectaPrecio ? 3 : 2} />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}

              <label className="flex items-center gap-2 text-xs text-[#6f3a2a] cursor-pointer pt-1 shrink-0">
                <input
                  type="checkbox"
                  checked={afectaPrecio}
                  onChange={(e) => setAfectaPrecio(e.target.checked)}
                  className="accent-[#f9b44c] h-3.5 w-3.5"
                />
                Actualizar también el precio de venta con estos costos
              </label>
            </div>
          ) : null}

          {/* Gasto (sin stock) + fiscal + pago: en modo mercadería es la
              parte baja de la columna derecha, con su propio scroll. */}
          <div
            className={cn(
              'px-6 py-5 space-y-4',
              mueveStock &&
                'lg:col-start-2 lg:row-start-2 lg:border-l lg:border-[#e4c9b0]/60 lg:bg-[#fdfaf6] lg:overflow-y-auto lg:pt-2'
            )}
          >
          {!mueveStock && (
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

          {/* CUIT + fecha de emisión — fila propia: no entran en el grid de 4 */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                CUIT proveedor{' '}
                {fiscalObligatorio && <span className="text-[#c43e2c]">*</span>}
              </Label>
              <Input
                ref={cuitRef}
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
                  cuitError || esCuitPropio
                    ? 'border-[#c43e2c]'
                    : faltaCuit
                      ? bordeFalta
                      : 'border-[#e4c9b0]'
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
              ) : faltaCuit ? (
                <p className={cn('text-[10px]', clsFalta)}>
                  Falta el CUIT del proveedor (11 dígitos).
                  {contexto === 'pos' ? ' ¿Es un ticket sin datos fiscales? Elegí tipo X.' : ''}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                Fecha de emisión
              </Label>
              <Input
                type="date"
                value={fecha}
                max={hoyIso()}
                onChange={(e) => setFecha(e.target.value)}
                disabled={procesando}
                className={cn(
                  'h-9 tabular-nums',
                  fechaError ? 'border-[#c43e2c]' : 'border-[#e4c9b0]'
                )}
              />
              {fechaError ? (
                <p className="text-[10px] text-[#c43e2c]">
                  {fecha ? 'No puede ser posterior a hoy.' : 'Poné la fecha.'}
                </p>
              ) : fechaPasada ? (
                <p className="text-[10px] text-[#9e6b15]">
                  Va al Libro IVA y al resultado de ese día.
                </p>
              ) : null}
            </div>
          </div>

          {/* Comprobante + IVA. Tipo X = ticket sin datos fiscales: exime
              pto/número/CUIT (mig 155). */}
          <div className="grid grid-cols-4 gap-2">
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                Tipo <span className="text-[#c43e2c]">*</span>
              </Label>
              <Select
                items={TIPOS_COMPROBANTE_COMPRA_ITEMS}
                value={tipoComp}
                onValueChange={(v) => aplicarTipo(v ?? 'A')}
                disabled={procesando}
              >
                <SelectTrigger className="border-[#e4c9b0] focus:ring-[#f9b44c] h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_COMPROBANTE_COMPRA.map((t) => (
                    <SelectItem key={t.valor} value={t.valor}>
                      {t.etiqueta}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                Pto vta{' '}
                {fiscalObligatorio && <span className="text-[#c43e2c]">*</span>}
              </Label>
              <Input
                ref={ptoRef}
                inputMode="numeric"
                value={puntoVenta}
                onChange={(e) => setPuntoVenta(e.target.value)}
                placeholder="0001"
                className={cn(
                  'h-9 tabular-nums',
                  ptoError ? 'border-[#c43e2c]' : faltaPto ? bordeFalta : 'border-[#e4c9b0]'
                )}
              />
              {ptoError ? (
                <p className="text-[10px] text-[#c43e2c]">Solo números (hasta 5).</p>
              ) : faltaPto ? (
                <p className={cn('text-[10px]', clsFalta)}>Falta.</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                Número{' '}
                {fiscalObligatorio && <span className="text-[#c43e2c]">*</span>}
              </Label>
              <Input
                ref={nroRef}
                inputMode="numeric"
                value={numero}
                onChange={(e) => setNumero(e.target.value)}
                placeholder="00001234"
                className={cn(
                  'h-9 tabular-nums',
                  nroError ? 'border-[#c43e2c]' : faltaNro ? bordeFalta : 'border-[#e4c9b0]'
                )}
              />
              {nroError ? (
                <p className="text-[10px] text-[#c43e2c]">Solo números (hasta 8).</p>
              ) : faltaNro ? (
                <p className={cn('text-[10px]', clsFalta)}>Falta.</p>
              ) : null}
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

          {/* Pago (mig 149: puede ser total, parcial o nada — el resto queda
              a cuenta corriente del proveedor, con vencimiento o en cuotas) */}
          <div className="space-y-2">
            <Label className="text-[#391511] font-medium text-sm">
              Cómo se paga{' '}
              {puedeDejarSaldo && <span className="text-[#c43e2c]">*</span>}
            </Label>

            {/* Modo explícito (mig 155): dos tarjetas — acá no hay "programado"
                (la compra directa paga en el acto o deja saldo a CC). Sin
                permiso para dejar saldo, se paga todo y no hay nada que elegir. */}
            {puedeDejarSaldo && (
              <div
                className={cn(
                  'grid grid-cols-2 gap-2 rounded-xl',
                  intentoConfirmar &&
                    modoEfectivo === null &&
                    'ring-2 ring-[#c43e2c]/60 ring-offset-1'
                )}
              >
                {(
                  [
                    { v: 'ahora', t: 'Pago ahora', d: contexto === 'pos' ? 'Efectivo del turno' : 'Total o parcial' },
                    { v: 'cuenta_corriente', t: 'Cuenta corriente', d: 'Vence o en cuotas' },
                  ] as { v: ModoPagoDirecta; t: string; d: string }[]
                ).map((op) => {
                  const activo = modoEfectivo === op.v
                  return (
                    <button
                      key={op.v}
                      type="button"
                      onClick={() => {
                        setModoPago(op.v)
                        if (op.v === 'cuenta_corriente') {
                          setMontoPago('0')
                          setPagoTocado(true)
                        } else {
                          // Vuelve a seguir al total (editable para parcial).
                          setMontoPago('')
                          setPagoTocado(false)
                        }
                      }}
                      disabled={procesando}
                      className={cn(
                        'py-2 px-3 rounded-xl border-2 text-left transition-all',
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
            )}
            {puedeDejarSaldo && modoEfectivo === null && (
              <p className={cn('text-xs', clsFalta)}>
                Elegí cómo se paga la compra para poder registrarla.
              </p>
            )}

            {modoEfectivo === 'ahora' && (
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1.5">
                  <Label className="text-[11px] text-[#6f3a2a]">
                    Importe a pagar ahora
                  </Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#c8a58a] text-sm">
                      $
                    </span>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={pagoTocado ? montoPago : String(total)}
                      onChange={(e) => {
                        setMontoPago(e.target.value)
                        setPagoTocado(true)
                      }}
                      disabled={procesando}
                      className={cn(
                        'pl-7 h-9 w-40 text-right font-semibold tabular-nums focus-visible:ring-[#f9b44c]',
                        pagoInvalido ? 'border-[#c43e2c]' : 'border-[#e4c9b0]'
                      )}
                    />
                  </div>
                </div>
                {puedeDejarSaldo && hayDeuda && (
                  <p className="text-[11px] text-[#6f3a2a] pb-2">
                    Pago parcial: el resto queda a cuenta corriente.
                  </p>
                )}
              </div>
            )}
            {pagoInvalido && (
              <p className="text-[#c43e2c] text-xs">
                El pago no puede ser negativo ni superar el total.
              </p>
            )}

            {montoPagoNum > 0.009 &&
              (contexto === 'pos' ? (
                <div className="rounded-lg bg-[#fdfaf6] border border-[#e4c9b0]/60 px-3 py-2 text-xs text-[#6f3a2a]">
                  Se paga en <strong>efectivo del turno</strong> (se descuenta al cerrar la caja).
                  {!turnoId && (
                    <span className="text-[#c43e2c] block mt-0.5">
                      No hay un turno abierto para registrar la compra.
                    </span>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="space-y-1.5">
                    <Label className="text-[#391511] font-medium text-sm">
                      Pagar desde <span className="text-[#c43e2c]">*</span>
                    </Label>
                    <Select value={cuentaId} onValueChange={elegirCuenta} disabled={procesando}>
                      <SelectTrigger className="border-[#e4c9b0] focus:ring-[#f9b44c] bg-white">
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

                  {/* Forma de pago + n° de comprobante (mig 155) */}
                  <div className="space-y-1.5">
                    <Label className="text-[11px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                      Forma de pago
                    </Label>
                    <div className="grid grid-cols-5 gap-1.5">
                      {FORMAS_PAGO.map((f) => (
                        <button
                          key={f.valor}
                          type="button"
                          onClick={() => setFormaPago(f.valor)}
                          disabled={procesando}
                          className={cn(
                            'rounded-lg border-2 py-1.5 text-[11px] font-semibold transition-all',
                            formaPago === f.valor
                              ? 'border-[#f9b44c] bg-[#f9b44c]/15 text-[#391511]'
                              : 'border-[#e4c9b0] bg-white text-[#6f3a2a] hover:border-[#c8a58a]'
                          )}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[11px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                      {labelComprobante(formaPago)}{' '}
                      {requiereComprobante(formaPago) ? (
                        <span className="text-[#c43e2c]">*</span>
                      ) : (
                        <span className="normal-case text-[#c8a58a] font-normal">
                          (opcional)
                        </span>
                      )}
                    </Label>
                    <Input
                      ref={comprobanteRef}
                      value={comprobantePago}
                      onChange={(e) => setComprobantePago(e.target.value)}
                      placeholder={
                        formaPago === 'transferencia'
                          ? 'N° de la transferencia (va a Egresos y a la conciliación)'
                          : 'N° de la operación, cheque o recibo'
                      }
                      disabled={procesando}
                      className={cn(
                        'h-9 focus-visible:ring-[#f9b44c]',
                        comprobanteFaltante ? bordeFalta : 'border-[#e4c9b0]'
                      )}
                    />
                    {comprobanteFaltante && (
                      <p className={cn('text-[10px]', clsFalta)}>
                        Poné el {labelComprobante(formaPago)}.
                      </p>
                    )}
                  </div>
                </div>
              ))}

            {hayDeuda && puedeDejarSaldo && (
              <div className="rounded-lg border border-[#e4c9b0]/60 bg-white px-3 py-2 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#6f3a2a]">
                  <span>
                    Queda a cuenta corriente de {nombreProveedor}:{' '}
                    <span className="font-bold tabular-nums text-[#391511]">
                      <MontoARS monto={saldoCC} />
                    </span>
                  </span>
                  <label className="flex items-center gap-1.5 font-semibold text-[#391511] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={usarCuotas}
                      onChange={(e) => setUsarCuotas(e.target.checked)}
                      className="accent-[#f9b44c] h-3.5 w-3.5"
                    />
                    En cuotas
                  </label>
                </div>
                {usarCuotas ? (
                  <EditorCuotas
                    objetivo={saldoCC}
                    cuotas={cuotas}
                    onChange={setCuotas}
                    condicionPago={proveedorSel?.condicion_pago ?? null}
                    deshabilitado={procesando}
                  />
                ) : (
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#6f3a2a]">
                    <span>
                      vence el <span className="text-[#c43e2c]">*</span>
                    </span>
                    <Input
                      type="date"
                      value={vencimientoCC}
                      onChange={(e) => setVencimientoCC(e.target.value)}
                      disabled={procesando}
                      className={cn(
                        'h-8 w-36 text-xs tabular-nums focus-visible:ring-[#f9b44c]',
                        !vencimientoCC ? bordeFalta : 'border-[#e4c9b0]'
                      )}
                    />
                    {!vencimientoCC && (
                      <span className={clsFalta}>Poné la fecha.</span>
                    )}
                  </div>
                )}
              </div>
            )}
            {hayDeuda && !puedeDejarSaldo && (
              <p className="text-[#c43e2c] text-xs">
                Dejar saldo a cuenta corriente requiere permiso de finanzas:
                pagá el total.
              </p>
            )}
          </div>
          </div>
        </div>

        <DialogFooter className="px-6 py-4 border-t border-[#e4c9b0]/60 bg-[#fdfaf6] shrink-0 flex-col sm:flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 w-full text-sm">
            <span className="text-[#6f3a2a]">
              Neto <MontoARS monto={neto} /> · IVA <MontoARS monto={ivaTotal} />
              {hayDeuda && (
                <span className="block text-[11px]">
                  Pagás ahora{' '}
                  <span className="font-semibold tabular-nums text-[#391511]">
                    <MontoARS monto={montoPagoNum} />
                  </span>{' '}
                  · queda a cta. cte.{' '}
                  <span className="font-semibold tabular-nums text-[#391511]">
                    <MontoARS monto={saldoCC} />
                  </span>
                  {usarCuotas && cuotas.length > 0
                    ? ` en ${cuotas.length} cuotas`
                    : ''}
                </span>
              )}
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
