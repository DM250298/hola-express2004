'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  CheckCircle2,
  ExternalLink,
  FileText,
  Loader2,
  Wallet,
} from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
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
import { useCuentasAPagar, usePagarCuenta } from '@/lib/hooks/useFinanzas'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { ModalEditarFactura } from './ModalEditarFactura'
import { cn } from '@/lib/utils'
import type {
  CuentaAPagarConProveedor,
  EstadoCuentaDerivado,
} from '@/lib/queries/finanzas'

const TODOS = '__todos__'

export function TabCuentasAPagar() {
  const { data: usuario } = useUsuario()
  const [estadoFiltro, setEstadoFiltro] = useState<string>('pendientes')
  const [cuentaEditar, setCuentaEditar] =
    useState<CuentaAPagarConProveedor | null>(null)

  // "pendientes" = pendiente + vencida (todas las no-pagadas)
  const estadoQuery: EstadoCuentaDerivado | null =
    estadoFiltro === TODOS
      ? null
      : estadoFiltro === 'pendientes'
      ? null // se filtra en memoria
      : (estadoFiltro as EstadoCuentaDerivado)

  const { data: cuentas, isLoading, isError } = useCuentasAPagar(estadoQuery)
  const pagar = usePagarCuenta()

  const cuentasFiltradas =
    estadoFiltro === 'pendientes'
      ? (cuentas ?? []).filter((c) => c.estado !== 'pagada')
      : cuentas ?? []

  const totalPendiente = cuentasFiltradas
    .filter((c) => c.estado !== 'pagada')
    .reduce((acc, c) => acc + Number(c.monto), 0)

  function handlePagar(cuenta_id: number) {
    if (!usuario) return
    pagar.mutate({ cuenta_id, usuario_id: usuario.id })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[#391511] font-bold">Cuentas a pagar</h2>
          <p className="text-[#6f3a2a] text-sm">
            Facturas de proveedores ordenadas por vencimiento.
          </p>
        </div>
        <Select
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
                  Pedido
                </TableHead>
                <TableHead className="text-[#391511] font-semibold">
                  Vencimiento
                </TableHead>
                <TableHead className="text-right text-[#391511] font-semibold">
                  Monto
                </TableHead>
                <TableHead className="text-center text-[#391511] font-semibold">
                  Estado
                </TableHead>
                <TableHead className="text-right w-52 text-[#391511] font-semibold">
                  Acción
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cuentasFiltradas.map((c) => (
                <TableRow
                  key={c.id}
                  className={cn(
                    'border-b-[#e4c9b0]/40 hover:bg-[#fdfaf6]',
                    c.estado === 'vencida' &&
                      'bg-[#c43e2c]/[0.04] hover:bg-[#c43e2c]/[0.07]'
                  )}
                >
                  <TableCell className="font-medium text-[#391511]">
                    {c.proveedor_nombre ?? (
                      <span className="text-[#c8a58a] italic">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/pedidos/${c.pedido_id}`}
                      className="text-xs font-mono text-[#c43e2c] hover:underline inline-flex items-center gap-1"
                    >
                      #{c.pedido_id}
                      <ExternalLink className="h-3 w-3" />
                    </Link>
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
                  <TableCell className="text-right font-bold text-[#391511] tabular-nums">
                    <MontoARS monto={c.monto} />
                  </TableCell>
                  <TableCell className="text-center">
                    <BadgeEstadoCuenta estado={c.estado} />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setCuentaEditar(c)}
                        title="Editar factura (precios)"
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
                          onClick={() => handlePagar(c.id)}
                          disabled={pagar.isPending}
                          className={cn(
                            buttonVariants({ variant: 'default', size: 'sm' }),
                            'bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold'
                          )}
                        >
                          {pagar.isPending ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            'Marcar pagada'
                          )}
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
    </div>
  )
}
