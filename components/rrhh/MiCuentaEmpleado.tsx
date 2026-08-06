'use client'

import { useMemo, useState } from 'react'
import { addMonths, format } from 'date-fns'
import { es } from 'date-fns/locale'
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  HandCoins,
  Wallet,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { MontoARS } from '@/components/shared/MontoARS'
import {
  useMiCtaCte,
  useMiSaldoCtaCte,
  useMisNovedades,
} from '@/lib/hooks/useMiCuenta'
import { formatearFechaCorta } from '@/lib/utils/formato'
import { cn } from '@/lib/utils'

const ETIQUETA_TIPO: Record<string, string> = {
  consumo: 'Consumo',
  pago_libre: 'Pago',
  descuento_sueldo: 'Descontado del sueldo',
  ajuste: 'Ajuste',
}

const ETIQUETA_NOVEDAD: Record<string, string> = {
  adelanto: 'Adelanto de sueldo',
  descuento: 'Descuento',
}

/**
 * "Mi cuenta": lo que el empleado debe al kiosco (cuenta corriente) y los
 * adelantos/descuentos que le van a restar del próximo sueldo. Compartido
 * entre /rrhh/mi-cuenta (escritorio) y /movil/mi-cuenta (celular).
 * NO muestra sueldo, haberes ni neto — solo lo que él consumió o recibió.
 */
export function MiCuentaEmpleado() {
  const [mes, setMes] = useState(() => new Date())
  const periodo = format(mes, 'yyyy-MM')

  const { data: saldo, isLoading: cargandoSaldo } = useMiSaldoCtaCte()
  const { data: movimientos, isLoading: cargandoMovs } = useMiCtaCte()
  const { data: novedades, isLoading: cargandoNovs } = useMisNovedades(periodo)

  const totalNovedades = useMemo(
    () => (novedades ?? []).reduce((acc, n) => acc + n.monto, 0),
    [novedades]
  )

  const debe = (saldo ?? 0) > 0.009

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-2xl mx-auto">
      <header>
        <h1 className="text-[#391511] text-2xl font-bold">Mi cuenta</h1>
        <p className="text-[#6f3a2a] text-sm mt-1">
          Lo que te llevaste a cuenta y lo que se descuenta de tu sueldo.
        </p>
      </header>

      {/* Saldo */}
      <div
        className={cn(
          'rounded-2xl border-2 p-4 flex items-center gap-3',
          debe
            ? 'border-[#f9b44c]/50 bg-[#f9b44c]/10'
            : 'border-[#2f8f4e]/30 bg-[#2f8f4e]/8'
        )}
      >
        <span
          className={cn(
            'flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl',
            debe
              ? 'bg-[#f9b44c]/25 text-[#a3641c]'
              : 'bg-[#2f8f4e]/15 text-[#2f8f4e]'
          )}
        >
          {debe ? (
            <Wallet className="h-6 w-6" />
          ) : (
            <CheckCircle2 className="h-6 w-6" />
          )}
        </span>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
            {debe ? 'Debés hoy' : 'Tu cuenta'}
          </p>
          {cargandoSaldo ? (
            <Skeleton className="h-7 w-28 bg-[#f9d2a2]/40" />
          ) : (
            <p className="text-2xl font-extrabold text-[#391511] tabular-nums">
              {debe ? (
                <MontoARS monto={saldo ?? 0} />
              ) : (saldo ?? 0) < -0.009 ? (
                <>
                  <MontoARS monto={-(saldo ?? 0)} />{' '}
                  <span className="text-sm font-semibold text-[#2f8f4e]">
                    a tu favor
                  </span>
                </>
              ) : (
                'Al día 🎉'
              )}
            </p>
          )}
          {debe && (
            <p className="text-[11px] text-[#6f3a2a] mt-0.5">
              Se descuenta de tu próximo sueldo (hasta donde alcance) o podés
              pagarlo en el local.
            </p>
          )}
        </div>
      </div>

      {/* Adelantos y descuentos del mes */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-[#391511] font-bold text-sm flex items-center gap-1.5">
            <HandCoins className="h-4 w-4 text-[#f9b44c]" />
            Adelantos y descuentos
          </h2>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setMes((m) => addMonths(m, -1))}
              className="h-7 w-7 p-0 text-[#6f3a2a]"
              aria-label="Mes anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-[#391511] font-semibold text-xs capitalize min-w-[110px] text-center">
              {format(mes, 'MMMM yyyy', { locale: es })}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setMes((m) => addMonths(m, 1))}
              className="h-7 w-7 p-0 text-[#6f3a2a]"
              aria-label="Mes siguiente"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
        {cargandoNovs ? (
          <Skeleton className="h-16 w-full rounded-xl bg-[#f9d2a2]/30" />
        ) : (novedades ?? []).length === 0 ? (
          <p className="text-sm text-[#6f3a2a] bg-white border border-[#e4c9b0]/60 rounded-xl px-4 py-3">
            Sin adelantos ni descuentos en este mes.
          </p>
        ) : (
          <ul className="rounded-xl border border-[#e4c9b0]/60 overflow-hidden divide-y divide-[#e4c9b0]/40 bg-white">
            {(novedades ?? []).map((n) => (
              <li
                key={n.id}
                className="px-4 py-2.5 flex items-center justify-between gap-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="text-[#391511] font-medium truncate">
                    {ETIQUETA_NOVEDAD[n.tipo] ?? n.tipo}
                  </p>
                  <p className="text-[11px] text-[#c8a58a] truncate">
                    {formatearFechaCorta(n.fecha)}
                    {n.concepto ? ` · ${n.concepto}` : ''}
                  </p>
                </div>
                <span className="font-bold tabular-nums text-[#c43e2c] shrink-0">
                  −<MontoARS monto={n.monto} />
                </span>
              </li>
            ))}
            <li className="px-4 py-2.5 flex items-center justify-between text-sm bg-[#fdfaf6]">
              <span className="text-[#391511] font-bold uppercase tracking-wide text-xs">
                Se descuenta del sueldo de {format(mes, 'MMMM', { locale: es })}
              </span>
              <span className="font-extrabold tabular-nums text-[#391511]">
                −<MontoARS monto={totalNovedades} />
              </span>
            </li>
          </ul>
        )}
      </section>

      {/* Movimientos de la cuenta corriente */}
      <section className="space-y-2">
        <h2 className="text-[#391511] font-bold text-sm">
          Movimientos de mi cuenta
        </h2>
        {cargandoMovs ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full rounded-xl bg-[#f9d2a2]/30" />
            <Skeleton className="h-12 w-full rounded-xl bg-[#f9d2a2]/30" />
          </div>
        ) : (movimientos ?? []).length === 0 ? (
          <p className="text-sm text-[#6f3a2a] bg-white border border-[#e4c9b0]/60 rounded-xl px-4 py-3">
            Sin movimientos todavía. Cuando te lleves algo a cuenta, aparece
            acá.
          </p>
        ) : (
          <ul className="rounded-xl border border-[#e4c9b0]/60 overflow-hidden divide-y divide-[#e4c9b0]/40 bg-white">
            {(movimientos ?? []).map((m) => (
              <li
                key={m.id}
                className="px-4 py-2.5 flex items-center justify-between gap-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="text-[#391511] font-medium truncate">
                    {ETIQUETA_TIPO[m.tipo] ?? m.tipo}
                  </p>
                  <p className="text-[11px] text-[#c8a58a] truncate">
                    {formatearFechaCorta(m.fecha)}
                    {m.concepto ? ` · ${m.concepto}` : ''}
                  </p>
                </div>
                <span
                  className={cn(
                    'font-bold tabular-nums shrink-0',
                    m.monto > 0 ? 'text-[#c43e2c]' : 'text-[#2f8f4e]'
                  )}
                >
                  {m.monto > 0 ? '+' : '−'}
                  <MontoARS monto={Math.abs(m.monto)} />
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[10px] text-[#c8a58a]">
          Rojo = suma a tu deuda · verde = la baja (pagos o descuentos de
          sueldo).
        </p>
      </section>
    </div>
  )
}
