'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { base64UrlAUint8Array } from '@/lib/push/cliente'
import {
  actualizarTemas,
  borrarSuscripcion,
  getTemasSuscripcion,
  guardarSuscripcion,
} from '@/lib/queries/push'
import type { TemaPush } from '@/types/database'

type PermisoNotif = 'default' | 'granted' | 'denied'

export interface EstadoPush {
  /** El browser soporta Web Push y hay clave VAPID configurada. */
  soportado: boolean
  permiso: PermisoNotif
  /** Este dispositivo recibe los avisos de este tema. */
  suscripto: boolean
  ocupado: boolean
  suscribir: () => Promise<void>
  desuscribir: () => Promise<void>
}

const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY

/**
 * Avisos Web Push de un tema ('produccion' o 'tareas') en ESTE dispositivo.
 * Un dispositivo tiene una sola suscripción; los temas se suman o se sacan
 * (mig 297). Al sacar el último, se borra la suscripción.
 */
export function usePush(tema: TemaPush): EstadoPush {
  const { data: usuario } = useUsuario()
  const [soportado, setSoportado] = useState(false)
  const [permiso, setPermiso] = useState<PermisoNotif>('default')
  const [suscripto, setSuscripto] = useState(false)
  const [ocupado, setOcupado] = useState(false)

  useEffect(() => {
    const ok =
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window &&
      !!VAPID
    setSoportado(ok)
    if (!ok) return
    setPermiso(Notification.permission as PermisoNotif)
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then(async (sub) => {
        if (!sub) return setSuscripto(false)
        const temas = await getTemasSuscripcion(sub.endpoint)
        setSuscripto(!!temas?.includes(tema))
      })
      .catch(() => {})
  }, [tema])

  const suscribir = useCallback(async () => {
    if (!soportado || !usuario || !VAPID) return
    setOcupado(true)
    try {
      const nuevo = await Notification.requestPermission()
      setPermiso(nuevo as PermisoNotif)
      if (nuevo !== 'granted') {
        toast.error('Permiso de notificaciones denegado.')
        return
      }
      const reg = await navigator.serviceWorker.ready
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlAUint8Array(VAPID),
        }))
      const previos = (await getTemasSuscripcion(sub.endpoint)) ?? []
      const json = sub.toJSON()
      await guardarSuscripcion(
        { endpoint: sub.endpoint, p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' },
        usuario.id,
        [...new Set([...previos, tema])]
      )
      setSuscripto(true)
      toast.success('Avisos activados en este dispositivo')
    } catch (e) {
      toast.error(`No se pudieron activar los avisos: ${e instanceof Error ? e.message : 'error'}`)
    } finally {
      setOcupado(false)
    }
  }, [soportado, usuario, tema])

  const desuscribir = useCallback(async () => {
    if (!soportado) return
    setOcupado(true)
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        const resto = ((await getTemasSuscripcion(sub.endpoint)) ?? []).filter((t) => t !== tema)
        if (resto.length > 0) {
          await actualizarTemas(sub.endpoint, resto)
        } else {
          await borrarSuscripcion(sub.endpoint)
          await sub.unsubscribe()
        }
      }
      setSuscripto(false)
      toast('Avisos desactivados en este dispositivo')
    } catch (e) {
      toast.error(`No se pudieron desactivar los avisos: ${e instanceof Error ? e.message : 'error'}`)
    } finally {
      setOcupado(false)
    }
  }, [soportado, tema])

  return { soportado, permiso, suscripto, ocupado, suscribir, desuscribir }
}
