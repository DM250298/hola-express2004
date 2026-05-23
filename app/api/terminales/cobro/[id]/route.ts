import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import {
  cancelarOrdenPago,
  consultarOrdenPago,
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

/** Cancela una orden pendiente en la terminal. */
export async function DELETE(_request: Request, ctx: Ctx) {
  if (!(await verificarSesion())) {
    return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })
  }
  const { id } = await ctx.params

  try {
    await cancelarOrdenPago(id)
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
