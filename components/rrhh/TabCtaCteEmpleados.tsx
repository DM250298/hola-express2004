'use client'

import { useMemo, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Lock,
  Plus,
  Trash2,
  Wallet,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { MontoARS } from '@/components/shared/MontoARS'
import { ModalMovimientoCtaCte } from './ModalMovimientoCtaCte'
import {
  useEliminarMovimientoCtaCte,
  useEmpleadosConSaldo,
  useMovimientosCtaCte,
} from '@/lib/hooks/useCtaCteEmpleado'
import { formatearFechaCorta } from '@/lib/utils/formato'
import { cn } from '@/lib/utils'
import type {
  CuentaCorrienteEmpleadoRow,
  EmpleadoConSaldo,
  TipoMovimientoCtaCte,
} from '@/types/database'

const ETIQUETA_TIPO: Record<TipoMovimientoCtaCte, string> = {
  consumo: 'Consumo',
  pago_libre: 'Pago',
  descuento_sueldo: 'Descuento de sueldo',
  ajuste: 'Ajuste',
}

const COLOR_TIPO: Record<TipoMovimientoCtaCte, string> = {
  consumo: 'bg-[#c43e2c]/15 text-[#c43e2c]',
  pago_libre: 'bg-[#2f8f4e]/15 text-[#2f8f4e]',
  descuento_sueldo: 'bg-[#6f3a2a]/15 text-[#6f3a2a]',
  ajuste: 'bg-[#f9b44c]/20 text-[#6f3a2a]',
}

export function TabCtaCteEmpleados() {
  const { data: empleados, isLoading } = useEmpleadosConSaldo()

  const [abiertoId, setAbiertoId] = useState<number | null>(null)
  const [modalEmpleado, setModalEmpleado] = useState<EmpleadoConSaldo | null>(
    null
  )

  const totalAdeudado = useMemo(
    () =>
      (empleados ?? []).reduce(
        (acc, e) => acc + Math.max(0, e.saldo_cta_cte),
        0
      ),
    [empleados]
  )

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[#391511] font-bold flex items-center gap-2">
          <Wallet className="h-5 w-5 text-[#f9b44c]" />
          Cuenta corriente de empleados
        </h2>
        <p className="text-[#6f3a2a] text-sm">
          Lo que cada empleado debe al kiosco. Al liquidar el sueldo el saldo
          deudor se descuenta automáticamente del neto.
        </p>
      </div>

      {/* KPI total adeudado */}
      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl px-5 py-4 flex items-center justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
            Total adeudado por el equipo
          </p>
          <p className="text-2xl font-extrabold text-[#391511] tabular-nums">
            <MontoARS monto={totalAdeudado} />
          </p>
        </div>
        <Wallet className="h-10 w-10 text-[#f9d2a2]" />
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 rounded-xl bg-[#f9d2a2]/30" />
          ))}
        </div>
      ) : !empleados || empleados.length === 0 ? (
        <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-10 text-center text-[#6f3a2a] text-sm">
          Sin empleados cargados todavía.
        </div>
      ) : (
        <ul className="space-y-2">
          {empleados
            .filter((e) => e.activo)
            .map((e) => (
              <FilaEmpleado
                key={e.id}
                empleado={e}
                abierto={abiertoId === e.id}
                onToggle={() =>
                  setAbiertoId((prev) => (prev === e.id ? null : e.id))
                }
                onNuevoMovimiento={() => setModalEmpleado(e)}
              />
            ))}
        </ul>
      )}

      {modalEmpleado && (
        <ModalMovimientoCtaCte
          abierto={!!modalEmpleado}
          onCambioAbierto={(v) => !v && setModalEmpleado(null)}
          empleadoId={modalEmpleado.id}
          empleadoNombre={modalEmpleado.nombre}
        />
      )}
    </div>
  )
}

// ─── Fila de empleado con expand ──────────────────────────────────────────────

function FilaEmpleado({
  empleado,
  abierto,
  onToggle,
  onNuevoMovimiento,
}: {
  empleado: EmpleadoConSaldo
  abierto: boolean
  onToggle: () => void
  onNuevoMovimiento: () => void
}) {
  const saldo = empleado.saldo_cta_cte
  const debe = saldo > 0.001

  return (
    <li className="bg-white border border-[#e4c9b0]/60 rounded-xl overflow-hidden">
      <div className="flex items-center gap-3 p-3">
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-2 flex-1 text-left"
        >
          {abierto ? (
            <ChevronDown className="h-4 w-4 text-[#6f3a2a]" />
          ) : (
            <ChevronRight className="h-4 w-4 text-[#6f3a2a]" />
          )}
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-[#391511] truncate">
              {empleado.nombre}
            </p>
            <p className="text-[#c8a58a] text-xs">
              {empleado.puesto || 'Sin puesto'}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wider text-[#6f3a2a]">
              Saldo
            </p>
            <p
              className={cn(
                'font-extrabold tabular-nums',
                debe ? 'text-[#c43e2c]' : 'text-[#2f8f4e]'
              )}
            >
              <MontoARS monto={saldo} />
            </p>
          </div>
        </button>
        <Button
          size="sm"
          onClick={onNuevoMovimiento}
          className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1"
        >
          <Plus className="h-3.5 w-3.5" />
          Movimiento
        </Button>
      </div>

      {abierto && <DetalleMovimientos empleadoId={empleado.id} />}
    </li>
  )
}

// ─── Listado de movimientos ──────────────────────────────────────────────────

function DetalleMovimientos({ empleadoId }: { empleadoId: number }) {
  const { data: movimientos, isLoading } = useMovimientosCtaCte(empleadoId)
  const eliminar = useEliminarMovimientoCtaCte()

  return (
    <div className="bg-[#fdfaf6] border-t border-[#e4c9b0]/60 px-3 py-2">
      {isLoading ? (
        <Skeleton className="h-8 rounded bg-[#f9d2a2]/40" />
      ) : !movimientos || movimientos.length === 0 ? (
        <p className="text-[#c8a58a] text-xs text-center py-3">
          Sin movimientos cargados.
        </p>
      ) : (
        <ul className="divide-y divide-[#e4c9b0]/40">
          {movimientos.map((m) => (
            <FilaMovimiento
              key={m.id}
              mov={m}
              onEliminar={() => {
                if (m.recibo_id != null) return
                if (
                  !confirm(
                    '¿Eliminar este movimiento? Se actualizará el saldo del empleado.'
                  )
                )
                  return
                eliminar.mutate(m.id)
              }}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function FilaMovimiento({
  mov,
  onEliminar,
}: {
  mov: CuentaCorrienteEmpleadoRow
  onEliminar: () => void
}) {
  const liquidado = mov.recibo_id != null
  return (
    <li className="py-2 flex items-center gap-2 group">
      <span
        className={cn(
          'text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded shrink-0',
          COLOR_TIPO[mov.tipo]
        )}
      >
        {ETIQUETA_TIPO[mov.tipo]}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-[#391511] truncate">
          {mov.concepto || '—'}
        </p>
        <p className="text-[11px] text-[#6f3a2a] tabular-nums">
          {formatearFechaCorta(mov.fecha)}
        </p>
      </div>
      <span
        className={cn(
          'font-extrabold tabular-nums text-sm shrink-0',
          mov.monto > 0 ? 'text-[#c43e2c]' : 'text-[#2f8f4e]'
        )}
      >
        {mov.monto > 0 ? '+' : ''}
        <MontoARS monto={mov.monto} />
      </span>
      {liquidado ? (
        <span title="Generado por una liquidación — se borra al regenerar el borrador">
          <Lock className="h-3.5 w-3.5 text-[#c8a58a]" />
        </span>
      ) : (
        <Button
          size="icon"
          variant="ghost"
          onClick={onEliminar}
          className="h-7 w-7 text-[#c43e2c] hover:bg-[#c43e2c]/10 opacity-0 group-hover:opacity-100"
          aria-label="Eliminar"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
    </li>
  )
}
