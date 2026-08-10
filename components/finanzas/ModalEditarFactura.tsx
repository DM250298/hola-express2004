'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
  Wallet,
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
import { DrawerProducto } from '@/components/configuracion/productos/DrawerProducto'
import { usePedidoDetalle } from '@/lib/hooks/usePedidos'
import { useProductos } from '@/lib/hooks/useProductos'
import { useProveedores } from '@/lib/hooks/useProveedores'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { useCuentas } from '@/lib/hooks/useCuentas'
import {
  useAnularFacturaCompra,
  useFacturaCompra,
  useGuardarFacturaCompra,
} from '@/lib/hooks/useFacturasCompra'
import { usePricing } from '@/lib/hooks/usePricing'
import { calcularLinea } from '@/lib/queries/facturasCompra'
import { cn } from '@/lib/utils'
import type { ProductoConRelaciones } from '@/lib/queries/productos'
import {
  FORMAS_PAGO,
  FORMA_PAGO_LABEL,
  type FormaPago,
  type CuentaAPagarConProveedor,
} from '@/lib/queries/finanzas'
import type { ProveedorRow } from '@/types/database'

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
  /** Lo físicamente recibido (para mostrar recibido vs. facturado). null = extra. */
  cantidad_recibida: number | null
  cantidad: string
  costo: string
  descuento: string
  iva_compra: string
  margen: string
  iva_venta: string
  /**
   * Qué campo manda en el lado venta de ESTA fila:
   *  · 'margen' → el motor calcula el precio (y lo redondea al múltiplo de arriba)
   *  · 'precio' → el precio tipeado se respeta tal cual y el margen se deduce
   */
  modoVenta: 'margen' | 'precio'
  /** Precio final CON IVA tipeado a mano. Solo manda en modo 'precio'. */
  precio: string
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

/** Una fila del widget "Agregar pago" (migs 144/145). */
interface PagoLinea {
  key: string
  monto: string
  forma: FormaPago
  cuenta_id: string
  comprobante: string
  nota: string
}

function hoyIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** dd/mm/aaaa desde un ISO (para mostrar vencimiento y fecha de pago). */
function fechaCorta(iso: string | null): string {
  if (!iso) return '—'
  const [a, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${a}`
}

/** Redondeo a 2 decimales — mismo criterio que el RPC, para que el "Costo
 *  final" mostrado coincida al centavo con lo que se guarda. */
function r2(n: number): number {
  return Math.round(n * 100) / 100
}

function soloDigitos(s: string): string {
  return s.replace(/\D/g, '')
}

/** Valida un CUIT argentino: 11 dígitos + dígito verificador. */
function cuitValido(s: string): boolean {
  const d = soloDigitos(s)
  if (d.length !== 11) return false
  const mult = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
  const suma = mult.reduce((acc, m, i) => acc + m * Number(d[i]), 0)
  const resto = suma % 11
  const verif = resto === 0 ? 0 : resto === 1 ? 9 : 11 - resto
  return verif === Number(d[10])
}

const CABECERA_DEFAULT: CabeceraState = {
  // Vacío a propósito: lo completa el proveedor de la cuenta según su condición
  // de IVA (ver tipoDesdeCondicionIva); si no hay dato, cae a 'A'.
  tipo_comprobante: '',
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

/**
 * Campo numérico con etiqueta arriba — para las tarjetas en mobile, donde no
 * hay encabezado de columna que diga qué se está cargando. Input alto y
 * cómodo de tocar; teclado numérico en el celular.
 */
function CampoNumero({
  label,
  value,
  onChange,
  min,
  step,
  inputMode = 'decimal',
}: {
  label: string
  value: string
  onChange: (v: string) => void
  min?: string
  step?: string
  inputMode?: 'decimal' | 'numeric'
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[#6f3a2a]">
        {label}
      </span>
      <Input
        type="number"
        inputMode={inputMode}
        min={min}
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 w-full rounded-lg border-[#e4c9b0] px-2.5 text-left text-base tabular-nums"
      />
    </label>
  )
}

/**
 * Bajo el nombre de cada renglón del pedido: muestra lo RECIBIDO y avisa si la
 * cantidad facturada difiere → la factura ajustará el stock por esa diferencia.
 * No aplica a productos extra. (El vencimiento se carga en la recepción, que es
 * donde se tiene la mercadería a la vista; acá no se toca.)
 */
function InfoLineaRecepcion({
  recibida,
  cantidad,
  esExtra,
}: {
  recibida: number | null
  cantidad: string
  esExtra: boolean
}) {
  if (esExtra || recibida == null) return null
  const difiere = Number(cantidad) !== recibida
  return (
    <div className="mt-1">
      <span
        className={`text-[10px] font-medium ${
          difiere ? 'text-[#c43e2c]' : 'text-[#c8a58a]'
        }`}
        title={
          difiere
            ? 'Al guardar, el stock se ajusta por la diferencia entre lo facturado y lo recibido.'
            : undefined
        }
      >
        Recibido: {recibida}
        {difiere ? ' · ajusta stock' : ''}
      </span>
    </div>
  )
}

/**
 * Letra de comprobante que suele emitir un proveedor según su condición frente
 * al IVA (el receptor, Hola Express, es responsable inscripto). Es solo un
 * default editable: el administrativo puede cambiarlo si la factura dice otra.
 */
function tipoDesdeCondicionIva(cond: string | null | undefined): string {
  switch (cond) {
    case 'responsable_inscripto':
      return 'A'
    case 'monotributo':
    case 'exento':
    case 'consumidor_final':
      return 'C'
    default:
      return 'A'
  }
}

/**
 * Letra sugerida por la ficha del proveedor. Sin ficha resuelta devuelve ''
 * (y NO 'A'): si devolviera 'A', el effect de relleno la vería como un valor
 * ya puesto y no la corregiría cuando la ficha llegue tarde (un monotributista
 * quedaría clavado en A).
 */
function tipoSugerido(p: ProveedorRow | undefined): string {
  return p ? tipoDesdeCondicionIva(p.condicion_iva) : ''
}

export function ModalEditarFactura({ abierto, onCambioAbierto, cuenta }: Props) {
  const { data: usuario } = useUsuario()
  const { data: pedido, isLoading: cargandoPedido } = usePedidoDetalle(
    cuenta?.pedido_id ?? undefined
  )
  const { data: facturaGuardada, isLoading: cargandoFactura } =
    useFacturaCompra(cuenta?.id ?? null)
  const guardar = useGuardarFacturaCompra()
  const anular = useAnularFacturaCompra()
  const pricing = usePricing()

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
  // Gastos no debitables (flete, etc.): se prorratean al costo de los productos.
  const [gastosNoDebitables, setGastosNoDebitables] = useState('')
  // ── Pago integrado (migs 144/145): lista de pagos ─────────────────────
  // Sin filas = la deuda queda a cuenta corriente (comportamiento clásico).
  // Cada fila es un pago independiente (importe, método, cuenta, comprobante,
  // nota); todos se ejecutan EN ORDEN dentro de la transacción del guardado.
  const [pagosLineas, setPagosLineas] = useState<PagoLinea[]>([])
  const pagoKeyRef = useRef(0)
  // Fecha única para todos los pagos del guardado (default hoy, nunca futura).
  const [fechaPago, setFechaPago] = useState(hoyIso())
  // Vencimiento de la deuda, editable acá (al cargar la factura se ve el
  // vencimiento real del comprobante). Solo se guarda si lo cambian.
  const [vencimientoCC, setVencimientoCC] = useState('')
  const { data: cuentasTesoreria } = useCuentas(true)

  const { data: productosBusqueda } = useProductos({
    activo: true,
    busqueda: busqueda || undefined,
  })

  // Catálogo completo (activos) → mapa por id para marcar qué línea es un
  // producto "pendiente de precio" (alta al vuelo) y poder corregirlo.
  const { data: catalogoProductos } = useProductos({ activo: true })
  const productosMap = useMemo(() => {
    const m = new Map<number, ProductoConRelaciones>()
    for (const p of catalogoProductos ?? []) m.set(p.id, p)
    return m
  }, [catalogoProductos])
  const [productoEditar, setProductoEditar] =
    useState<ProductoConRelaciones | null>(null)

  /**
   * Margen a precargar en una línea: el margen guardado del producto (desde
   * el repricing del motor, cada producto tiene el suyo) o el default. Es
   * best-effort: si el catálogo todavía no cargó, cae al default y el
   * usuario lo puede ajustar a mano.
   */
  function margenInicial(productoId: number): string {
    const m = productosMap.get(productoId)?.margen
    return m && m > 0 ? String(m) : DEFAULTS.margen
  }

  // Ficha del proveedor de la cuenta → autocompleta el comprobante y se muestra
  // en la tarjeta de arriba (razón social).
  const { data: proveedores } = useProveedores()
  const proveedorCuenta = useMemo(
    () => proveedores?.find((p) => p.id === cuenta?.proveedor_id),
    [proveedores, cuenta?.proveedor_id]
  )
  // Derivados PRIMITIVOS para el effect de relleno: `proveedorCuenta` cambia de
  // identidad en cada refetch de la lista aunque el dato sea idéntico (find
  // sobre un array nuevo = objeto nuevo), y el useMemo no lo evita.
  const hayFicha = proveedorCuenta != null
  const provCuit = proveedorCuenta?.cuit ?? ''
  const provCondIva = proveedorCuenta?.condicion_iva ?? ''

  function setCabCampo(campo: keyof CabeceraState, valor: string) {
    setCab((prev) => ({ ...prev, [campo]: valor }))
  }

  const items = useMemo(() => pedido?.items ?? [], [pedido])
  const cargando = cargandoPedido || cargandoFactura

  // Init del modal, en DOS bloques con guards independientes (van en el mismo
  // effect para no depender del orden de declaración entre effects):
  //
  //  (1) CABECERA — no depende de ninguna query, así que corre apenas se abre.
  //      Si esperara a que resuelvan pedido/factura/pricing, borraría lo que el
  //      administrativo tipeó mientras las líneas estaban en skeleton (los
  //      campos de arriba se renderizan siempre, no tienen skeleton).
  //  (2) LÍNEAS — recién con todo resuelto. Su guard es el que impide que una
  //      query que resuelve tarde pise lo ya tipeado en los renglones.
  const initRef = useRef<string | null>(null)
  const cabRef = useRef<string | null>(null)
  useEffect(() => {
    if (!abierto) {
      initRef.current = null
      cabRef.current = null
      return
    }
    const claveInit = `c${cuenta?.id ?? 0}`

    // ── (1) Cabecera + percepciones + gastos ──────────────────────────
    // `proveedorCuenta` se lee del closure a propósito (no es dep): el effect
    // que se ejecuta es el del render que lo agendó, así que ve el valor
    // actual. Si la lista de proveedores resuelve DESPUÉS, completa el effect
    // de relleno de más abajo.
    if (cabRef.current !== claveInit) {
      cabRef.current = claveInit
      setCab({
        ...CABECERA_DEFAULT,
        cuit_proveedor: proveedorCuenta?.cuit ?? '',
        tipo_comprobante: tipoSugerido(proveedorCuenta),
      })
      setPercepciones({ iibb: '', iva: '', otros: '' })
      setGastosNoDebitables('')
      // Pago integrado: cada apertura arranca sin pagos (cuenta corriente).
      setPagosLineas([])
      setFechaPago(hoyIso())
      setVencimientoCC(cuenta?.fecha_vencimiento?.slice(0, 10) ?? '')
    }

    // ── (2) Líneas ────────────────────────────────────────────────────
    //  · Con factura guardada → reconstruir lo que se había facturado.
    //  · Sin factura → SOLO los productos efectivamente recibidos (lo que el
    //    proveedor entregó); el resto se agrega a mano con el buscador.
    if (cargando || pricing.cargando) return
    if (initRef.current === claveInit) return
    initRef.current = claveInit
    let nuevas: LineaFactura[]
    if (facturaGuardada && facturaGuardada.items.length > 0) {
      // Factor de gastos con el que se guardó esta factura: hace falta para
      // reconstruir el costo landed y detectar si el precio guardado fue puesto
      // a mano (no coincide con el que sale del margen).
      const netoGuardado = facturaGuardada.items.reduce((acc, g) => {
        const neto = r2(
          Number(g.costo_sin_iva) * (1 - Number(g.descuento_porcentaje) / 100)
        )
        return acc + neto * Number(g.cantidad)
      }, 0)
      const gastosGuardados = Number(
        facturaGuardada.factura.gastos_no_debitables ?? 0
      )
      const factorGuardado =
        netoGuardado > 0 ? 1 + gastosGuardados / netoGuardado : 1
      // Las facturas de este flujo siempre tienen producto (las líneas sin
      // producto son solo de la compra directa, que no se edita acá).
      nuevas = facturaGuardada.items
        .filter(
          (g): g is typeof g & { producto_id: number } => g.producto_id != null
        )
        .map((g) => {
          const it = items.find((i) => i.producto_id === g.producto_id)
          // ¿El precio guardado salió del margen o lo puso alguien a mano?
          // Mismo criterio que el drawer de producto: si difiere del que
          // recalcula el motor, la línea vuelve en modo precio con el valor
          // GUARDADO (nunca el recalculado, que subiría por el redondeo).
          const costoLanded = r2(
            r2(
              Number(g.costo_sin_iva) *
                (1 - Number(g.descuento_porcentaje) / 100)
            ) * factorGuardado
          )
          const recalc = pricing.calcular(
            costoLanded,
            Number(g.margen_porcentaje) || 0,
            Number(g.iva_venta_porcentaje) || 0
          )
          const precioGuardado = Number(g.precio_con_iva) || 0
          const esPrecioManual =
            recalc.desglose != null &&
            precioGuardado > 0 &&
            Math.abs(precioGuardado - recalc.desglose.precioRedondeado) > 0.5
          return {
            key: `prod-${g.producto_id}`,
            item_pedido_id: it?.id ?? null,
            producto_id: g.producto_id,
            nombre: it?.producto?.nombre ?? `Producto #${g.producto_id}`,
            codigo_barras: it?.producto?.codigo_barras ?? null,
            cantidad_recibida: it?.cantidad_recibida ?? null,
            cantidad: String(g.cantidad),
            costo: String(g.costo_sin_iva),
            descuento: String(g.descuento_porcentaje),
            iva_compra: String(g.iva_compra_porcentaje),
            margen: String(g.margen_porcentaje),
            iva_venta: String(g.iva_venta_porcentaje),
            modoVenta: (esPrecioManual ? 'precio' : 'margen') as
              | 'margen'
              | 'precio',
            precio: esPrecioManual ? String(precioGuardado) : '',
          }
        })
    } else {
      // Solo los renglones imputados a ESTA factura/deuda (multi-factura).
      // Fallback para pedidos viejos (pre multi-factura): si ningún renglón tiene
      // cuenta imputada, se muestran todos los recibidos (comportamiento anterior).
      // Orden = el del papel de la factura: la recepción guarda la secuencia de
      // escaneo en orden_recepcion (mig 137); sin ese dato (pedidos viejos) se
      // cae al orden por id de siempre.
      const hayImputacion = items.some((it) => it.cuenta_a_pagar_id != null)
      nuevas = [...items]
        .filter((it) => (it.cantidad_recibida ?? 0) > 0)
        .filter((it) => !hayImputacion || it.cuenta_a_pagar_id === cuenta?.id)
        .sort(
          (a, b) =>
            (a.orden_recepcion ?? Number.MAX_SAFE_INTEGER) -
              (b.orden_recepcion ?? Number.MAX_SAFE_INTEGER) || a.id - b.id
        )
        .map((it) => ({
          key: `prod-${it.producto_id}`,
          item_pedido_id: it.id,
          producto_id: it.producto_id,
          nombre: it.producto?.nombre ?? 'Producto eliminado',
          codigo_barras: it.producto?.codigo_barras ?? null,
          cantidad_recibida: it.cantidad_recibida ?? null,
          // Baseline: si ya se facturó una vez, arranca de lo facturado (así
          // re-guardar es delta 0); si no, de lo recibido.
          cantidad: String(it.cantidad_facturada ?? it.cantidad_recibida ?? 0),
          costo: String(it.precio_costo || 0),
          ...DEFAULTS,
          margen: margenInicial(it.producto_id),
          modoVenta: 'margen' as const,
          precio: '',
        }))
    }
    setLineas(nuevas)
    setBusqueda('')
    // La cabecera solo se pisa cuando HAY factura guardada (ahí el dato del
    // comprobante manda). Sin factura ya quedó lista en el bloque (1), y lo que
    // se haya tipeado mientras cargaban las líneas tiene que sobrevivir.
    if (facturaGuardada) {
      setAfectaVenta(facturaGuardada.factura.afecta_precio_venta)
      const f = facturaGuardada.factura
      setCab({
        tipo_comprobante: f.tipo_comprobante || tipoSugerido(proveedorCuenta),
        punto_venta: f.punto_venta ?? '',
        numero_comprobante: f.numero_comprobante ?? '',
        cae: f.cae ?? '',
        // El CUIT de la FACTURA manda: puede diferir del de la ficha (el
        // proveedor facturó con otro) y es el que va al Libro IVA.
        cuit_proveedor: f.cuit_proveedor || proveedorCuenta?.cuit || '',
        fecha_emision: f.fecha ?? hoyIso(),
      })
      setPercepciones({
        iibb: f.percepcion_iibb ? String(f.percepcion_iibb) : '',
        iva: f.percepcion_iva ? String(f.percepcion_iva) : '',
        otros: f.percepcion_otros ? String(f.percepcion_otros) : '',
      })
      setGastosNoDebitables(
        f.gastos_no_debitables ? String(f.gastos_no_debitables) : ''
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, cargando, pricing.cargando, facturaGuardada, cuenta?.id])

  // Rellena la cabecera con la ficha del proveedor cuando la lista resuelve
  // DESPUÉS de la init. Solo completa lo VACÍO: nunca pisa lo tipeado ni lo
  // que vino de una factura guardada. Deps primitivas para no re-correr en
  // cada refetch de la lista de proveedores.
  useEffect(() => {
    if (!abierto || !hayFicha) return
    setCab((prev) => ({
      ...prev,
      cuit_proveedor: prev.cuit_proveedor || provCuit,
      tipo_comprobante:
        prev.tipo_comprobante || tipoDesdeCondicionIva(provCondIva),
    }))
  }, [abierto, hayFicha, provCuit, provCondIva])

  function setLineaCampo(key: string, campo: CampoEditable, valor: string) {
    setLineas((prev) =>
      prev.map((l) => (l.key === key ? { ...l, [campo]: valor } : l))
    )
  }

  /** Tocar el margen hace que ESTE campo mande: el precio vuelve a calcularse. */
  function setMargenLinea(key: string, valor: string) {
    setLineas((prev) =>
      prev.map((l) =>
        l.key === key ? { ...l, margen: valor, modoVenta: 'margen' } : l
      )
    )
  }

  /** Tipear el precio lo fija: se respeta tal cual y el margen se deduce. */
  function setPrecioLinea(key: string, valor: string) {
    setLineas((prev) =>
      prev.map((l) =>
        l.key === key ? { ...l, precio: valor, modoVenta: 'precio' } : l
      )
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
        cantidad_recibida: it?.cantidad_recibida ?? null,
        cantidad:
          it?.cantidad_facturada != null
            ? String(it.cantidad_facturada)
            : it?.cantidad_recibida
              ? String(it.cantidad_recibida)
              : '1',
        costo: String((it?.precio_costo ?? p.precio_costo ?? 0) || 0),
        ...DEFAULTS,
        margen: margenInicial(p.id),
        modoVenta: 'margen' as const,
        precio: '',
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

  // Gastos no debitables (flete, etc.): se prorratean al costo de cada
  // producto por su neto, idéntico al RPC fn_guardar_factura_compra (mig. 086).
  // Hay que calcular el factor ANTES de las líneas para que el "Costo final" y
  // el precio reflejen el prorrateo en pantalla (WYSIWYG con lo que se guarda).
  // Se redondea a 2 decimales igual que el RPC (v_gastos := round(...)), para
  // que el factor —y todo lo derivado: costo final, precio, total— coincida al
  // centavo con lo que se guarda, incluso si pegan un valor con más decimales.
  const gastos = r2(Number(gastosNoDebitables) || 0)
  // Neto gravado (sin gastos) = base del prorrateo. Se redondea cada línea como
  // en el RPC para que el factor —y por ende el costo final— coincidan al centavo.
  const netoGravado = r2(
    lineas.reduce((acc, l) => {
      const costoNeto = r2(
        (Number(l.costo) || 0) * (1 - (Number(l.descuento) || 0) / 100)
      )
      return acc + costoNeto * (Number(l.cantidad) || 0)
    }, 0)
  )
  const factorGastos = netoGravado > 0 ? 1 + gastos / netoGravado : 1
  const factorGastosPct = (factorGastos - 1) * 100
  // Hay prorrateo efectivo → se muestra la columna/línea "Costo final".
  const hayGastos = gastos > 0 && factorGastos > 1

  // Cálculo por línea (ya con el prorrateo de gastos en costo final y precio).
  const calculadas = lineas.map((l) => {
    const cantidad = Number(l.cantidad) || 0
    const calc = calcularLinea(
      {
        costo_sin_iva: Number(l.costo) || 0,
        descuento_porcentaje: Number(l.descuento) || 0,
        iva_compra_porcentaje: Number(l.iva_compra) || 0,
        margen_porcentaje: Number(l.margen) || 0,
        iva_venta_porcentaje: Number(l.iva_venta) || 0,
      },
      factorGastos
    )
    // Lado venta, dos vías (espejo del RPC v13, mig 138):
    //  · modo margen → el MOTOR calcula el precio (margen asegurado neto de
    //    IIBB + imp. créd/déb + comisión MP) y lo redondea al múltiplo de arriba.
    //  · modo precio → el precio tipeado manda y se DEDUCE el margen real.
    if (l.modoVenta === 'precio') {
      const precioFinal = Number(l.precio) || 0
      const inv = pricing.calcularDesdePrecio(
        precioFinal,
        calc.costoFinal,
        Number(l.iva_venta) || 0
      )
      // `desglose.margen` viene como FRACCIÓN (y es null si el costo es 0).
      const margenPct =
        inv.desglose?.margen != null ? r2(inv.desglose.margen * 100) : null
      const error =
        inv.error ??
        (precioFinal <= 0
          ? 'Poné un precio, o tocá el margen para volver al automático.'
          : margenPct == null
            ? 'Sin costo no se puede deducir el margen de ese precio.'
            : null)
      return {
        l,
        calc,
        cantidad,
        venta: null,
        precioFinal,
        margenPct,
        error,
      }
    }
    const venta = pricing.calcular(
      calc.costoFinal,
      Number(l.margen) || 0,
      Number(l.iva_venta) || 0
    )
    return {
      l,
      calc,
      cantidad,
      venta,
      precioFinal: venta.desglose?.precioRedondeado ?? 0,
      margenPct: Number(l.margen) || 0,
      error: venta.error,
    }
  })
  // Con un divisor inválido (cargas > 100%), un precio vacío o un costo 0 en
  // modo precio, el par precio/margen no cierra: se bloquea el guardado y se
  // muestra el error en la línea.
  const hayErrorPrecio = calculadas.some((c) => c.error !== null)

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
  const totalConIva =
    totales.neto + totales.iva + totalPercepciones + gastos

  // ── Derivados del pago integrado (migs 144/145) ───────────────────────
  const cuentaPagada = cuenta?.estado === 'pagada'
  const yaPagado = cuenta?.monto_pagado ?? 0
  // Aplicado (pagado − sobrantes de redondeo): la definición de pendiente del
  // server. Contra monto_pagado, un sobrepago histórico subestimaría el saldo.
  const yaAplicado = cuenta?.monto_aplicado ?? yaPagado
  // Lo que falta pagar contra el total que se está por guardar (vivo: sigue
  // los cambios de líneas/percepciones/gastos).
  const pendientePago = Math.max(0, r2(totalConIva - yaAplicado))
  // El Select de base-ui necesita `items` (value → label) para que el trigger
  // muestre el nombre de la cuenta y no el id crudo.
  const itemsCuentaPago = useMemo(() => {
    const r: Record<string, string> = {}
    for (const c of cuentasTesoreria ?? []) r[String(c.id)] = c.nombre
    return r
  }, [cuentasTesoreria])
  const hayPagos = pagosLineas.length > 0
  const totalPagos = r2(
    pagosLineas.reduce((acc, f) => acc + (Number(f.monto) || 0), 0)
  )
  // Saldo que queda a cuenta corriente tras estos pagos (negativo = sobrepago).
  const saldoRestante = r2(pendientePago - totalPagos)
  const sobrantePago = saldoRestante < -0.009 ? r2(-saldoRestante) : 0
  const sobrantePagoGrande =
    sobrantePago > Math.max(1000, r2(pendientePago * 0.01))
  // Solo la ÚLTIMA fila puede cubrir/sobrepasar el total: un pago posterior a
  // uno que ya dejó la deuda 'pagada' es rechazado por el server (abortaría
  // todo el guardado), así que se bloquea acá con mensaje claro.
  const ordenInvalido = (() => {
    let acumulado = 0
    for (let i = 0; i < pagosLineas.length; i++) {
      acumulado += Number(pagosLineas[i].monto) || 0
      if (i < pagosLineas.length - 1 && acumulado >= pendientePago - 0.009)
        return true
    }
    return false
  })()
  // Débitos agregados por cuenta (dos filas pueden salir de la misma cuenta):
  // el saldo resultante se evalúa sobre la SUMA, no fila por fila.
  const avisosCuentas = useMemo(() => {
    const porCuenta = new Map<string, number>()
    for (const f of pagosLineas) {
      if (!f.cuenta_id) continue
      porCuenta.set(
        f.cuenta_id,
        (porCuenta.get(f.cuenta_id) ?? 0) + (Number(f.monto) || 0)
      )
    }
    return [...porCuenta.entries()].flatMap(([id, monto]) => {
      const c = (cuentasTesoreria ?? []).find((x) => String(x.id) === id)
      if (!c) return []
      const despues = r2(Number(c.saldo_actual) - monto)
      return [
        {
          nombre: c.nombre,
          despues,
          negativa: despues < -0.009,
          boveda: c.es_caja_fuerte ?? false,
        },
      ]
    })
  }, [pagosLineas, cuentasTesoreria])
  const bovedaNegativa = avisosCuentas.some((a) => a.negativa && a.boveda)
  const filaIncompleta = pagosLineas.some(
    (f) => !f.cuenta_id || (Number(f.monto) || 0) <= 0
  )
  // Con los pagos previos cubriendo el total no hay nada que pagar: el server
  // rechazaría cualquier monto y abortaría también la factura.
  const deudaCubierta = !cuentaPagada && pendientePago <= 0 && yaPagado > 0.009
  // Bloquea el guardado: filas incompletas, bóveda en negativo o una fila
  // intermedia que ya cubre el total.
  const pagoInvalido =
    hayPagos &&
    (filaIncompleta || bovedaNegativa || ordenInvalido || deudaCubierta)

  function agregarPagoLinea() {
    pagoKeyRef.current += 1
    setPagosLineas((prev) => [
      ...prev,
      {
        key: `p${pagoKeyRef.current}`,
        // Precargado con lo que falta cubrir (editable).
        monto: saldoRestante > 0 ? String(saldoRestante) : '',
        forma: 'transferencia',
        cuenta_id: '',
        comprobante: '',
        nota: '',
      },
    ])
  }

  function setPagoCampo(
    key: string,
    campo: 'monto' | 'comprobante' | 'nota',
    valor: string
  ) {
    setPagosLineas((prev) =>
      prev.map((f) => (f.key === key ? { ...f, [campo]: valor } : f))
    )
  }

  function elegirCuentaPagoLinea(key: string, id: string) {
    // Al elegir la cuenta se sugiere la forma de pago por su tipo (editable).
    const c = (cuentasTesoreria ?? []).find((x) => String(x.id) === id)
    setPagosLineas((prev) =>
      prev.map((f) =>
        f.key === key
          ? {
              ...f,
              cuenta_id: id,
              forma: c
                ? c.tipo === 'caja'
                  ? 'efectivo'
                  : 'transferencia'
                : f.forma,
            }
          : f
      )
    )
  }

  function setFormaPagoLinea(key: string, forma: FormaPago) {
    setPagosLineas((prev) =>
      prev.map((f) => (f.key === key ? { ...f, forma } : f))
    )
  }

  function quitarPagoLinea(key: string) {
    setPagosLineas((prev) => prev.filter((f) => f.key !== key))
  }

  // Validación de los datos formales (solo si el usuario cargó algo).
  const cuitError =
    cab.cuit_proveedor.trim() !== '' && !cuitValido(cab.cuit_proveedor)
  const ptoError =
    cab.punto_venta.trim() !== '' && !/^\d{1,5}$/.test(cab.punto_venta.trim())
  const nroError =
    cab.numero_comprobante.trim() !== '' &&
    !/^\d{1,8}$/.test(cab.numero_comprobante.trim())
  const hayErroresCab = cuitError || ptoError || nroError

  // ── Ficha del proveedor: lo que se muestra y el aviso de datos faltantes ──
  // La ficha viva manda; `cuenta.proveedor_nombre` (del embed) es el fallback
  // para que el nombre no parpadee mientras la lista resuelve.
  const nombreProveedor =
    proveedorCuenta?.nombre || cuenta?.proveedor_nombre || 'Sin asignar'
  const razonSocial = (proveedorCuenta?.razon_social ?? '').trim()
  // El aviso solo sale con la ficha YA resuelta: sin eso parpadearía en cada
  // apertura, y no podemos afirmar nada de una ficha que no leímos (proveedor
  // borrado, o que no está en la lista).
  const faltaRazonSocial = hayFicha && razonSocial === ''
  // El CUIT tipeado completa la ficha sola al guardar (completarCuitProveedor),
  // pero SOLO si es válido de 11 dígitos: hasta entonces el aviso se queda.
  const avisarCuit =
    hayFicha && provCuit.trim() === '' && !cuitValido(cab.cuit_proveedor)
  const avisoFicha = faltaRazonSocial || avisarCuit

  function handleGuardar() {
    if (!pedido || !cuenta || !usuario || guardar.isPending) return
    if (lineas.length === 0) return
    if (hayErroresCab) {
      toast.error('Revisá los datos del comprobante (CUIT o número).')
      return
    }
    if (hayErrorPrecio) {
      toast.error(
        'Revisá el precio de venta de las líneas marcadas en rojo.'
      )
      return
    }
    if (pagoInvalido) {
      toast.error(
        bovedaNegativa
          ? 'Los pagos dejan la caja fuerte en negativo: bajá el monto o elegí otra cuenta.'
          : ordenInvalido
            ? 'Los pagos anteriores ya cubren el total: borrá o bajá el último pago.'
            : deudaCubierta
              ? 'La deuda ya está cubierta por los pagos registrados: guardá la factura sin pagos.'
              : 'Completá la cuenta y el importe de cada pago.'
      )
      return
    }
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
        gastos_no_debitables: gastos,
        comprobante: {
          tipo_comprobante: cab.tipo_comprobante || null,
          punto_venta: limpio(cab.punto_venta),
          numero_comprobante: limpio(cab.numero_comprobante),
          cae: limpio(cab.cae),
          cuit_proveedor: limpio(cab.cuit_proveedor),
        },
        lineas: calculadas.map(({ l, cantidad, margenPct }) => ({
          item_pedido_id: l.item_pedido_id,
          producto_id: l.producto_id,
          cantidad,
          costo_sin_iva: Number(l.costo) || 0,
          descuento_porcentaje: Number(l.descuento) || 0,
          iva_compra_porcentaje: Number(l.iva_compra) || 0,
          // En modo precio manda el precio: el margen viaja informativo (el
          // RPC lo re-deduce del precio, que es la fuente de verdad).
          margen_porcentaje: margenPct ?? 0,
          iva_venta_porcentaje: Number(l.iva_venta) || 0,
          precio_venta:
            l.modoVenta === 'precio' ? r2(Number(l.precio) || 0) : null,
        })),
        // Pagos en el mismo acto (mig 145): se aplican en orden, todos con la
        // misma fecha (default hoy, nunca futura) — independiente de la fecha
        // de emisión; el guard de período cerrado del server la valida.
        pagos:
          hayPagos && !cuentaPagada
            ? pagosLineas.map((f) => ({
                cuenta_origen_id: Number(f.cuenta_id),
                monto: r2(Number(f.monto) || 0),
                forma_pago: f.forma,
                comprobante: f.comprobante.trim() || null,
                fecha: fechaPago || hoyIso(),
                nota: f.nota.trim() || null,
              }))
            : null,
        // Vencimiento ajustado desde el modal: solo viaja si lo cambiaron
        // (y la deuda sigue viva).
        fecha_vencimiento:
          !cuentaPagada &&
          vencimientoCC &&
          vencimientoCC !== (cuenta.fecha_vencimiento ?? '').slice(0, 10)
            ? vencimientoCC
            : undefined,
      },
      { onSuccess: () => onCambioAbierto(false) }
    )
  }

  function handleAnular() {
    if (!cuenta || !usuario || anular.isPending || guardar.isPending) return
    const ok = window.confirm(
      'Anular esta factura?\n\nSe revierte el stock que ingresó (vuelve a lo recibido), ' +
        'la deuda vuelve a provisoria y se borra el asiento contable. No se puede deshacer.'
    )
    if (!ok) return
    anular.mutate(
      { cuentaId: cuenta.id, usuarioId: usuario.id },
      { onSuccess: () => onCambioAbierto(false) }
    )
  }

  const inputCls =
    'h-8 w-full text-right tabular-nums border-[#e4c9b0] text-xs px-1.5'

  return (
    <>
    <Dialog
      open={abierto}
      onOpenChange={(v) =>
        !guardar.isPending && !anular.isPending && onCambioAbierto(v)
      }
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
            IVA). <span className="font-semibold text-[#9e6b15]">Al guardar, si
            cambiás una cantidad se ajusta el stock por la diferencia contra lo
            recibido.</span>
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-auto px-6 py-5 space-y-4">
          {/* Ficha del proveedor: lo que va a salir en el comprobante y en el
              Libro IVA. Read-only a propósito — la fuente de verdad es
              Configuración › Proveedores. */}
          <div className="rounded-xl border border-[#e4c9b0]/60 bg-[#fdfaf6] p-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6f3a2a]">
                  Proveedor
                </span>
                <span className="block truncate text-base font-bold leading-tight text-[#391511]">
                  {nombreProveedor}
                </span>
                {razonSocial && (
                  <span className="mt-0.5 block text-xs text-[#6f3a2a]">
                    Razón social:{' '}
                    <span className="font-medium text-[#391511]">
                      {razonSocial}
                    </span>
                  </span>
                )}
              </div>
              <label className="flex shrink-0 items-center gap-2 text-sm text-[#391511]">
                <Switch checked={afectaVenta} onCheckedChange={setAfectaVenta} />
                Afectar precio de venta
              </label>
            </div>

            {avisoFicha && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-[#f9b44c]/50 bg-[#f9b44c]/15 px-3 py-2">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#9e6b15]" />
                <div className="min-w-0 space-y-0.5 text-[11px] leading-snug text-[#6f3a2a]">
                  <p className="font-semibold text-[#391511]">
                    La ficha de {nombreProveedor} está incompleta
                  </p>
                  {faltaRazonSocial && (
                    <p>
                      Le falta la <strong>razón social</strong>. Cargala en
                      Configuración › Proveedores: es la que sale en el Libro
                      IVA y, si está vacía, sale el nombre de fantasía.
                    </p>
                  )}
                  {avisarCuit && (
                    <p>
                      Le falta el <strong>CUIT</strong>. El que pongas acá abajo
                      queda guardado en la ficha al guardar la factura.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
          <p className="text-[11px] text-[#c8a58a] -mt-2">
            Poné el <strong>margen</strong> y el precio se calcula solo
            (asegura el margen después de IIBB, imp. créd/déb y la comisión de
            Mercado Pago —peor caso—, y redondea para arriba
            {pricing.config
              ? ` a múltiplos de $${pricing.config.redondeoMultiplo}`
              : ''}
            ), o tipeá el <strong>precio de venta</strong> que querés y el
            margen real se deduce solo.
          </p>

          {/* Comprobante escaneado en la recepción (se puede agregar más acá) */}
          <GaleriaComprobantes
            pedidoId={cuenta?.pedido_id ?? undefined}
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
                    <SelectValue placeholder="Elegí" />
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
                  className={`h-8 bg-white text-xs tabular-nums ${
                    ptoError ? 'border-[#c43e2c]' : 'border-[#e4c9b0]'
                  }`}
                />
                {ptoError && (
                  <p className="text-[9px] text-[#c43e2c]">Solo números (hasta 5 dígitos).</p>
                )}
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
                  className={`h-8 bg-white text-xs tabular-nums ${
                    nroError ? 'border-[#c43e2c]' : 'border-[#e4c9b0]'
                  }`}
                />
                {nroError && (
                  <p className="text-[9px] text-[#c43e2c]">Solo números (hasta 8 dígitos).</p>
                )}
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
                  className={`h-8 bg-white text-xs tabular-nums ${
                    cuitError ? 'border-[#c43e2c]' : 'border-[#e4c9b0]'
                  }`}
                />
                {cuitError && (
                  <p className="text-[9px] text-[#c43e2c]">CUIT inválido (11 dígitos).</p>
                )}
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
            <>
            {/* Mobile (< md): cada línea como tarjeta apilada, compra arriba y
                venta abajo, para no tener que hacer scroll horizontal. */}
            <div className="space-y-3 md:hidden">
              {calculadas.map(({ l, calc, venta, cantidad, precioFinal, margenPct, error }) => (
                <div
                  key={l.key}
                  className="overflow-hidden rounded-xl border border-[#e4c9b0] bg-white"
                >
                  {/* Encabezado: nombre del producto + quitar */}
                  <div className="flex items-start justify-between gap-2 border-b border-[#e4c9b0]/60 bg-[#fdfaf6] px-3 py-2.5">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold leading-tight text-[#391511]">
                        {l.nombre}
                      </div>
                      {l.codigo_barras && (
                        <span className="mt-0.5 block font-mono text-[10px] text-[#c8a58a]">
                          {l.codigo_barras}
                        </span>
                      )}
                      {l.item_pedido_id === null && (
                        <span className="mt-0.5 inline-block text-[10px] font-semibold text-[#9e6b15]">
                          Extra (no pedido)
                        </span>
                      )}
                      {productosMap.get(l.producto_id)?.pendiente_precio && (
                        <span className="mt-0.5 ml-1 inline-block text-[10px] font-semibold uppercase tracking-wider text-[#c43e2c] bg-[#c43e2c]/12 rounded-full px-1.5 py-0.5">
                          Nuevo · completá precio
                        </span>
                      )}
                      <InfoLineaRecepcion
                        recibida={l.cantidad_recibida}
                        cantidad={l.cantidad}
                        esExtra={l.item_pedido_id === null}
                      />
                    </div>
                    <div className="flex shrink-0 items-center">
                      <button
                        type="button"
                        onClick={() => {
                          const p = productosMap.get(l.producto_id)
                          if (p) setProductoEditar(p)
                        }}
                        title="Editar producto (nombre, código, etc.)"
                        className="rounded-lg p-2 text-[#c8a58a] transition-colors hover:bg-white hover:text-[#6f3a2a]"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => quitarLinea(l.key)}
                        title="Quitar de la factura"
                        className="-mr-1 rounded-lg p-2 text-[#c8a58a] transition-colors hover:bg-white hover:text-[#c43e2c]"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {/* COMPRA */}
                  <div className="px-3 pb-3 pt-2.5">
                    <span className="mb-2 inline-block rounded bg-[#6f3a2a] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#f9d2a2]">
                      Compra
                    </span>
                    <div className="grid grid-cols-2 gap-2.5">
                      <CampoNumero
                        label="Cantidad"
                        value={l.cantidad}
                        onChange={(v) => setLineaCampo(l.key, 'cantidad', v)}
                        min="0"
                        step="1"
                        inputMode="numeric"
                      />
                      <CampoNumero
                        label="Costo s/IVA"
                        value={l.costo}
                        onChange={(v) => setLineaCampo(l.key, 'costo', v)}
                        min="0"
                        step="0.01"
                      />
                      <CampoNumero
                        label="Desc. %"
                        value={l.descuento}
                        onChange={(v) => setLineaCampo(l.key, 'descuento', v)}
                        min="0"
                      />
                      <CampoNumero
                        label="IVA compra %"
                        value={l.iva_compra}
                        onChange={(v) => setLineaCampo(l.key, 'iva_compra', v)}
                        min="0"
                      />
                    </div>
                    <div className="mt-2.5 flex items-center justify-between border-t border-[#e4c9b0]/60 pt-2 text-xs">
                      <span className="text-[#6f3a2a]">Subtotal neto</span>
                      <span className="font-medium text-[#6f3a2a]">
                        <MontoARS monto={calc.costoNeto * cantidad} />
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-xs">
                      <span className="text-[#6f3a2a]">Costo c/IVA (unit.)</span>
                      <span className="font-semibold text-[#391511]">
                        <MontoARS monto={calc.costoConIva} />
                      </span>
                    </div>
                    {hayGastos && (
                      <div className="mt-1.5 flex items-center justify-between rounded-md bg-[#f9b44c]/15 px-2 py-1 text-xs">
                        <span className="font-medium text-[#6f3a2a]">
                          Costo final s/IVA (c/gastos)
                        </span>
                        <span className="font-bold text-[#391511]">
                          <MontoARS monto={calc.costoFinal} />
                        </span>
                      </div>
                    )}
                  </div>

                  {/* VENTA */}
                  <div className="border-t border-[#e4c9b0]/60 bg-[#fdfaf6] px-3 pb-3 pt-2.5">
                    <span className="mb-2 inline-block rounded bg-[#c43e2c] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#f9d2a2]">
                      Venta
                    </span>
                    <div className="grid grid-cols-2 gap-2.5">
                      <CampoNumero
                        label={
                          l.modoVenta === 'precio' ? 'Margen % (real)' : 'Margen %'
                        }
                        value={
                          l.modoVenta === 'margen'
                            ? l.margen
                            : margenPct != null
                              ? String(margenPct)
                              : ''
                        }
                        onChange={(v) => setMargenLinea(l.key, v)}
                      />
                      <CampoNumero
                        label="Precio venta $"
                        value={
                          l.modoVenta === 'precio'
                            ? l.precio
                            : venta?.desglose
                              ? String(venta.desglose.precioRedondeado)
                              : ''
                        }
                        onChange={(v) => setPrecioLinea(l.key, v)}
                        min="0"
                        step="0.01"
                      />
                      <CampoNumero
                        label="IVA venta %"
                        value={l.iva_venta}
                        onChange={(v) => setLineaCampo(l.key, 'iva_venta', v)}
                        min="0"
                      />
                    </div>
                    {error ? (
                      <p className="mt-2.5 border-t border-[#e4c9b0]/60 pt-2 text-xs text-[#c43e2c]">
                        {error}
                      </p>
                    ) : l.modoVenta === 'precio' ? (
                      <div className="mt-2.5 flex items-center justify-between border-t border-[#e4c9b0]/60 pt-2 text-xs">
                        <span className="text-[#6f3a2a]">
                          Precio fijado a mano
                        </span>
                        <span
                          className={
                            (margenPct ?? 0) < 0
                              ? 'font-semibold text-[#c43e2c]'
                              : 'font-semibold text-[#2f7d4f]'
                          }
                        >
                          {(margenPct ?? 0) < 0
                            ? `Margen ${margenPct}% · vendés abajo del costo`
                            : `Margen real ${margenPct}%`}
                        </span>
                      </div>
                    ) : (
                      <>
                        <div className="mt-2.5 flex items-center justify-between border-t border-[#e4c9b0]/60 pt-2 text-xs">
                          <span className="text-[#6f3a2a]">Precio exacto</span>
                          <span className="font-medium text-[#6f3a2a]">
                            {venta?.desglose ? (
                              <MontoARS monto={venta.desglose.precioFinalExacto} />
                            ) : (
                              '…'
                            )}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center justify-between text-sm">
                          <span className="font-semibold text-[#391511]">
                            Precio venta
                          </span>
                          <span className="font-bold text-[#391511]">
                            <MontoARS monto={precioFinal} />
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* md+: tabla completa. Con gastos no debitables aparece la columna
                read-only "Costo final" (costo neto + prorrateo). */}
            <div className="hidden overflow-x-auto rounded-xl border border-[#e4c9b0]/60 md:block">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-[#391511] text-[#f9d2a2]">
                    <th className="p-2 text-left" rowSpan={2}>
                      Producto
                    </th>
                    <th className="p-2" rowSpan={2}>
                      Cant.
                    </th>
                    <th
                      className="p-2 text-center bg-[#6f3a2a]"
                      colSpan={hayGastos ? 6 : 5}
                    >
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
                    <th
                      className="p-1.5 font-medium"
                      title="Unitario, informativo del comprobante: el IVA es crédito fiscal, no forma parte del costo"
                    >
                      Costo c/IVA
                    </th>
                    {hayGastos && (
                      <th
                        className="p-1.5 font-medium bg-[#5a2f22]"
                        title="Unitario: costo neto + gastos no debitables prorrateados (es el costo que se guarda). No incluye IVA porque es crédito fiscal — por eso puede ser menor que el Costo c/IVA"
                      >
                        Costo final s/IVA
                      </th>
                    )}
                    <th className="p-1.5 font-medium">Margen %</th>
                    <th
                      className="p-1.5 font-medium"
                      title="Precio final exacto que asegura el margen (antes del redondeo comercial)"
                    >
                      Precio exacto
                    </th>
                    <th className="p-1.5 font-medium">IVA %</th>
                    <th
                      className="p-1.5 font-medium"
                      title="Editable: tipeá el precio que querés y el margen se deduce solo. Si no lo tocás, sale del margen (redondeado hacia arriba)."
                    >
                      Precio venta ✎
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {calculadas.map(({ l, calc, venta, cantidad, precioFinal, margenPct, error }) => (
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
                          <button
                            type="button"
                            onClick={() => {
                              const p = productosMap.get(l.producto_id)
                              if (p) setProductoEditar(p)
                            }}
                            title="Editar producto (nombre, código, etc.)"
                            className="mt-0.5 shrink-0 text-[#c8a58a] transition-colors hover:text-[#6f3a2a]"
                          >
                            <Pencil className="h-3.5 w-3.5" />
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
                            {productosMap.get(l.producto_id)?.pendiente_precio && (
                              <span className="mt-0.5 inline-block text-[10px] font-semibold uppercase tracking-wider text-[#c43e2c] bg-[#c43e2c]/12 rounded-full px-1.5 py-0.5">
                                Nuevo · completá precio
                              </span>
                            )}
                            <InfoLineaRecepcion
                              recibida={l.cantidad_recibida}
                              cantidad={l.cantidad}
                              esExtra={l.item_pedido_id === null}
                            />
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
                      {hayGastos && (
                        <td className="p-2 text-right tabular-nums font-bold text-[#391511] bg-[#f9b44c]/12">
                          <MontoARS monto={calc.costoFinal} />
                        </td>
                      )}
                      <td className="p-1 w-16">
                        <Input
                          type="number"
                          value={
                            l.modoVenta === 'margen'
                              ? l.margen
                              : margenPct != null
                                ? String(margenPct)
                                : ''
                          }
                          onChange={(ev) =>
                            setMargenLinea(l.key, ev.target.value)
                          }
                          title={
                            l.modoVenta === 'precio'
                              ? 'Margen real que deja el precio fijado. Tocalo para volver al precio automático.'
                              : undefined
                          }
                          className={cn(
                            inputCls,
                            l.modoVenta === 'precio' &&
                              'border-dashed text-[#6f3a2a]',
                            l.modoVenta === 'precio' &&
                              (margenPct ?? 0) < 0 &&
                              'border-[#c43e2c] text-[#c43e2c] font-bold'
                          )}
                        />
                      </td>
                      <td
                        className="p-2 text-right tabular-nums text-[#6f3a2a]"
                        title={
                          l.modoVenta === 'precio'
                            ? 'Precio fijado a mano'
                            : (error ?? undefined)
                        }
                      >
                        {l.modoVenta === 'precio' ? (
                          <span className="text-[#c8a58a]">—</span>
                        ) : error ? (
                          <span className="text-[#c43e2c] font-bold">—</span>
                        ) : venta?.desglose ? (
                          <MontoARS monto={venta.desglose.precioFinalExacto} />
                        ) : (
                          '…'
                        )}
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
                      <td className="p-1 w-24" title={error ?? undefined}>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={
                            l.modoVenta === 'precio'
                              ? l.precio
                              : venta?.desglose
                                ? String(venta.desglose.precioRedondeado)
                                : ''
                          }
                          onChange={(ev) =>
                            setPrecioLinea(l.key, ev.target.value)
                          }
                          placeholder={error ? '—' : '0'}
                          title="Tipealo para fijar el precio final; el margen se deduce solo"
                          className={cn(
                            inputCls,
                            'font-bold',
                            l.modoVenta === 'precio' &&
                              'border-[#f9b44c] bg-[#f9b44c]/10',
                            error && 'border-[#c43e2c]'
                          )}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
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

          {/* Gastos no debitables: se prorratean al costo de cada producto */}
          <div className="flex flex-wrap items-center justify-end gap-2 mb-1.5">
            <span className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold mr-1">
              Gastos no debitables
            </span>
            <span className="text-[11px] text-[#c8a58a]">(se suman al costo)</span>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={gastosNoDebitables}
              onChange={(e) => setGastosNoDebitables(e.target.value)}
              placeholder="0"
              className="h-8 w-28 text-right tabular-nums border-[#e4c9b0] text-xs"
            />
          </div>
          {hayGastos && (
            <p className="text-[11px] text-[#9e6b15] text-right mb-3">
              Se prorratea al costo de cada producto (+
              {factorGastosPct.toFixed(1)}% sobre el neto). Ya está reflejado en
              la columna <span className="font-semibold">Costo final s/IVA</span>{' '}
              y en el precio de venta. El IVA no entra al costo (es crédito
              fiscal), por eso puede quedar debajo del Costo c/IVA.
            </p>
          )}

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
            {gastos > 0 && (
              <span className="text-[#6f3a2a]">
                Gastos no debit.:{' '}
                <span className="font-semibold text-[#391511] tabular-nums">
                  <MontoARS monto={gastos} />
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

          {/* ── Agregar pago (migs 144/145): lista de pagos ─────────────── */}
          {cuenta &&
            (cuentaPagada ? (
              <div className="mb-3 flex items-center justify-end gap-1.5 text-xs font-semibold text-[#2f8f4e]">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                Deuda pagada el {fechaCorta(cuenta.fecha_pago)}
              </div>
            ) : (
              <div className="mb-3 rounded-xl border border-[#e4c9b0]/60 bg-white p-3 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold flex items-center gap-1.5">
                    <Wallet className="h-3.5 w-3.5 text-[#f9b44c]" />
                    Agregar pago
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    {yaPagado > 0.009 && (
                      <span className="rounded-full bg-[#f9b44c]/15 border border-[#f9b44c]/50 px-2 py-0.5 text-[10px] font-semibold text-[#9e6b15]">
                        Ya tiene pagos por <MontoARS monto={yaPagado} />
                      </span>
                    )}
                    {hayPagos && (
                      <div className="flex items-center gap-1.5 text-[11px] text-[#6f3a2a]">
                        <span>Fecha del pago</span>
                        <Input
                          type="date"
                          value={fechaPago}
                          max={hoyIso()}
                          onChange={(e) => setFechaPago(e.target.value)}
                          className="h-8 w-36 text-xs tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
                        />
                      </div>
                    )}
                  </div>
                </div>

                {/* Filas de pago (labels solo en la primera) */}
                {pagosLineas.map((f, i) => (
                  <div
                    key={f.key}
                    className="grid grid-cols-2 sm:grid-cols-[110px_120px_1fr_110px_1fr_32px] gap-2 items-end"
                  >
                    <div className="space-y-1">
                      {i === 0 && (
                        <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                          Importe
                        </Label>
                      )}
                      <div className="relative">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[#c8a58a] text-xs">
                          $
                        </span>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          inputMode="decimal"
                          value={f.monto}
                          onChange={(e) =>
                            setPagoCampo(f.key, 'monto', e.target.value)
                          }
                          className="pl-5 h-8 text-right text-xs font-semibold tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      {i === 0 && (
                        <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                          Método de pago
                        </Label>
                      )}
                      <Select
                        items={FORMA_PAGO_LABEL}
                        value={f.forma}
                        onValueChange={(v) =>
                          v && setFormaPagoLinea(f.key, v as FormaPago)
                        }
                      >
                        <SelectTrigger className="w-full h-8 text-xs border-[#e4c9b0] focus:ring-[#f9b44c] bg-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {FORMAS_PAGO.map((fp) => (
                            <SelectItem key={fp.valor} value={fp.valor}>
                              {fp.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      {i === 0 && (
                        <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                          Cuenta de pago
                        </Label>
                      )}
                      <Select
                        items={itemsCuentaPago}
                        value={f.cuenta_id}
                        onValueChange={(v) =>
                          elegirCuentaPagoLinea(f.key, v ?? '')
                        }
                      >
                        <SelectTrigger className="w-full h-8 text-xs border-[#e4c9b0] focus:ring-[#f9b44c] bg-white">
                          <SelectValue placeholder="Elegí la cuenta…" />
                        </SelectTrigger>
                        <SelectContent>
                          {(cuentasTesoreria ?? []).map((c) => (
                            <SelectItem key={c.id} value={String(c.id)}>
                              {c.nombre} · saldo{' '}
                              {new Intl.NumberFormat('es-AR', {
                                style: 'currency',
                                currency: 'ARS',
                                maximumFractionDigits: 0,
                              }).format(Number(c.saldo_actual))}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      {i === 0 && (
                        <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                          N° comp.
                        </Label>
                      )}
                      <Input
                        value={f.comprobante}
                        onChange={(e) =>
                          setPagoCampo(f.key, 'comprobante', e.target.value)
                        }
                        placeholder="Opcional"
                        className="h-8 text-xs border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
                      />
                    </div>
                    <div className="space-y-1">
                      {i === 0 && (
                        <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                          Nota de pago
                        </Label>
                      )}
                      <Input
                        value={f.nota}
                        onChange={(e) =>
                          setPagoCampo(f.key, 'nota', e.target.value)
                        }
                        placeholder="Opcional"
                        className="h-8 text-xs border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => quitarPagoLinea(f.key)}
                      className="h-8 w-8 flex items-center justify-center rounded-lg border border-[#e4c9b0] text-[#c43e2c] hover:bg-[#c43e2c]/10 transition-colors"
                      title="Quitar este pago"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}

                {/* Agregar: se oculta cuando ya no queda nada por cubrir */}
                {!deudaCubierta && saldoRestante > 0.009 && (
                  <button
                    type="button"
                    onClick={agregarPagoLinea}
                    className="w-full rounded-lg border-2 border-dashed border-[#e4c9b0] py-2 text-xs font-semibold text-[#6f3a2a] hover:border-[#f9b44c] hover:text-[#391511] transition-all flex items-center justify-center gap-1.5"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Agregar nuevo pago
                  </button>
                )}

                {/* Avisos */}
                {deudaCubierta && (
                  <p className="text-[11px] text-[#b3821b]">
                    Con este total la deuda ya queda cubierta por los pagos
                    registrados: guardá la factura sin pagos (se cierra sola).
                  </p>
                )}
                {avisosCuentas.map((a) => (
                  <p
                    key={a.nombre}
                    className={cn(
                      'text-[11px] flex items-center gap-1',
                      a.negativa && a.boveda
                        ? 'text-[#c43e2c] font-semibold'
                        : a.negativa
                          ? 'text-[#b3821b]'
                          : 'text-[#6f3a2a]'
                    )}
                  >
                    {a.negativa && (
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                    )}
                    Saldo de {a.nombre} después:{' '}
                    <span className="font-semibold tabular-nums">
                      <MontoARS monto={a.despues} />
                    </span>
                    {a.negativa && a.boveda
                      ? ' — la caja fuerte no puede quedar en negativo.'
                      : a.negativa
                        ? ' (queda en negativo)'
                        : null}
                  </p>
                ))}
                {ordenInvalido && (
                  <p className="text-[11px] text-[#c43e2c] flex items-start gap-1">
                    <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                    Los pagos anteriores ya cubren el total: borrá o bajá el
                    último pago.
                  </p>
                )}
                {sobrantePagoGrande && !ordenInvalido && (
                  <p className="text-[11px] text-[#c43e2c] flex items-start gap-1">
                    <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                    Estás pagando bastante por encima del total. ¿Es correcto?
                    El excedente queda registrado como diferencia por redondeo.
                  </p>
                )}

                {/* Saldo (lo que queda a cuenta corriente) */}
                <div className="pt-2 border-t border-[#e4c9b0]/40 text-center space-y-1.5">
                  <div className="text-sm font-extrabold text-[#391511] tabular-nums">
                    Saldo: <MontoARS monto={Math.max(0, saldoRestante)} />
                  </div>
                  {!deudaCubierta && saldoRestante > 0.009 ? (
                    <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1.5 text-[11px] text-[#6f3a2a]">
                      <span>
                        {hayPagos ? 'El saldo queda' : 'La deuda queda'} a
                        cuenta corriente del proveedor · vence el
                      </span>
                      <Input
                        type="date"
                        value={vencimientoCC}
                        onChange={(e) => setVencimientoCC(e.target.value)}
                        className="h-8 w-36 text-xs tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
                      />
                    </div>
                  ) : sobrantePago > 0 ? (
                    <p
                      className={cn(
                        'text-[11px]',
                        sobrantePagoGrande
                          ? 'text-[#c43e2c] font-semibold'
                          : 'text-[#b3821b]'
                      )}
                    >
                      Cancela la deuda · <MontoARS monto={sobrantePago} /> de
                      más → diferencia por redondeo
                    </p>
                  ) : hayPagos && Math.abs(saldoRestante) <= 0.009 ? (
                    <p className="text-[11px] text-[#2f8f4e] font-semibold flex items-center justify-center gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Los pagos cancelan la deuda completa.
                    </p>
                  ) : null}
                </div>
              </div>
            ))}

          <div className="flex gap-2">
            {facturaGuardada && (
              <Button
                variant="outline"
                onClick={handleAnular}
                disabled={anular.isPending || guardar.isPending}
                className="border-[#c43e2c]/40 text-[#c43e2c] hover:bg-[#c43e2c]/10 hover:text-[#c43e2c]"
              >
                {anular.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="mr-2 h-4 w-4" />
                )}
                Anular
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => onCambioAbierto(false)}
              disabled={guardar.isPending || anular.isPending}
              className="flex-1 border-[#e4c9b0] text-[#6f3a2a]"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleGuardar}
              disabled={
                guardar.isPending ||
                anular.isPending ||
                lineas.length === 0 ||
                hayErroresCab ||
                hayErrorPrecio ||
                pagoInvalido
              }
              className="flex-[2] bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-bold disabled:opacity-50"
            >
              {guardar.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Guardando…
                </>
              ) : hayPagos ? (
                <>
                  Guardar y pagar&nbsp;
                  <MontoARS monto={totalPagos} />
                </>
              ) : (
                'Guardar factura'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    {/* Editor completo del producto (corregir nombre, código, precio, etc.).
        Se abre desde el lápiz de cada línea; útil sobre todo para productos
        dados de alta al vuelo que llegan "pendientes de precio". */}
    <DrawerProducto
      abierto={productoEditar !== null}
      onCambioAbierto={(v) => !v && setProductoEditar(null)}
      producto={productoEditar}
    />
    </>
  )
}
