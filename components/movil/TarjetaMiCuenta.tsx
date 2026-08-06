'use client'

import Link from 'next/link'
import { ChevronRight, Wallet } from 'lucide-react'
import { MontoARS } from '@/components/shared/MontoARS'
import { useMiSaldoCtaCte } from '@/lib/hooks/useMiCuenta'

/**
 * Tarjeta del hub móvil que enlaza a "Mi cuenta" y muestra cuánto debe el
 * empleado. Client porque el saldo sale de fn_mi_saldo_cta_cte (definer,
 * resuelta por auth.uid()). Si la migración 143 no corrió aún, la query
 * falla en silencio y la tarjeta se muestra sin el monto.
 */
export function TarjetaMiCuenta() {
  const { data: saldo } = useMiSaldoCtaCte()
  const debe = (saldo ?? 0) > 0.009

  return (
    <Link
      href="/movil/mi-cuenta"
      className="group flex items-center gap-4 rounded-2xl border border-[#e4c9b0]/70 bg-white p-4 shadow-sm transition active:scale-[0.99]"
    >
      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#f9d2a2]/50 text-[#9e6b15]">
        <Wallet className="h-7 w-7" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-lg font-bold text-[#391511]">
          Mi cuenta
        </span>
        <span className="block text-xs text-[#6f3a2a]">
          {debe ? (
            <>
              Debés <MontoARS monto={saldo ?? 0} /> · mirá el detalle
            </>
          ) : (
            'Tu cuenta corriente y tus adelantos'
          )}
        </span>
      </span>
      <ChevronRight className="h-5 w-5 shrink-0 text-[#c8a58a]" />
    </Link>
  )
}
