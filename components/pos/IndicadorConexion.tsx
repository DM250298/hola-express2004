'use client'

import { CloudOff, Loader2, RefreshCw, UserX, Wifi, WifiOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useConexion } from '@/lib/hooks/useConexion'
import { cn } from '@/lib/utils'

/**
 * Indicador de conexión del POS (FASE 2 — offline).
 *
 *  • En línea, sin cola      → punto verde discreto.
 *  • Sin conexión            → chip ámbar; el POS sigue vendiendo.
 *  • Ventas en cola          → chip con el contador + botón "Sincronizar".
 *  • Ventas de otro cajero   → chip aparte: no se envían con esta sesión.
 *  • Sincronizando           → spinner.
 */
export function IndicadorConexion() {
  const { online, pendientes, deOtroUsuario, sincronizando, sincronizarAhora } =
    useConexion()

  // Caso normal: todo en línea y sin nada pendiente.
  if (online && pendientes === 0 && deOtroUsuario === 0 && !sincronizando) {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-xs font-medium text-[#2f8f4e]"
        title="Conectado — las ventas se registran al instante"
      >
        <Wifi className="h-3.5 w-3.5" />
        <span className="hidden md:inline">En línea</span>
      </span>
    )
  }

  return (
    <div className="inline-flex items-center gap-1.5">
      {(pendientes > 0 || !online || sincronizando) && (
        <div
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg border px-2 py-1',
            online
              ? 'border-[#f9b44c]/50 bg-[#f9b44c]/10'
              : 'border-[#c43e2c]/40 bg-[#c43e2c]/10'
          )}
        >
          {/* Estado de red */}
          {online ? (
            <CloudOff className="h-3.5 w-3.5 text-[#6f3a2a]" />
          ) : (
            <WifiOff className="h-3.5 w-3.5 text-[#c43e2c]" />
          )}
          <span
            className={cn(
              'text-xs font-semibold whitespace-nowrap',
              online ? 'text-[#6f3a2a]' : 'text-[#c43e2c]'
            )}
          >
            {online ? 'Sincronizando datos' : 'Sin conexión'}
          </span>

          {/* Contador de cola */}
          {pendientes > 0 && (
            <span
              className="inline-flex items-center justify-center min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-[#c43e2c] text-white text-[10px] font-bold tabular-nums"
              title={`${pendientes} venta(s) sin sincronizar`}
            >
              {pendientes}
            </span>
          )}

          {/* Acción de sincronizar (sólo si hay red y cola) */}
          {sincronizando ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#6f3a2a]" />
          ) : (
            online &&
            pendientes > 0 && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={sincronizarAhora}
                className="h-6 px-1.5 text-[10px] font-semibold text-[#6f3a2a] hover:bg-[#f9d2a2]/50 hover:text-[#391511] gap-1"
                title="Sincronizar ventas en cola"
              >
                <RefreshCw className="h-3 w-3" />
                <span className="hidden sm:inline">Sincronizar</span>
              </Button>
            )
          )}
        </div>
      )}

      {/* Ventas hechas sin conexión por OTRO usuario en esta PC: esta sesión
          no puede enviarlas a su nombre (mig 218). */}
      {deOtroUsuario > 0 && (
        <span
          className="inline-flex items-center gap-1 rounded-lg border border-[#c8a58a]/60 bg-[#c8a58a]/15 px-2 py-1 text-xs font-semibold text-[#6f3a2a] whitespace-nowrap"
          title="Ventas cobradas sin conexión por otro cajero. Se envían cuando esa persona (o un encargado) inicie sesión en esta PC."
        >
          <UserX className="h-3.5 w-3.5" />
          {deOtroUsuario} de otro cajero
        </span>
      )}
    </div>
  )
}
