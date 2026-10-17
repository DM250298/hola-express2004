'use client'

import { usePush, type EstadoPush } from '@/lib/hooks/usePush'

export type { EstadoPush }

/** Avisos del resumen diario de producción en este dispositivo (tema 'produccion'). */
export function usePushProduccion(): EstadoPush {
  return usePush('produccion')
}
