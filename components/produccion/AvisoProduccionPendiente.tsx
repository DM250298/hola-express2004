'use client'

import Link from 'next/link'
import { ChefHat, ChevronRight } from 'lucide-react'
import { usePendientesProduccion } from '@/lib/hooks/useProduccion'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { tienePermiso } from '@/lib/permisos'

/**
 * Aviso para los encargados (permiso producción) cuando hay productos
 * pendientes de elaborar. Se muestra arriba del Dashboard.
 */
export function AvisoProduccionPendiente() {
  const { data: usuario } = useUsuario()
  const { data: count } = usePendientesProduccion()

  if (!tienePermiso(usuario?.permisos, 'produccion')) return null
  if (!count || count <= 0) return null

  const plural = count > 1
  return (
    <Link
      href="/produccion"
      className="flex items-center gap-3 rounded-2xl border border-[#f9b44c]/50 bg-[#f9b44c]/15 px-4 py-3 transition-colors hover:bg-[#f9b44c]/25"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#f9b44c]/30">
        <ChefHat className="h-5 w-5 text-[#b07d1e]" />
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-[#391511]">
          {count} producto{plural ? 's' : ''} pendiente{plural ? 's' : ''} de elaborar
        </p>
        <p className="text-xs text-[#6f3a2a]">
          Hay órdenes de producción esperando para iniciar.
        </p>
      </div>
      <ChevronRight className="h-5 w-5 text-[#b07d1e] shrink-0" />
    </Link>
  )
}
