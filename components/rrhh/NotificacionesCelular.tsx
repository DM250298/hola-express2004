'use client'

import { useEffect, useState } from 'react'
import { Bell, BellOff, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { usePush, type EstadoPush } from '@/lib/hooks/usePush'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { tienePermiso } from '@/lib/permisos'
import { cn } from '@/lib/utils'

/**
 * Notificaciones de tareas en ESTE celular (Tareas v2, Etapa 7), arriba de Mi
 * turno. Sin nada activado: un botón para activar las urgentes. Activado: los
 * interruptores (urgentes, cuando empieza cada tarea y, para la encargada y los
 * administradores, los atrasos del equipo). En iPhone hace falta HEX instalado
 * en la pantalla de inicio.
 */
export function NotificacionesCelular() {
  const { data: usuario } = useUsuario()
  const gestion =
    usuario?.rol === 'admin' ||
    tienePermiso(usuario?.permisos, 'tareas_gestion') ||
    tienePermiso(usuario?.permisos, 'tareas_admin')
  const urgentes = usePush('mis_tareas')
  const inicio = usePush('inicio_tareas')
  const atrasos = usePush('tareas')
  const [abierta, setAbierta] = useState(false)
  const [iphoneSinInstalar, setIphoneSinInstalar] = useState(false)

  useEffect(() => {
    const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent)
    const instalada = window.matchMedia('(display-mode: standalone)').matches
    setIphoneSinInstalar(ios && !instalada)
  }, [])

  if (!urgentes.soportado) {
    if (!iphoneSinInstalar) return null
    return (
      <p className="rounded-xl border border-[#e4c9b0]/60 bg-white px-3 py-2.5 text-xs text-[#6f3a2a]">
        <Bell className="mr-1 inline h-3.5 w-3.5" />
        Para recibir avisos de tus tareas en el iPhone, instalá HEX en la pantalla de inicio (Safari → Compartir →
        Agregar a inicio) y abrilo desde ese ícono.
      </p>
    )
  }

  if (urgentes.permiso === 'denied') {
    return (
      <p className="rounded-xl border border-[#e4c9b0]/60 bg-white px-3 py-2.5 text-xs text-[#6f3a2a]">
        <BellOff className="mr-1 inline h-3.5 w-3.5" />
        Las notificaciones están bloqueadas para HEX en este celular. Habilitalas desde la configuración del navegador.
      </p>
    )
  }

  const algunaActiva = urgentes.suscripto || inicio.suscripto || (gestion && atrasos.suscripto)
  const ocupado = urgentes.ocupado || inicio.ocupado || atrasos.ocupado

  if (!algunaActiva) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-[#f9b44c]/60 bg-[#fff6e5] px-3 py-2.5">
        <Bell className="h-5 w-5 shrink-0 text-[#a06b00]" />
        <p className="min-w-0 flex-1 text-xs text-[#4a3008]">Recibí en este celular un aviso cuando te cargan una tarea urgente.</p>
        <Button size="sm" onClick={urgentes.suscribir} disabled={ocupado} className="bg-[#391511] text-white hover:bg-[#2a0f0c]">
          Activar
        </Button>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-[#e4c9b0]/60 bg-white">
      <button
        type="button"
        onClick={() => setAbierta((v) => !v)}
        aria-expanded={abierta}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs font-semibold text-[#2f7d4f]"
      >
        <Bell className="h-4 w-4" />
        <span className="flex-1">Notificaciones activadas en este celular</span>
        <span className="text-[#6f3a2a]">Ajustar</span>
        <ChevronDown className={cn('h-4 w-4 text-[#c8a58a] transition-transform', abierta && 'rotate-180')} />
      </button>
      {abierta && (
        <div className="space-y-3 border-t border-[#e4c9b0]/60 px-3 py-3">
          <Interruptor h={urgentes} titulo="Tareas urgentes" ayuda="Cuando te cargan o te pasan una tarea urgente para tu turno." />
          <Interruptor h={inicio} titulo="Cuando empieza cada tarea" ayuda="A la hora de inicio de cada tarea con horario." />
          {gestion && <Interruptor h={atrasos} titulo="Tareas atrasadas del equipo" ayuda="Cuando una tarea se atrasa y te toca enterarte." />}
        </div>
      )}
    </div>
  )
}

function Interruptor({ h, titulo, ayuda }: { h: EstadoPush; titulo: string; ayuda: string }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3">
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-[#391511]">{titulo}</span>
        <span className="block text-xs text-[#6f3a2a]">{ayuda}</span>
      </span>
      <Switch
        checked={h.suscripto}
        disabled={h.ocupado}
        onCheckedChange={(v) => (v ? h.suscribir() : h.desuscribir())}
        className="mt-1"
      />
    </label>
  )
}
