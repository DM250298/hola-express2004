'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, Loader2, Lock } from 'lucide-react'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { tienePermiso } from '@/lib/permisos'
import { cn } from '@/lib/utils'
import { ConteoRapidoMovil } from './ConteoRapidoMovil'
import { ConteoFormalMovil } from './ConteoFormalMovil'

type Modo = 'rapido' | 'formal'

function Marco({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-md px-4 py-4 pb-28">
      <header className="mb-3">
        <Link
          href="/movil"
          className="flex items-center gap-1 text-sm font-medium text-[#6f3a2a]"
        >
          <ChevronLeft className="h-4 w-4" /> Volver
        </Link>
        <h1 className="mt-1 text-xl font-extrabold text-[#391511]">
          Contar stock
        </h1>
      </header>
      {children}
    </div>
  )
}

export function ConteoMovil() {
  const { data: usuario, isLoading } = useUsuario()
  // El conteo rápido crea ajustes de stock → requiere `inventario_ajustes`.
  // El conteo formal (asignar/aprobar) requiere `conteo_gestion`.
  const puedeRapido = tienePermiso(usuario?.permisos, 'inventario_ajustes')
  const puedeFormal = tienePermiso(usuario?.permisos, 'conteo_gestion')
  const [modo, setModo] = useState<Modo>('rapido')

  if (isLoading) {
    return (
      <Marco>
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-[#9e6b15]" />
        </div>
      </Marco>
    )
  }

  if (!puedeRapido && !puedeFormal) {
    return (
      <Marco>
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-[#e4c9b0] bg-white p-8 text-center">
          <Lock className="h-6 w-6 text-[#c43e2c]" />
          <p className="font-semibold text-[#391511]">
            No tenés permiso para contar o ajustar stock.
          </p>
          <p className="text-sm text-[#6f3a2a]">
            Pedile al encargado que te habilite los ajustes de inventario.
          </p>
        </div>
      </Marco>
    )
  }

  // Modo efectivo: respeta los permisos disponibles.
  const modoEfectivo: Modo = !puedeRapido
    ? 'formal'
    : !puedeFormal
      ? 'rapido'
      : modo

  return (
    <Marco>
      {puedeRapido && puedeFormal && (
        <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-[#391511]/5 p-1">
          <button
            type="button"
            onClick={() => setModo('rapido')}
            className={cn(
              'rounded-lg py-2 text-sm font-semibold transition',
              modoEfectivo === 'rapido'
                ? 'bg-white text-[#391511] shadow-sm'
                : 'text-[#6f3a2a]'
            )}
          >
            Conteo rápido
          </button>
          <button
            type="button"
            onClick={() => setModo('formal')}
            className={cn(
              'rounded-lg py-2 text-sm font-semibold transition',
              modoEfectivo === 'formal'
                ? 'bg-white text-[#391511] shadow-sm'
                : 'text-[#6f3a2a]'
            )}
          >
            Conteos asignados
          </button>
        </div>
      )}

      {modoEfectivo === 'rapido' ? (
        <ConteoRapidoMovil usuarioId={usuario?.id ?? null} />
      ) : (
        <ConteoFormalMovil usuarioId={usuario?.id ?? null} />
      )}
    </Marco>
  )
}
