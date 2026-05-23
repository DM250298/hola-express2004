import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { ponerModoIntegrado } from '@/lib/mercadopago/point'

/**
 * Activa el modo "integrado / PDV" en una terminal Point de Mercado Pago.
 * Sin esto, la terminal sigue funcionando como autónoma y no acepta cobros
 * enviados desde el sistema.
 *
 * Body: { device_id: string }
 */
export async function POST(request: Request) {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })
  }

  let body: { device_id?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 })
  }

  const deviceId = (body.device_id ?? '').trim()
  if (!deviceId) {
    return NextResponse.json(
      { error: 'Falta el identificador de la terminal.' },
      { status: 400 }
    )
  }

  try {
    await ponerModoIntegrado(deviceId)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'No se pudo activar el modo PDV.',
      },
      { status: 502 }
    )
  }
}
