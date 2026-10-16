'use client'

import Link from 'next/link'
import { ArrowLeftRight, ChevronRight } from 'lucide-react'
import { usePasesPendientesRecibir } from '@/lib/hooks/usePaseTurno'

interface Props {
  empleadoId: number
}

/** Tarjeta del hub móvil: pase de turno, con badge de pases por recibir. */
export function TarjetaPaseTurno({ empleadoId }: Props) {
  const { data: pendientes } = usePasesPendientesRecibir()
  const porRecibir = (pendientes ?? []).filter((p) => p.saliente_empleado_id !== empleadoId).length

  return (
    <Link
      href="/movil/pase-turno"
      className="group flex items-center gap-4 rounded-2xl border border-[#e4c9b0]/70 bg-white p-4 shadow-sm transition active:scale-[0.99]"
    >
      <span className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#2f7d4f]/10 text-[#2f7d4f]">
        <ArrowLeftRight className="h-7 w-7" />
        {porRecibir > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-[#c43e2c] px-1.5 text-xs font-bold text-white">
            {porRecibir}
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-lg font-bold text-[#391511]">Mi pase de turno</span>
        <span className="block text-xs text-[#6f3a2a]">
          {porRecibir > 0
            ? `${porRecibir} pase${porRecibir === 1 ? '' : 's'} por recibir`
            : 'Recibir el anterior y entregar el tuyo'}
        </span>
      </span>
      <ChevronRight className="h-5 w-5 shrink-0 text-[#c8a58a]" />
    </Link>
  )
}
