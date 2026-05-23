import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import {
  crearOrdenPago,
  liberarOrdenesPendientes,
} from '@/lib/mercadopago/point'

/**
 * Crea una orden de cobro en una terminal Point.
 * Body: { device_id: string, monto: number (pesos), referencia?: string }
 *
 * Si MP responde `already_queued_order_on_terminal`, la ruta intenta
 * cancelar automáticamente las órdenes pendientes de la terminal y
 * reintenta UNA vez.
 */
export async function POST(request: Request) {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })
  }

  let body: { device_id?: string; monto?: number; referencia?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 })
  }

  const deviceId = (body.device_id ?? '').trim()
  const monto = Number(body.monto)
  const referencia = (body.referencia ?? '').trim()

  if (!deviceId) {
    return NextResponse.json(
      { error: 'Falta el identificador de la terminal.' },
      { status: 400 }
    )
  }
  if (!(monto > 0)) {
    return NextResponse.json(
      { error: 'El monto debe ser mayor a cero.' },
      { status: 400 }
    )
  }

  try {
    const orden = await crearOrdenPago(deviceId, monto, referencia)
    return NextResponse.json({ orden })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    // Si la terminal tiene una orden colgada, intentamos limpiarla y reintentar.
    if (/already_queued/i.test(msg)) {
      const canceladas = await liberarOrdenesPendientes(deviceId)
      try {
        const orden = await crearOrdenPago(deviceId, monto, referencia)
        return NextResponse.json({ orden, limpieza: { canceladas } })
      } catch (e2) {
        return NextResponse.json(
          {
            error:
              e2 instanceof Error
                ? `${e2.message} (no se pudo liberar la terminal; canceladas previas: ${canceladas})`
                : 'No se pudo enviar el cobro.',
          },
          { status: 502 }
        )
      }
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'No se pudo enviar el cobro a la terminal.',
      },
      { status: 502 }
    )
  }
}
