/**
 * Motor de sincronización de ventas offline.
 *
 * Recorre la cola de ventas pendientes y las reenvía al servidor llamando a
 * `fn_crear_venta` con el `cliente_uuid` de cada una (idempotente: si ya
 * estaba registrada, el servidor la devuelve sin duplicar).
 *
 *  • Venta enviada OK            → se quita de la cola.
 *  • El servidor la rechaza      → se marca con error (no se reintenta sola).
 *  • Falla de red a mitad        → se corta; se reintenta al volver internet.
 */

import { createClient } from '@/lib/supabase/client'
import type { Json } from '@/types/database'
import {
  contarVentasPendientes,
  eliminarVentaPendiente,
  leerVentasPendientes,
  marcarErrorVenta,
  type VentaPendiente,
} from './cola'

let sincronizando = false

/** Heurística: ¿el error vino de falta de conexión (vale la pena reintentar)? */
export function esErrorDeRed(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return true
  }
  const msg = error instanceof Error ? error.message : String(error ?? '')
  return /failed to fetch|networkerror|network error|load failed|fetch/i.test(
    msg
  )
}

/** Reenvía una venta de la cola al servidor. Lanza si falla. */
async function enviarVenta(v: VentaPendiente): Promise<void> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_crear_venta', {
    p_turno_id: v.turno_id,
    p_usuario_id: v.usuario_id,
    p_pagos: v.pagos.map((p) => ({
      medio_pago: p.medio_pago,
      monto: p.monto,
    })) as unknown as Json,
    p_items: v.items.map((it) => ({
      producto_id: it.producto_id,
      cantidad: it.cantidad,
      precio_unitario: it.precio_unitario,
    })) as unknown as Json,
    p_cliente_uuid: v.cliente_uuid,
    p_cliente_id: v.cliente_id,
  })
  if (error) throw error
  if (!data) throw new Error('El servidor no devolvió la venta.')
}

export interface ResultadoSync {
  sincronizadas: number
  conError: number
  /** Ventas que siguen en cola al terminar. */
  pendientes: number
  /** true si la corrida se cortó por falta de conexión. */
  cortadoPorRed: boolean
}

/**
 * Drena la cola de ventas pendientes. Seguro de llamar muchas veces: si ya
 * hay una corrida en curso, devuelve sin hacer nada.
 */
export async function sincronizarVentasPendientes(): Promise<ResultadoSync> {
  if (sincronizando) {
    return {
      sincronizadas: 0,
      conError: 0,
      pendientes: await contarVentasPendientes(),
      cortadoPorRed: false,
    }
  }
  sincronizando = true

  let sincronizadas = 0
  let conError = 0
  let cortadoPorRed = false

  try {
    const cola = await leerVentasPendientes()
    for (const venta of cola) {
      // Las que quedaron en error se reintentan sólo manualmente.
      if (venta.estado === 'error') continue
      try {
        await enviarVenta(venta)
        await eliminarVentaPendiente(venta.cliente_uuid)
        sincronizadas += 1
      } catch (error) {
        if (esErrorDeRed(error)) {
          cortadoPorRed = true
          break
        }
        const msg =
          error instanceof Error ? error.message : 'Error desconocido'
        await marcarErrorVenta(venta.cliente_uuid, msg)
        conError += 1
      }
    }
  } finally {
    sincronizando = false
  }

  return {
    sincronizadas,
    conError,
    pendientes: await contarVentasPendientes(),
    cortadoPorRed,
  }
}
