'use client'

import Link from 'next/link'
import { ChefHat, ChevronRight } from 'lucide-react'
import { usePendientesProduccion } from '@/lib/hooks/useProduccion'
import { cn } from '@/lib/utils'

/**
 * "Producción pendiente" para Turnos y equipo › Hoy: cuántas órdenes de
 * producción esperan para iniciar (mismo hook que el badge del menú).
 * Montarla solo para quien tiene permiso `produccion`: así la consulta no corre
 * para el resto.
 */
export function TarjetaProduccionPendiente() {
  const { data: count, isLoading } = usePendientesProduccion()
  const pendientes = count ?? 0
  const plural = pendientes !== 1

  return (
    <Link
      href="/produccion?tab=producir"
      className={cn(
        'flex items-center gap-3 rounded-2xl border px-4 py-3 transition-colors',
        pendientes > 0
          ? 'border-[#f9b44c]/50 bg-[#f9b44c]/15 hover:bg-[#f9b44c]/25'
          : 'border-[#e4c9b0]/60 bg-white hover:bg-[#fdfaf6]'
      )}
    >
      <span
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
          pendientes > 0 ? 'bg-[#f9b44c]/30' : 'bg-[#f9d2a2]/40'
        )}
      >
        <ChefHat
          className={cn('h-5 w-5', pendientes > 0 ? 'text-[#b07d1e]' : 'text-[#c8a58a]')}
        />
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-[#391511]">
          Producción pendiente
          {!isLoading && (
            <span className="font-normal text-[#6f3a2a]">
              {' · '}
              {pendientes === 0
                ? 'nada para elaborar'
                : `${pendientes} producto${plural ? 's' : ''} pendiente${plural ? 's' : ''} de elaborar`}
            </span>
          )}
        </p>
        <p className="text-xs text-[#6f3a2a]">
          Órdenes de producción que esperan para iniciar.
        </p>
      </div>
      <ChevronRight className="h-5 w-5 text-[#c8a58a] shrink-0" />
    </Link>
  )
}
