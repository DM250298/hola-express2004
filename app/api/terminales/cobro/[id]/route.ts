import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import {
  cancelarIntencionPago,
  consultarIntencionPago,
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

/** Consulta el estado de una intención de pago (polling desde el POS). */
export async function GET(_request: Request, ctx: Ctx) {
  if (!(await verificarSesion())) {
    return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })
  }
  const { id } = await ctx.params

  try {
    const intencion = await consultarIntencionPago(id)
    return NextResponse.json({ intencion })
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
 * Cancela una intención de pago pendiente.
 * Requiere ?device_id= en la query (la API de Mercado Pago lo necesita).
 */
export async function DELETE(request: Request, ctx: Ctx) {
  if (!(await verificarSesion())) {
    return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })
  }
  const { id } = await ctx.params
  const deviceId = new URL(request.url).searchParams.get('device_id') ?? ''

  if (!deviceId) {
    return NextResponse.json(
      { error: 'Falta el identificador de la terminal.' },
      { status: 400 }
    )
  }

  try {
    await cancelarIntencionPago(deviceId, id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'No se pudo cancelar el cobro.',
      },
      { status: 502 }
    )
  }
}
