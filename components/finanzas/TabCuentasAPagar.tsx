'use client'

import { useState } from 'react'
import { CalendarClock, CheckCircle2, FileText, Loader2, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
import { BadgeEstadoCuenta } from '@/components/shared/BadgeEstadoCuenta'
import { MontoARS } from '@/components/shared/MontoARS'
import { EstadoError } from '@/components/shared/EstadoError'
import { formatearFechaCorta } from '@/lib/utils/formato'
import {
  useCancelarPagoProgramado,
  useCuentasAPagar,
  useEjecutarPagoProgramado,
  usePagosProgramados,
} from '@/lib/hooks/useFinanzas'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { ModalEditarFactura } from './ModalEditarFactura'
import { ModalPagarCuenta } from './ModalPagarCuenta'
import { ModalEjecutarProgramado } from './ModalEjecutarProgramado'
import { DrawerCuentaPagar } from './DrawerCuentaPagar'
import { cn } from '@/lib/utils'
import {
  FORMA_PAGO_LABEL,
  LIMITE_CUENTAS_PAGADAS,
  esFormaPago,
  labelComprobante,
  type CuentaAPagarConProveedor,
  type FiltroEstadoCuentas,
  type PagoProgramadoConDatos,
} from '@/lib/queries/finanzas'

function hoyIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const TODOS = '__todos__'

const ITEMS_ESTADO: Record<string, string> = {
  pendientes: 'Pendientes y vencidas',
  pendiente: 'Solo pendientes',
  vencida: 'Solo vencidas',
  pagada: 'Pagadas',
  [TODOS]: 'Todas',
}

export function TabCuentasAPagar() {
  const [estadoFiltro, setEstadoFiltro] = useState<string>('pendientes')
  const [cuentaEditar, setCuentaEditar] =
    useState<CuentaAPagarConProveedor | null>(null)
  const [cuentaPago, setCuentaPago] =
    useState<CuentaAPagarConProveedor | null>(null)
  const [cuentaDrawer, setCuentaDrawer] =
    useState<CuentaAPagarConProveedor | null>(null)
  // Programado a ejecutar: el modal pide el n° de comprobante (mig 155).
  const [programadoEjecutar, setProgramadoEjecutar] =
    useState<PagoProgramadoConDatos | null>(null)

  const estadoQuery: FiltroEstadoCuentas =
    estadoFiltro === TODOS
      ? null
      : estadoFiltro === 'pendientes'
        ? 'abiertas' // pendientes + vencidas, filtradas en el server
        : (estadoFiltro as FiltroEstadoCuentas)

  const { data: cuentas, isLoading, isError, refetch } =
    useCuentasAPagar(estadoQuery)
  const { data: usuario } = useUsuario()
  const { data: programados } = usePagosProgramados()
  const ejecutarProg = useEjecutarPagoProgramado()
  const cancelarProg = useCancelarPagoProgramado()
  const hoy = hoyIso()

  const cuentasFiltradas =
    estadoFiltro === 'pendientes'
      ? (cuentas ?? []).filter((c) => c.estado !== 'pagada')
      : (cuentas ?? [])

  // Objetos VIVOS para drawer/modales: el state guarda la copia del click, y
  // tras definir cuotas o pagar quedaría vieja (mostraría el plan anterior).
  // Se re-resuelve por id contra la query fresca en cada render; si la fila
  // salió del filtro (p.ej. pasó a pagada), cae a la copia.
  const resolverViva = (c: CuentaAPagarConProveedor | null) =>
    c ? ((cuentas ?? []).find((x) => x.id === c.id) ?? c) : null
  const cuentaEditarViva = resolverViva(cuentaEditar)
  const cuentaPagoViva = resolverViva(cuentaPago)
  const cuentaDrawerViva = resolverViva(cuentaDrawer)

  const totalPendiente = cuentasFiltradas
    .filter((c) => c.estado !== 'pagada')
    .reduce((acc, c) => acc + Number(c.saldo_pendiente), 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[#391511] font-bold">Cuentas a pagar</h2>
          <p className="text-[#6f3a2a] text-sm">
            Tocá una fila para ver el detalle, registrar pagos y editar plazos.
          </p>
          <p className="text-[10px] text-[#c8a58a] mt-0.5">
            Muestra lo que debés hoy — no depende del período de arriba.
          </p>
        </div>
        <Select
          items={ITEMS_ESTADO}
          value={estadoFiltro}
          onValueChange={(v) => setEstadoFiltro(v ?? 'pendientes')}
        >
          <SelectTrigger className="w-[200px] border-[#e4c9b0] focus:ring-[#f9b44c] bg-white">
            <SelectValue placeholder="Filtrar por estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pendientes">Pendientes y vencidas</SelectItem>
            <SelectItem value="pendiente">Solo pendientes</SelectItem>
            <SelectItem value="vencida">Solo vencidas</SelectItem>
            <SelectItem value="pagada">Pagadas</SelectItem>
            <SelectItem value={TODOS}>Todas</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Total pendiente */}
      {totalPendiente > 0 && (
        <div className="rounded-2xl border-2 border-[#f9b44c]/40 bg-[#f9b44c]/10 p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-[#f9b44c]/30">
              <Wallet className="h-5 w-5 text-[#6f3a2a]" />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                Total a pagar
              </div>
              <div className="text-xs text-[#6f3a2a]">
                {cuentasFiltradas.filter((c) => c.estado !== 'pagada').length}{' '}
                cuenta(s)
              </div>
            </div>
          </div>
          <div className="text-3xl font-extrabold text-[#391511] tabular-nums">
            <MontoARS monto={totalPendiente} />
          </div>
        </div>
      )}

      {/* Pagos programados (mig 146): agendados desde la carga de factura */}
      {(programados ?? []).length > 0 && (
        <div className="rounded-2xl border border-[#e4c9b0]/60 bg-white p-4 space-y-3">
          <div className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-[#9e6b15]" />
            <h3 className="text-sm font-semibold text-[#391511]">
              Pagos programados
            </h3>
            <span className="text-[10px] font-bold text-[#9e6b15] bg-[#f9b44c]/20 rounded-full px-2 py-0.5">
              {(programados ?? []).length}
            </span>
            <span className="text-[11px] text-[#c8a58a]">
              No descuentan plata hasta que los ejecutes.
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {(programados ?? []).map((p) => {
              const vencido = p.fecha_programada <= hoy
              return (
                <div
                  key={p.id}
                  className={cn(
                    'rounded-xl border bg-[#fdfaf6] p-3 space-y-2',
                    vencido ? 'border-[#c43e2c]/50' : 'border-[#e4c9b0]/60'
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-[#391511] text-sm truncate">
                        {p.proveedor_nombre ?? 'Proveedor'}
                      </div>
                      <div className="text-[11px] text-[#6f3a2a] truncate">
                        {p.cuenta_origen_nombre ?? 'cuenta'}
                        {esFormaPago(p.forma_pago)
                          ? ` · ${FORMA_PAGO_LABEL[p.forma_pago]}`
                          : ''}
                        {p.pedido_id ? ` · pedido #${p.pedido_id}` : ''}
                      </div>
                      {p.comprobante && (
                        <div className="text-[10px] text-[#6f3a2a] truncate">
                          {labelComprobante(p.forma_pago)}: {p.comprobante}
                        </div>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-bold text-[#391511] tabular-nums text-sm">
                        <MontoARS monto={p.monto} />
                      </div>
                      <div
                        className={cn(
                          'text-[10px] font-semibold',
                          vencido ? 'text-[#c43e2c]' : 'text-[#6f3a2a]'
                        )}
                      >
                        {vencido
                          ? p.fecha_programada === hoy
                            ? 'para HOY · '
                            : 'atrasado · '
                          : ''}
                        {formatearFechaCorta(p.fecha_programada)}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      disabled={
                        !usuario ||
                        ejecutarProg.isPending ||
                        cancelarProg.isPending
                      }
                      // El modal confirma y pide el n° de comprobante cuando
                      // la forma lo exige (mig 155): acá es donde la
                      // transferencia se concreta.
                      onClick={() => setProgramadoEjecutar(p)}
                      className="flex-1 h-8 bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-bold"
                    >
                      {ejecutarProg.isPending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        'Ejecutar'
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={
                        ejecutarProg.isPending || cancelarProg.isPending
                      }
                      onClick={() => {
                        const ok = window.confirm(
                          '¿Cancelar este pago programado? La deuda queda a cuenta corriente.'
                        )
                        if (ok) cancelarProg.mutate(p.id)
                      }}
                      className="h-8 border-[#e4c9b0] text-[#6f3a2a]"
                    >
                      Cancelar
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden shadow-sm">
        {isLoading ? (
          <div className="p-6">
            <SkeletonTabla filas={5} columnas={5} />
          </div>
        ) : isError ? (
          <div className="p-6">
            <EstadoError
              mensaje="No pudimos cargar las cuentas a pagar. Revisá tu conexión e intentá de nuevo."
              onReintentar={() => refetch()}
            />
          </div>
        ) : cuentasFiltradas.length === 0 ? (
          <div className="p-12 text-center">
            <div className="inline-flex p-3 rounded-full bg-[#f9d2a2]/40 mb-3">
              <CheckCircle2 className="h-6 w-6 text-[#6f3a2a]" />
            </div>
            <p className="text-[#391511] font-semibold">Todo al día</p>
            <p className="text-[#6f3a2a] text-sm mt-1">
              No hay cuentas en este filtro.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-b-[#e4c9b0]/60 bg-[#fdfaf6] hover:bg-[#fdfaf6]">
                <TableHead className="text-[#391511] font-semibold">
                  Proveedor
                </TableHead>
                <TableHead className="text-[#391511] font-semibold">
                  Vencimiento
                </TableHead>
                <TableHead className="text-right text-[#391511] font-semibold">
                  Saldo
                </TableHead>
                <TableHead className="text-center text-[#391511] font-semibold">
                  Estado
                </TableHead>
                <TableHead className="text-right w-44 text-[#391511] font-semibold">
                  Acción
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cuentasFiltradas.map((c) => (
                <TableRow
                  key={c.id}
                  onClick={() => setCuentaDrawer(c)}
                  className={cn(
                    'border-b-[#e4c9b0]/40 hover:bg-[#fdfaf6] cursor-pointer',
                    c.estado === 'vencida' &&
                      'bg-[#c43e2c]/[0.04] hover:bg-[#c43e2c]/[0.07]'
                  )}
                >
                  <TableCell className="font-medium text-[#391511]">
                    {c.proveedor_nombre ?? (
                      <span className="text-[#c8a58a] italic">—</span>
                    )}
                    {!c.tiene_factura && (
                      <span className="ml-2 text-[9px] uppercase tracking-wider text-[#c43e2c] bg-[#c43e2c]/10 rounded-full px-1.5 py-0.5">
                        sin factura
                      </span>
                    )}
                  </TableCell>
                  <TableCell
                    className={cn(
                      'text-sm tabular-nums',
                      c.estado === 'vencida'
                        ? 'text-[#c43e2c] font-semibold'
                        : 'text-[#6f3a2a]'
                    )}
                  >
                    {formatearFechaCorta(c.fecha_vencimiento)}
                    {c.proxima_cuota && (
                      <span
                        className="ml-1.5 text-[9px] uppercase tracking-wider text-[#6f3a2a] bg-[#e4c9b0]/40 rounded-full px-1.5 py-0.5"
                        title="La deuda tiene plan de cuotas: el vencimiento es el de la próxima cuota impaga"
                      >
                        Cuota {c.proxima_cuota.numero}/{c.cuotas.length}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <div className="font-bold text-[#391511]">
                      <MontoARS monto={c.saldo_pendiente} />
                    </div>
                    {c.parcial && (
                      <div className="text-[10px] text-[#6f3a2a]">
                        de <MontoARS monto={c.monto} />
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    <div className="flex items-center justify-center gap-1">
                      <BadgeEstadoCuenta estado={c.estado} />
                      {c.parcial && (
                        <span className="text-[9px] uppercase tracking-wider text-[#6f3a2a] bg-[#f9b44c]/20 rounded-full px-1.5 py-0.5">
                          parcial
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation()
                          setCuentaEditar(c)
                        }}
                        title="Cargar / editar factura"
                        className="h-8 gap-1 text-[#6f3a2a] hover:bg-[#f9d2a2]/40 hover:text-[#391511] text-xs"
                      >
                        <FileText className="h-3.5 w-3.5" />
                        Factura
                      </Button>
                      {c.estado === 'pagada' ? (
                        <span className="text-xs text-[#6f3a2a]">
                          {c.fecha_pago
                            ? formatearFechaCorta(c.fecha_pago)
                            : '—'}
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation()
                            setCuentaPago(c)
                          }}
                          className="h-8 bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold"
                        >
                          Pagar
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* El tope de pagadas también recorta la vista "Todas": avisar en ambas. */}
      {(estadoFiltro === 'pagada' || estadoFiltro === TODOS) &&
        cuentasFiltradas.filter((c) => c.estado === 'pagada').length >=
          LIMITE_CUENTAS_PAGADAS && (
          <p className="text-[10px] text-[#c8a58a]">
            Se muestran las últimas {LIMITE_CUENTAS_PAGADAS} cuentas pagadas.
          </p>
        )}

      <ModalEditarFactura
        abierto={cuentaEditar !== null}
        onCambioAbierto={(v) => !v && setCuentaEditar(null)}
        cuenta={cuentaEditarViva}
      />

      <ModalPagarCuenta
        abierto={cuentaPago !== null}
        onCambioAbierto={(v) => !v && setCuentaPago(null)}
        cuenta={cuentaPagoViva}
      />

      <ModalEjecutarProgramado
        programado={programadoEjecutar}
        abierto={programadoEjecutar !== null}
        onCambioAbierto={(v) => !v && setProgramadoEjecutar(null)}
        ejecutando={ejecutarProg.isPending}
        onEjecutar={(p, comprobante) => {
          if (!usuario) return
          ejecutarProg.mutate(
            { programadoId: p.id, usuarioId: usuario.id, comprobante },
            { onSuccess: () => setProgramadoEjecutar(null) }
          )
        }}
      />

      <DrawerCuentaPagar
        cuenta={cuentaDrawerViva}
        abierto={cuentaDrawer !== null}
        onCambioAbierto={(v) => !v && setCuentaDrawer(null)}
        onPagar={(c) => {
          setCuentaDrawer(null)
          setCuentaPago(c)
        }}
      />
    </div>
  )
}
