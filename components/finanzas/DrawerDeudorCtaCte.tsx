'use client'

import { HandCoins, ShoppingCart } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { MontoARS } from '@/components/shared/MontoARS'
import {
  BadgeSaldoCtaCte,
  estadoSaldoCtaCte,
} from '@/components/shared/BadgeSaldoCtaCte'
import { formatearFechaCorta } from '@/lib/utils/formato'
import { useMovimientosDeudor } from '@/lib/hooks/useCtaCte'
import { cn } from '@/lib/utils'
import type { DeudorCartera } from '@/lib/queries/ctaCte'

const ETIQUETA_TIPO: Record<string, string> = {
  consumo: 'Consumo',
  pago_libre: 'Pago',
  descuento_sueldo: 'Descontado del sueldo',
  ajuste: 'Ajuste',
}

interface Props {
  deudor: DeudorCartera | null
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  /** Pide al padre abrir el modal de cobro para este deudor. */
  onCobrar: (deudor: DeudorCartera) => void
  /** Pide al padre abrir el modal de tope para este deudor. */
  onTope: (deudor: DeudorCartera) => void
}

/** Detalle de la cuenta corriente de un deudor: saldo, tope y movimientos. */
export function DrawerDeudorCtaCte({
  deudor,
  abierto,
  onCambioAbierto,
  onCobrar,
  onTope,
}: Props) {
  const { data: movimientos, isLoading } = useMovimientosDeudor(
    abierto ? (deudor?.deudor_tipo ?? null) : null,
    abierto ? (deudor?.deudor_id ?? null) : null
  )

  if (!deudor) return null

  const estado = estadoSaldoCtaCte(deudor.saldo, deudor.tiene_cupo)

  return (
    <Sheet open={abierto} onOpenChange={onCambioAbierto}>
      <SheetContent className="sm:max-w-md overflow-y-auto p-0">
        <SheetHeader className="px-5 py-4 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <SheetTitle className="text-[#391511] flex items-center justify-between gap-2">
            <span className="truncate">{deudor.nombre}</span>
            <BadgeSaldoCtaCte estado={estado} />
          </SheetTitle>
          <SheetDescription className="text-[#6f3a2a]">
            Cuenta corriente ·{' '}
            {deudor.deudor_tipo === 'empleado' ? 'Empleado' : 'Cliente'}
            {deudor.documento ? ` · ${deudor.documento}` : ''}
          </SheetDescription>
        </SheetHeader>

        <div className="px-5 py-4 space-y-4">
          {/* Saldos */}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-[#e4c9b0]/60 bg-[#fdfaf6] px-3 py-2.5">
              <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                Debe
              </div>
              <div className="text-xl font-extrabold text-[#391511] tabular-nums">
                <MontoARS monto={Math.max(0, deudor.saldo)} />
              </div>
              {deudor.saldo < -0.009 && (
                <div className="text-[10px] text-[#2f8f4e]">
                  Tiene <MontoARS monto={-deudor.saldo} /> a favor
                </div>
              )}
            </div>
            <div className="rounded-xl border border-[#e4c9b0]/60 bg-[#fdfaf6] px-3 py-2.5">
              <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                Cupo disponible
              </div>
              <div className="text-xl font-extrabold text-[#391511] tabular-nums">
                {deudor.disponible !== null ? (
                  <MontoARS monto={deudor.disponible} />
                ) : (
                  <span className="text-sm text-[#c8a58a]">ver en Tope</span>
                )}
              </div>
            </div>
          </div>

          {/* Acciones */}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onTope(deudor)}
              className="flex-1 border-[#e4c9b0] text-[#6f3a2a]"
            >
              Tope de fiado
            </Button>
            <Button
              type="button"
              onClick={() => onCobrar(deudor)}
              disabled={deudor.saldo <= 0.009}
              className="flex-[2] bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5"
            >
              <HandCoins className="h-4 w-4" />
              Cobrar
            </Button>
          </div>

          {/* Movimientos */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold mb-2">
              Movimientos
            </div>
            {isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : (movimientos ?? []).length === 0 ? (
              <p className="text-sm text-[#6f3a2a] italic py-4 text-center">
                Sin movimientos todavía.
              </p>
            ) : (
              <ul className="rounded-xl border border-[#e4c9b0]/60 overflow-hidden divide-y divide-[#e4c9b0]/40 bg-white">
                {(movimientos ?? []).map((m) => (
                  <li
                    key={m.id}
                    className="px-3 py-2 flex items-center justify-between gap-2 text-sm"
                  >
                    <div className="min-w-0">
                      <div className="text-[#391511] font-medium truncate">
                        {ETIQUETA_TIPO[m.tipo] ?? m.tipo}
                        {m.venta_id && (
                          <Link
                            href={`/ventas?venta=${m.venta_id}`}
                            className="ml-1.5 inline-flex items-center gap-0.5 text-[10px] text-[#6f3a2a] underline decoration-dotted hover:text-[#391511]"
                          >
                            <ShoppingCart className="h-3 w-3" />
                            venta #{m.venta_id}
                          </Link>
                        )}
                      </div>
                      <div className="text-[11px] text-[#c8a58a] truncate">
                        {formatearFechaCorta(m.fecha)}
                        {m.concepto ? ` · ${m.concepto}` : ''}
                      </div>
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
            <p className="text-[10px] text-[#c8a58a] mt-1.5">
              Rojo = aumenta la deuda · verde = la cancela.
            </p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
