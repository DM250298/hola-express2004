'use client'

import Link from 'next/link'
import { AlertTriangle, ChevronRight } from 'lucide-react'
import { useSesionConteoActiva } from '@/lib/hooks/useConteoFisico'

/**
 * Aviso operativo en el módulo de Inventario mientras hay una sesión de
 * conteo físico viva: la zona congelada es una regla de trabajo (no se
 * repone mientras se cuenta), no un bloqueo del sistema.
 */
export function BannerConteoActivo() {
  const { data: sesion } = useSesionConteoActiva()

  if (!sesion) return null

  return (
    <Link
      href="/inventario/conteo"
      className="mb-4 flex items-center gap-3 rounded-2xl border border-[#f9b44c] bg-[#f9b44c]/15 px-4 py-3 transition hover:bg-[#f9b44c]/25"
    >
      <AlertTriangle className="h-5 w-5 shrink-0 text-[#a3641c]" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-[#391511]">
          Conteo físico en curso: {sesion.nombre}
        </p>
        <p className="text-xs text-[#6f3a2a]">
          No reponer las zonas mientras se cuentan. Tocá para ver el conteo.
        </p>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-[#6f3a2a]" />
    </Link>
  )
}
