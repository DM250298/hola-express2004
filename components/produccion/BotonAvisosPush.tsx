'use client'

import { Bell, BellOff, BellRing } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { usePushProduccion } from '@/lib/hooks/usePushProduccion'

/**
 * Toggle para recibir el resumen diario de producción pendiente como Web Push
 * en ESTE dispositivo. Se oculta si el browser no soporta push o falta la
 * clave VAPID (queda deshabilitado hasta configurarla y redeployar).
 */
export function BotonAvisosPush() {
  const { soportado, permiso, suscripto, ocupado, suscribir, desuscribir } =
    usePushProduccion()

  if (!soportado) return null

  if (permiso === 'denied') {
    return (
      <Button
        variant="outline"
        disabled
        title="Las notificaciones están bloqueadas para este sitio. Habilitalas desde el candado de la barra de direcciones."
        className="border-[#e4c9b0] text-[#c8a58a] gap-1.5"
      >
        <BellOff className="h-4 w-4" />
        Avisos bloqueados
      </Button>
    )
  }

  if (suscripto) {
    return (
      <Button
        variant="outline"
        onClick={desuscribir}
        disabled={ocupado}
        className="border-[#2f8f4e]/40 text-[#2f8f4e] gap-1.5"
        title="Recibís el resumen diario de producción en este dispositivo. Tocá para desactivar."
      >
        <BellRing className="h-4 w-4" />
        Avisos activados
      </Button>
    )
  }

  return (
    <Button
      variant="outline"
      onClick={suscribir}
      disabled={ocupado}
      className="border-[#e4c9b0] text-[#6f3a2a] gap-1.5"
      title="Recibí en este dispositivo un resumen diario de lo que hay para elaborar."
    >
      <Bell className="h-4 w-4" />
      Activar avisos
    </Button>
  )
}
