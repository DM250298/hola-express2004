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
 *
 * Identidad (mig 218): la cola es por navegador, no por usuario. Cada venta
 * viaja con el `usuario_id` y el `turno_id` con los que se cobró y con su
 * hora real (`p_fecha = creada_en`), y el servidor solo la acepta si la
 * sesión es de ese usuario —o de alguien con Finanzas (replay por otro)—.
 * Las ventas de OTRO cajero no se tocan: quedan pendientes hasta que esa
 * persona (o un encargado) entre en esta PC, y se informan aparte.
 */

import { createClient } from '@/lib/supabase/client'
import { esErrorDeIdentidad } from '@/lib/auth/erroresIdentidad'
import { setUsuarioSesion } from '@/lib/auth/sesionActual'
import type { Json } from '@/types/database'
import {
  eliminarVentaPendiente,
  leerVentasPendientes,
  marcarErrorVenta,
  type VentaPendiente,
} from './cola'

let sincronizando = false

/**
 * Heurística: ¿el error vino de falta de conexión (vale la pena reintentar)?
 * Solo mensajes de red del navegador. (Antes matcheaba cualquier texto con
 * la palabra "fetch" y trataba como "sin red" rechazos reales del servidor.)
 */
export function esErrorDeRed(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return true
  }
  const msg = error instanceof Error ? error.message : String(error ?? '')
  return /failed to fetch|networkerror|network error|network request failed|load failed|err_internet_disconnected|err_network/i.test(
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
      // Preservar los overrides reales (cobro con terminal MP) y el vale, igual
      // que crearVenta: si no se mapean, la venta sincronizada cae a la comisión
      // estimada de la tabla en vez de la real que MP ya había informado.
      nc_codigo: p.nc_codigo ?? null,
      comision_monto: p.comision_monto ?? null,
      iibb_monto: p.iibb_monto ?? null,
    })) as unknown as Json,
    p_items: v.items.map((it) => ({
      producto_id: it.producto_id,
      cantidad: it.cantidad,
      precio_unitario: it.precio_unitario,
      // Ventas encoladas con el payload viejo no traen la clave → null; el
      // RPC la toma como minorista (mig 153).
      lista_precio: it.lista_precio ?? null,
    })) as unknown as Json,
    p_cliente_uuid: v.cliente_uuid,
    p_cliente_id: v.cliente_id,
    // Hora real del cobro: la venta queda fechada cuando se hizo, no cuando
    // volvió internet (mig 218). Si el turno ya se cerró, el servidor la
    // imputa igual y corrige el esperado de ese cierre.
    p_fecha: v.creada_en,
  })
  if (error) throw error
  if (!data) throw new Error('El servidor no devolvió la venta.')
}

export interface ResultadoSync {
  sincronizadas: number
  conError: number
  /** Ventas del usuario de la sesión que siguen en cola al terminar. */
  pendientes: number
  /** Ventas de OTRO cajero que esta sesión no puede reenviar. */
  deOtroUsuario: number
  /** true si la corrida se cortó por falta de conexión. */
  cortadoPorRed: boolean
}

/** Cuenta la cola separando lo propio de lo de otro usuario. */
export async function contarColaPorUsuario(
  usuarioSesion: string | null
): Promise<{ propias: number; deOtroUsuario: number }> {
  const cola = await leerVentasPendientes()
  if (!usuarioSesion) return { propias: cola.length, deOtroUsuario: 0 }
  const propias = cola.filter((v) => v.usuario_id === usuarioSesion).length
  return { propias, deOtroUsuario: cola.length - propias }
}

/**
 * Drena la cola de ventas pendientes. Seguro de llamar muchas veces: si ya
 * hay una corrida en curso, devuelve sin hacer nada.
 */
export async function sincronizarVentasPendientes(): Promise<ResultadoSync> {
  const supabase = createClient()
  let usuarioSesion: string | null = null
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession()
    usuarioSesion = session?.user.id ?? null
    // Mantener el store de sesión al día (el guardián puede no haber corrido
    // todavía cuando el POS drena la cola al montar).
    if (usuarioSesion) setUsuarioSesion(usuarioSesion)
  } catch {
    usuarioSesion = null
  }

  if (sincronizando || !usuarioSesion) {
    const c = await contarColaPorUsuario(usuarioSesion)
    return {
      sincronizadas: 0,
      conError: 0,
      pendientes: c.propias,
      deOtroUsuario: c.deOtroUsuario,
      cortadoPorRed: false,
    }
  }
  sincronizando = true

  let sincronizadas = 0
  let conError = 0
  let cortadoPorRed = false

  try {
    // Solo Finanzas (admin incluido) puede reenviar ventas de otro cajero.
    let puedeReplay = false
    try {
      const { data } = await supabase.rpc('fn_tiene_permiso', {
        p_clave: 'finanzas',
      })
      puedeReplay = data === true
    } catch {
      puedeReplay = false
    }

    const cola = await leerVentasPendientes()
    for (const venta of cola) {
      // Las que quedaron en error se reintentan sólo manualmente.
      if (venta.estado === 'error') continue
      // Las de otro cajero se dejan para cuando entre esa persona.
      if (venta.usuario_id !== usuarioSesion && !puedeReplay) continue
      try {
        await enviarVenta(venta)
        await eliminarVentaPendiente(venta.cliente_uuid)
        sincronizadas += 1
      } catch (error) {
        if (esErrorDeRed(error)) {
          cortadoPorRed = true
          break
        }
        // El servidor no reconoce esta sesión como dueña de la venta: no es
        // un error de la venta, queda pendiente para el usuario correcto.
        if (esErrorDeIdentidad(error)) continue
        const msg =
          error instanceof Error ? error.message : 'Error desconocido'
        await marcarErrorVenta(venta.cliente_uuid, msg)
        conError += 1
      }
    }
  } finally {
    sincronizando = false
  }

  const c = await contarColaPorUsuario(usuarioSesion)
  return {
    sincronizadas,
    conError,
    pendientes: c.propias,
    deOtroUsuario: c.deOtroUsuario,
    cortadoPorRed,
  }
}
