'use client'

import { useState } from 'react'
import { CheckCircle2, FileText, Wallet } from 'lucide-react'
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
import { formatearFechaCorta } from '@/lib/utils/formato'
import { useCuentasAPagar } from '@/lib/hooks/useFinanzas'
import { ModalEditarFactura } from './ModalEditarFactura'
import { ModalPagarCuenta } from './ModalPagarCuenta'
import { DrawerCuentaPagar } from './DrawerCuentaPagar'
import { cn } from '@/lib/utils'
import type {
  CuentaAPagarConProveedor,
  EstadoCuentaDerivado,
} from '@/lib/queries/finanzas'

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

  const estadoQuery: EstadoCuentaDerivado | null =
    estadoFiltro === TODOS
      ? null
      : estadoFiltro === 'pendientes'
        ? null // se filtra en memoria
        : (estadoFiltro as EstadoCuentaDerivado)

  const { data: cuentas, isLoading, isError } = useCuentasAPagar(estadoQuery)

  const cuentasFiltradas =
    estadoFiltro === 'pendientes'
      ? (cuentas ?? []).filter((c) => c.estado !== 'pagada')
      : (cuentas ?? [])

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

      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden shadow-sm">
        {isLoading ? (
          <div className="p-6">
            <SkeletonTabla filas={5} columnas={5} />
          </div>
        ) : isError ? (
          <div className="p-10 text-center text-[#c43e2c] text-sm">
            No se pudieron cargar las cuentas.
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

      <ModalEditarFactura
        abierto={cuentaEditar !== null}
        onCambioAbierto={(v) => !v && setCuentaEditar(null)}
        cuenta={cuentaEditar}
      />

      <ModalPagarCuenta
        abierto={cuentaPago !== null}
        onCambioAbierto={(v) => !v && setCuentaPago(null)}
        cuenta={cuentaPago}
      />

      <DrawerCuentaPagar
        cuenta={cuentaDrawer}
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
