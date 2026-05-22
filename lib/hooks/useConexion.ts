'use client'

import { useCallback, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  EVENTO_COLA_CAMBIADA,
  contarVentasPendientes,
} from '@/lib/offline/cola'
import { sincronizarVentasPendientes } from '@/lib/offline/sync'

/** Cada cuánto reintentar la sincronización en segundo plano (ms). */
const INTERVALO_SYNC = 45 * 1000

export interface EstadoConexion {
  /** Hay conexión a internet. */
  online: boolean
  /** Ventas en cola (offline) sin sincronizar. */
  pendientes: number
  /** Hay una sincronización en curso. */
  sincronizando: boolean
  /** Dispara una sincronización manual con avisos al usuario. */
  sincronizarAhora: () => void
}

/**
 * Estado de conexión + cola offline del POS.
 *
 * Escucha los eventos `online`/`offline` del navegador y la cola de ventas,
 * y reintenta sincronizar al recuperar internet y cada cierto intervalo.
 */
export function useConexion(): EstadoConexion {
  const queryClient = useQueryClient()
  const [online, setOnline] = useState(true)
  const [pendientes, setPendientes] = useState(0)
  const [sincronizando, setSincronizando] = useState(false)

  const refrescarPendientes = useCallback(async () => {
    setPendientes(await contarVentasPendientes())
  }, [])

  const sincronizar = useCallback(
    async (silencioso: boolean) => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return
      }
      setSincronizando(true)
      try {
        const r = await sincronizarVentasPendientes()
        if (r.sincronizadas > 0) {
          toast.success(
            `${r.sincronizadas} venta${r.sincronizadas === 1 ? '' : 's'} sincronizada${r.sincronizadas === 1 ? '' : 's'}`
          )
          // Refrescar datos que la sincronización movió en el servidor.
          for (const key of [
            'productos',
            'ventas',
            'inventario',
            'alertas-stock',
            'cuentas',
            'movimientos-cuenta',
            'productos-frecuentes-turno',
          ]) {
            queryClient.invalidateQueries({ queryKey: [key] })
          }
        }
        if (r.conError > 0 && !silencioso) {
          toast.error(
            `${r.conError} venta${r.conError === 1 ? '' : 's'} no se pudieron sincronizar.`
          )
        }
      } finally {
        setSincronizando(false)
        await refrescarPendientes()
      }
    },
    [queryClient, refrescarPendientes]
  )

  // Estado inicial + listeners de conexión y de la cola.
  useEffect(() => {
    setOnline(navigator.onLine)
    refrescarPendientes()
    // Al montar, intentar drenar lo que haya quedado de una sesión previa.
    sincronizar(true)

    function alConectar() {
      setOnline(true)
      sincronizar(true)
    }
    function alDesconectar() {
      setOnline(false)
    }

    window.addEventListener('online', alConectar)
    window.addEventListener('offline', alDesconectar)
    window.addEventListener(EVENTO_COLA_CAMBIADA, refrescarPendientes)
    return () => {
      window.removeEventListener('online', alConectar)
      window.removeEventListener('offline', alDesconectar)
      window.removeEventListener(EVENTO_COLA_CAMBIADA, refrescarPendientes)
    }
  }, [sincronizar, refrescarPendientes])

  // Reintento periódico en segundo plano.
  useEffect(() => {
    const id = setInterval(() => sincronizar(true), INTERVALO_SYNC)
    return () => clearInterval(id)
  }, [sincronizar])

  return {
    online,
    pendientes,
    sincronizando,
    sincronizarAhora: () => sincronizar(false),
  }
}
