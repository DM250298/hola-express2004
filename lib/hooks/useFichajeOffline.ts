'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  EVENTO_COLA_FICHAJES,
  contarFichajesPendientes,
} from '@/lib/offline/colaFichajes'
import { sincronizarFichajesPendientes } from '@/lib/offline/syncFichajes'

const INTERVALO_SYNC = 45 * 1000

export interface EstadoFichajeOffline {
  online: boolean
  pendientes: number
  sincronizando: boolean
  sincronizarAhora: () => void
}

/**
 * Estado de conexión + cola de fichajes del kiosco. Igual que useConexion del
 * POS: reintenta al recuperar internet y cada 45s.
 */
export function useFichajeOffline(): EstadoFichajeOffline {
  const [online, setOnline] = useState(true)
  const [pendientes, setPendientes] = useState(0)
  const [sincronizando, setSincronizando] = useState(false)

  const refrescar = useCallback(async () => {
    setPendientes(await contarFichajesPendientes())
  }, [])

  const sincronizar = useCallback(async () => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return
    setSincronizando(true)
    try {
      await sincronizarFichajesPendientes()
    } finally {
      setSincronizando(false)
      await refrescar()
    }
  }, [refrescar])

  useEffect(() => {
    setOnline(navigator.onLine)
    refrescar()
    sincronizar()

    function alConectar() {
      setOnline(true)
      sincronizar()
    }
    function alDesconectar() {
      setOnline(false)
    }
    window.addEventListener('online', alConectar)
    window.addEventListener('offline', alDesconectar)
    window.addEventListener(EVENTO_COLA_FICHAJES, refrescar)
    return () => {
      window.removeEventListener('online', alConectar)
      window.removeEventListener('offline', alDesconectar)
      window.removeEventListener(EVENTO_COLA_FICHAJES, refrescar)
    }
  }, [sincronizar, refrescar])

  useEffect(() => {
    const id = setInterval(sincronizar, INTERVALO_SYNC)
    return () => clearInterval(id)
  }, [sincronizar])

  return {
    online,
    pendientes,
    sincronizando,
    sincronizarAhora: sincronizar,
  }
}
