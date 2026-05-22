'use client'

import { useEffect } from 'react'

/**
 * Registra el service worker que cachea el "app shell" para el modo offline
 * del POS (FASE 2).
 *
 * Sólo se registra en producción: en desarrollo, cachear los chunks que
 * cambian con cada recarga rompería el hot-reload de Turbopack.
 */
export function RegistrarServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    if (
      typeof navigator === 'undefined' ||
      !('serviceWorker' in navigator)
    ) {
      return
    }
    navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .catch(() => {
        // Si falla el registro, la app sigue funcionando (sin offline shell).
      })
  }, [])

  return null
}
