import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import {
  cancelarOrdenPago,
  consultarOrdenPago,
  liberarDispositivo,
} from '@/lib/mercadopago/point'

interface Ctx {
  params: Promise<{ id: string }>
}

async function verificarSesion(): Promise<boolean> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return !!user
}

/** Consulta el estado de una orden (polling desde el POS). */
export async function GET(_request: Request, ctx: Ctx) {
  if (!(await verificarSesion())) {
    return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })
  }
  const { id } = await ctx.params

  try {
    const orden = await consultarOrdenPago(id)
    return NextResponse.json({ orden })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'No se pudo consultar el estado del cobro.',
      },
      { status: 502 }
    )
  }
}

/**
 * Cancela una orden pendiente en la terminal.
 * Recibe device_id opcional vía query para liberar también la cola del
 * dispositivo — esto es lo que realmente saca el monto de la pantalla
 * de la maquinita.
 */
export async function DELETE(request: Request, ctx: Ctx) {
  if (!(await verificarSesion())) {
    return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })
  }
  const { id } = await ctx.params
  const deviceId =
    new URL(request.url).searchParams.get('device_id')?.trim() ?? ''

  // 1. Cancelar la orden a nivel /v1/orders (best effort).
  let cancelOrdenOk = false
  let cancelOrdenError: string | null = null
  try {
    await cancelarOrdenPago(id)
    cancelOrdenOk = true
  } catch (e) {
    cancelOrdenError = e instanceof Error ? e.message : 'error'
  }

  // 2. Liberar el dispositivo a nivel terminal (más confiable).
  let liberarOk = false
  let liberarError: string | null = null
  if (deviceId) {
    try {
      await liberarDispositivo(deviceId)
      liberarOk = true
    } catch (e) {
      liberarError = e instanceof Error ? e.message : 'error'
    }
  }

  // Si al menos una de las dos vías funcionó, consideramos cancelado OK.
  if (cancelOrdenOk || liberarOk) {
    return NextResponse.json({
      ok: true,
      cancelOrdenOk,
      liberarOk,
      cancelOrdenError,
      liberarError,
    })
  }

  return NextResponse.json(
    {
      error: 'No se pudo cancelar el cobro en la terminal.',
      cancelOrdenError,
      liberarError,
    },
    { status: 502 }
  )
}
