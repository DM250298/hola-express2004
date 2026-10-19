'use client'

import { useMemo, useState } from 'react'
import { FilePlus2, Package, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { MontoARS } from '@/components/shared/MontoARS'
import { ModalCompraFactura } from '@/components/compras/ModalCompraFactura'
import { ModalControlarCompra } from '@/components/compras/ModalControlarCompra'
import { ModalEditarFactura } from '@/components/finanzas/ModalEditarFactura'
import { ModalPagarCuenta } from '@/components/finanzas/ModalPagarCuenta'
import { useCuentasAPagar } from '@/lib/hooks/useFinanzas'
import { useComprobantesCargados } from '@/lib/hooks/useFacturasCompra'
import { useProveedores } from '@/lib/hooks/useProveedores'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { cn } from '@/lib/utils'
import {
  fechaLocal,
  rangoPredefinido,
  type ClavePeriodo,
} from '@/lib/utils/periodos'
import {
  ESTADOS_FACTURA,
  ETIQUETA_ESTADO,
  ETIQUETA_ORDEN,
  armarFilasPortal,
  filtrarFilas,
  ordenarFilas,
  resumirPortal,
  type EstadoFactura,
  type FilaPortal,
  type OrdenPortal,
} from '@/lib/facturas/portal'
import type { CuentaAPagarConProveedor } from '@/lib/queries/finanzas'
import type { ComprobanteCargado } from '@/lib/queries/facturasCompra'
import { COLOR_ESTADO } from './ChipEstadoFactura'
import { TablaFacturas } from './TablaFacturas'
import { DrawerFactura } from './DrawerFactura'
import { SeccionPagosProgramados } from './SeccionPagosProgramados'

const TODOS_PROV = '__todos__'

type FiltroEstado = EstadoFactura | 'todas'

const ITEMS_PERIODO: Record<string, string> = {
  mes_actual: 'Este mes',
  mes_anterior: 'Mes anterior',
  ultimos_7: 'Últimos 7 días',
  todo: 'Todo el historial',
}
type PeriodoPortal = Exclude<ClavePeriodo, 'hoy' | 'personalizado'> | 'todo'

export const ESTADOS_URL: readonly string[] = ['todas', ...ESTADOS_FACTURA]

interface Props {
  /** Pestaña de estado inicial (viene de ?estado= en la URL). */
  estadoInicial?: string
  /** Sin el título de página (cuando va dentro de la pestaña de Compras). */
  embebido?: boolean
}

/**
 * Portal único de facturas de proveedores: lo que falta facturar, lo que
 * falta validar y lo que falta pagar, en una sola bandeja con un estado
 * explícito por factura. Reemplaza a Finanzas › Facturas de proveedores y
 * Finanzas › Cuentas a pagar (que redirigen acá).
 */
export function PortalFacturas({ estadoInicial, embebido }: Props) {
  const { data: cuentas, isLoading: cargandoCuentas, isError: errorCuentas, refetch: refetchCuentas } =
    useCuentasAPagar(null)
  const { data: comprobantes, isLoading: cargandoComp, isError: errorComp, refetch: refetchComp } =
    useComprobantesCargados()
  const { data: proveedores } = useProveedores()
  const { data: usuario } = useUsuario()

  const [estado, setEstado] = useState<FiltroEstado>(() =>
    estadoInicial && ESTADOS_URL.includes(estadoInicial)
      ? (estadoInicial as FiltroEstado)
      : 'todas'
  )
  const [texto, setTexto] = useState('')
  const [proveedorFiltro, setProveedorFiltro] = useState<string>(TODOS_PROV)
  const [periodo, setPeriodo] = useState<PeriodoPortal>('mes_actual')
  // Por fecha del comprobante, de la más nueva a la más vieja (pedido del dueño).
  const [orden, setOrden] = useState<OrdenPortal>('fecha_desc')

  const [filaDetalle, setFilaDetalle] = useState<FilaPortal | null>(null)
  const [cuentaEditar, setCuentaEditar] = useState<CuentaAPagarConProveedor | null>(null)
  const [cuentaPago, setCuentaPago] = useState<CuentaAPagarConProveedor | null>(null)
  const [compraControlar, setCompraControlar] = useState<ComprobanteCargado | null>(null)
  const [modalCompra, setModalCompra] = useState(false)

  const nombresProveedor = useMemo(() => {
    const m = new Map<number, string>()
    for (const p of proveedores ?? []) m.set(p.id, p.nombre)
    return m
  }, [proveedores])

  const filas = useMemo(
    () => armarFilasPortal(cuentas ?? [], comprobantes ?? [], nombresProveedor),
    [cuentas, comprobantes, nombresProveedor]
  )

  const rango = useMemo(() => {
    if (periodo === 'todo') return { desde: '0000-01-01', hasta: '9999-12-31' }
    const r = rangoPredefinido(periodo)
    return { desde: fechaLocal(r.desde), hasta: fechaLocal(r.hasta) }
  }, [periodo])

  const proveedorId = proveedorFiltro === TODOS_PROV ? null : Number(proveedorFiltro)
  const resumen = useMemo(
    () => resumirPortal(filas, { ...rango, proveedorId }),
    [filas, rango, proveedorId]
  )
  const filasVisibles = useMemo(
    () => ordenarFilas(filtrarFilas(filas, { estado, texto, proveedorId, ...rango }), orden),
    [filas, estado, texto, proveedorId, rango, orden]
  )

  // Proveedores presentes en la lista (para el selector).
  const itemsProveedor = useMemo(() => {
    const r: Record<string, string> = { [TODOS_PROV]: 'Todos los proveedores' }
    const vistos = new Map<number, string>()
    for (const f of filas) {
      if (f.proveedor_id != null) vistos.set(f.proveedor_id, f.proveedor_nombre)
    }
    for (const [id, nombre] of [...vistos.entries()].sort((a, b) =>
      a[1].localeCompare(b[1], 'es')
    )) {
      r[String(id)] = nombre
    }
    return r
  }, [filas])

  // Objetos VIVOS: la copia del click queda vieja después de pagar/validar;
  // se re-resuelve contra la query fresca en cada render.
  const filaDetalleViva = filaDetalle
    ? (filas.find((f) => f.clave === filaDetalle.clave) ?? filaDetalle)
    : null
  const resolverCuenta = (c: CuentaAPagarConProveedor | null) =>
    c ? ((cuentas ?? []).find((x) => x.id === c.id) ?? c) : null

  function accionDeFila(f: FilaPortal) {
    switch (f.accion) {
      case 'cargar_factura':
        if (f.cuenta) setCuentaEditar(f.cuenta)
        return
      case 'validar':
        // Validar se confirma desde el detalle, donde se ve el cruce y el papel.
        setFilaDetalle(f)
        return
      case 'pagar':
        if (f.cuenta) setCuentaPago(f.cuenta)
        return
      default:
        setFilaDetalle(f)
    }
  }

  const cargando = cargandoCuentas || cargandoComp
  const error = errorCuentas || errorComp

  const vacio =
    estado === 'todas'
      ? texto || proveedorId != null
        ? 'Ninguna factura coincide con la búsqueda.'
        : 'No hay facturas ni deudas cargadas.'
      : estado === 'pagada'
        ? 'No hay facturas pagadas en el período elegido.'
        : `No hay facturas en "${ETIQUETA_ESTADO[estado]}".`

  return (
    <div className={cn('space-y-5', !embebido && 'p-4 sm:p-6')}>
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          {!embebido && (
            <h1 className="text-[#391511] text-2xl font-bold">Facturas de proveedores</h1>
          )}
          <p className="text-[#6f3a2a] text-sm mt-1 max-w-2xl">
            Una sola bandeja: lo que falta facturar, lo que falta validar y lo que
            falta pagar. Tocá una fila para ver el detalle completo.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button
            variant="outline"
            onClick={() => setModalCompra(true)}
            className="border-[#e4c9b0] text-[#391511] hover:bg-[#f9d2a2]/40 gap-1.5"
          >
            <Package className="h-4 w-4" />
            Compra directa
          </Button>
          <Button
            onClick={() => {
              const primera = filas.find((f) => f.estado === 'sin_factura')
              if (primera?.cuenta) setCuentaEditar(primera.cuenta)
              else setEstado('sin_factura')
            }}
            className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5"
          >
            <FilePlus2 className="h-4 w-4" />
            Cargar factura
          </Button>
        </div>
      </header>

      {/* Cuatro tarjetas: un clic filtra la lista */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <TarjetaResumen
          estado="sin_factura"
          activa={estado === 'sin_factura'}
          onClick={() => setEstado((e) => (e === 'sin_factura' ? 'todas' : 'sin_factura'))}
          valor={String(resumen.sin_factura.cantidad)}
          detalle={
            resumen.sin_factura.cantidad === 0 ? (
              'todas las recepciones tienen su factura'
            ) : (
              <>
                {resumen.sin_factura.cantidad === 1 ? 'recepción' : 'recepciones'} ·{' '}
                <MontoARS monto={resumen.sin_factura.estimado} /> estimado
              </>
            )
          }
        />
        <TarjetaResumen
          estado="a_validar"
          activa={estado === 'a_validar'}
          onClick={() => setEstado((e) => (e === 'a_validar' ? 'todas' : 'a_validar'))}
          valor={String(resumen.a_validar.cantidad)}
          detalle={
            resumen.a_validar.cantidad === 0 ? (
              'nada pendiente de revisar'
            ) : (
              <>
                <MontoARS monto={resumen.a_validar.total} />
                {resumen.a_validar.con_diferencias > 0 &&
                  ` · ${resumen.a_validar.con_diferencias} con diferencias`}
              </>
            )
          }
        />
        <TarjetaResumen
          estado={resumen.a_pagar.vencidas > 0 ? 'vencida' : 'a_pagar'}
          etiqueta="A pagar"
          activa={estado === 'a_pagar' || estado === 'vencida'}
          onClick={() =>
            setEstado((e) =>
              e === 'a_pagar' || e === 'vencida'
                ? 'todas'
                : resumen.a_pagar.vencidas > 0
                  ? 'vencida'
                  : 'a_pagar'
            )
          }
          valor={<MontoARS monto={resumen.a_pagar.saldo} />}
          detalle={
            resumen.a_pagar.vencidas > 0 ? (
              <span className="text-[#c43e2c] font-semibold">
                {resumen.a_pagar.vencidas} {resumen.a_pagar.vencidas === 1 ? 'vencida' : 'vencidas'} ·{' '}
                <MontoARS monto={resumen.a_pagar.saldo_vencido} />
              </span>
            ) : (
              `${resumen.a_pagar.cantidad} ${resumen.a_pagar.cantidad === 1 ? 'factura' : 'facturas'} · nada vencido`
            )
          }
        />
        <TarjetaResumen
          estado="pagada"
          etiqueta={`Pagadas · ${ITEMS_PERIODO[periodo].toLowerCase()}`}
          activa={estado === 'pagada'}
          onClick={() => setEstado((e) => (e === 'pagada' ? 'todas' : 'pagada'))}
          valor={<MontoARS monto={resumen.pagadas.total} />}
          detalle={
            <>
              {resumen.pagadas.cantidad} {resumen.pagadas.cantidad === 1 ? 'factura' : 'facturas'}
              {resumen.pagadas.sin_factura > 0 && (
                <span className="text-[#c43e2c]"> · {resumen.pagadas.sin_factura} sin comprobante</span>
              )}
            </>
          }
        />
      </div>

      <SeccionPagosProgramados />

      {/* Filtros */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="inline-flex flex-wrap gap-0.5 rounded-lg border border-[#e4c9b0]/60 bg-white p-1">
          {(['todas', ...ESTADOS_FACTURA] as FiltroEstado[]).map((e) => {
            const n = resumen.porEstado[e]
            return (
              <button
                key={e}
                type="button"
                onClick={() => setEstado(e)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-sm font-medium transition-colors tabular-nums',
                  estado === e
                    ? 'bg-[#f9b44c]/20 text-[#391511] shadow-sm'
                    : 'text-[#6f3a2a] hover:bg-[#f9d2a2]/40 hover:text-[#391511]'
                )}
              >
                {e === 'todas' ? 'Todas' : ETIQUETA_ESTADO[e]}
                <span className={cn('ml-1 text-xs', estado === e ? 'text-[#6f3a2a]' : 'text-[#c8a58a]')}>
                  {n}
                </span>
              </button>
            )
          })}
        </div>
        <div className="flex gap-2 flex-wrap">
          <div className="relative min-w-[220px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#c8a58a]" />
            <Input
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Proveedor, n° de comprobante o pedido…"
              className="pl-8 border-[#e4c9b0] bg-white"
            />
          </div>
          <Select
            items={itemsProveedor}
            value={proveedorFiltro}
            onValueChange={(v) => setProveedorFiltro(v ?? TODOS_PROV)}
          >
            <SelectTrigger className="w-[200px] border-[#e4c9b0] focus:ring-[#f9b44c] bg-white">
              <SelectValue placeholder="Proveedor" />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(itemsProveedor).map(([valor, etiqueta]) => (
                <SelectItem key={valor} value={valor}>
                  {etiqueta}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            items={ITEMS_PERIODO}
            value={periodo}
            onValueChange={(v) => setPeriodo((v ?? 'mes_actual') as PeriodoPortal)}
          >
            <SelectTrigger
              className="w-[170px] border-[#e4c9b0] focus:ring-[#f9b44c] bg-white"
              title="El período acota solo las pagadas; lo abierto se muestra siempre"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(ITEMS_PERIODO).map(([valor, etiqueta]) => (
                <SelectItem key={valor} value={valor}>
                  {etiqueta}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            items={ETIQUETA_ORDEN}
            value={orden}
            onValueChange={(v) => setOrden((v ?? 'fecha_desc') as OrdenPortal)}
          >
            <SelectTrigger
              className="w-[215px] border-[#e4c9b0] focus:ring-[#f9b44c] bg-white"
              title="Fecha = emisión del comprobante; si todavía no hay factura, la fecha de la recepción"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(ETIQUETA_ORDEN).map(([valor, etiqueta]) => (
                <SelectItem key={valor} value={valor}>
                  {etiqueta}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <TablaFacturas
        filas={filasVisibles}
        cargando={cargando}
        error={error}
        onReintentar={() => {
          refetchCuentas()
          refetchComp()
        }}
        onVer={setFilaDetalle}
        onAccion={accionDeFila}
        vacio={vacio}
      />
      <p className="text-[10px] text-[#c8a58a]">
        El período de arriba acota solo las pagadas: todo lo abierto se muestra siempre.
      </p>

      <DrawerFactura
        fila={filaDetalleViva}
        abierto={filaDetalle !== null}
        onCambioAbierto={(v) => !v && setFilaDetalle(null)}
        onEditarFactura={(f) => {
          if (f.cuenta) setCuentaEditar(f.cuenta)
        }}
        onRevisarDirecta={(f) => {
          if (f.factura) setCompraControlar(f.factura)
        }}
        onPagar={(f) => {
          if (f.cuenta) setCuentaPago(f.cuenta)
        }}
      />

      <ModalEditarFactura
        abierto={cuentaEditar !== null}
        onCambioAbierto={(v) => !v && setCuentaEditar(null)}
        cuenta={resolverCuenta(cuentaEditar)}
      />

      <ModalPagarCuenta
        abierto={cuentaPago !== null}
        onCambioAbierto={(v) => !v && setCuentaPago(null)}
        cuenta={resolverCuenta(cuentaPago)}
      />

      {usuario && (
        <>
          <ModalControlarCompra
            abierto={compraControlar !== null}
            onCambioAbierto={(v) => !v && setCompraControlar(null)}
            compra={compraControlar}
            proveedorNombre={
              compraControlar?.proveedor_id != null
                ? (nombresProveedor.get(compraControlar.proveedor_id) ?? null)
                : null
            }
            usuarioId={usuario.id}
          />
          <ModalCompraFactura
            abierto={modalCompra}
            onCambioAbierto={setModalCompra}
            contexto="finanzas"
            usuarioId={usuario.id}
          />
        </>
      )}
    </div>
  )
}

function TarjetaResumen({
  estado,
  etiqueta,
  valor,
  detalle,
  activa,
  onClick,
}: {
  estado: EstadoFactura
  etiqueta?: string
  valor: React.ReactNode
  detalle: React.ReactNode
  activa: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activa}
      style={{ borderLeftColor: COLOR_ESTADO[estado] }}
      className={cn(
        'text-left rounded-2xl border border-l-4 bg-white p-4 shadow-sm transition-colors',
        activa
          ? 'border-[#f9b44c] bg-[#f9b44c]/10'
          : 'border-[#e4c9b0]/60 hover:border-[#f9b44c] hover:shadow-md'
      )}
    >
      <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold truncate">
        {etiqueta ?? ETIQUETA_ESTADO[estado]}
      </div>
      <div className="mt-1 text-2xl font-extrabold leading-tight tabular-nums text-[#391511]">
        {valor}
      </div>
      <div className="mt-0.5 text-xs text-[#6f3a2a]">{detalle}</div>
    </button>
  )
}
