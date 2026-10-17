'use client'

import { Bell, BellOff, BellRing } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { usePush } from '@/lib/hooks/usePush'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { tienePermiso } from '@/lib/permisos'
import { cn } from '@/lib/utils'

/**
 * Recibir en ESTE celular los avisos de tareas atrasadas (Tareas v2, Etapa 6 B).
 * Solo para encargadas y administradores (a quienes les llegan los avisos);
 * se oculta si el navegador no soporta notificaciones. En iPhone funciona
 * solo con HEX instalado en la pantalla de inicio.
 */
export function BotonAvisosTareas({ className }: { className?: string }) {
  const { data: usuario } = useUsuario()
  const recibe =
    usuario?.rol === 'admin' ||
    tienePermiso(usuario?.permisos, 'tareas_gestion') ||
    tienePermiso(usuario?.permisos, 'tareas_admin')
  const { soportado, permiso, suscripto, ocupado, suscribir, desuscribir } = usePush('tareas')

  if (!recibe || !soportado) return null

  if (permiso === 'denied') {
    return (
      <Button
        variant="outline"
        disabled
        title="Las notificaciones están bloqueadas para este sitio. Habilitalas desde el candado de la barra de direcciones."
        className={cn('border-[#e4c9b0] text-[#c8a58a] gap-1.5', className)}
      >
        <BellOff className="h-4 w-4" /> Avisos bloqueados
      </Button>
    )
  }

  return suscripto ? (
    <Button
      variant="outline"
      onClick={desuscribir}
      disabled={ocupado}
      title="Te llegan los avisos de tareas atrasadas en este dispositivo. Tocá para desactivarlos."
      className={cn('border-[#2f8f4e]/40 text-[#2f8f4e] gap-1.5', className)}
    >
      <BellRing className="h-4 w-4" /> Avisos de atrasos activados
    </Button>
  ) : (
    <Button
      variant="outline"
      onClick={suscribir}
      disabled={ocupado}
      title="Recibí en este dispositivo un aviso cuando una tarea se atrasa, aunque HEX esté cerrado."
      className={cn('border-[#e4c9b0] text-[#6f3a2a] gap-1.5', className)}
    >
      <Bell className="h-4 w-4" /> Recibir avisos de atrasos en este dispositivo
    </Button>
  )
}
