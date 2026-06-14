'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { base64UrlAUint8Array } from '@/lib/push/cliente'
import { borrarSuscripcion, guardarSuscripcion } from '@/lib/queries/push'

type PermisoNotif = 'default' | 'granted' | 'denied'

export interface EstadoPush {
  /** El browser soporta Web Push y hay clave VAPID configurada. */
  soportado: boolean
  permiso: PermisoNotif
  /** Este dispositivo ya está suscripto. */
  suscripto: boolean
  ocupado: boolean
  suscribir: () => Promise<void>
  desuscribir: () => Promise<void>
}

const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY

export function usePushProduccion(): EstadoPush {
  const { data: usuario } = useUsuario()
  const [soportado, setSoportado] = useState(false)
  const [permiso, setPermiso] = useState<PermisoNotif>('default')
  const [suscripto, setSuscripto] = useState(false)
  const [ocupado, setOcupado] = useState(false)

  // Detecta soporte y el estado inicial de la suscripción.
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
      .then((sub) => setSuscripto(!!sub))
      .catch(() => {})
  }, [])

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
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlAUint8Array(VAPID),
      })
      const json = sub.toJSON()
      await guardarSuscripcion(
        {
          endpoint: sub.endpoint,
          p256dh: json.keys?.p256dh ?? '',
          auth: json.keys?.auth ?? '',
        },
        usuario.id
      )
      setSuscripto(true)
      toast.success('Avisos activados en este dispositivo')
    } catch (e) {
      toast.error(
        `No se pudieron activar los avisos: ${e instanceof Error ? e.message : 'error'}`
      )
    } finally {
      setOcupado(false)
    }
  }, [soportado, usuario])

  const desuscribir = useCallback(async () => {
    if (!soportado) return
    setOcupado(true)
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await borrarSuscripcion(sub.endpoint)
        await sub.unsubscribe()
      }
      setSuscripto(false)
      toast('Avisos desactivados en este dispositivo')
    } catch (e) {
      toast.error(
        `No se pudieron desactivar los avisos: ${e instanceof Error ? e.message : 'error'}`
      )
    } finally {
      setOcupado(false)
    }
  }, [soportado])

  return { soportado, permiso, suscripto, ocupado, suscribir, desuscribir }
}
