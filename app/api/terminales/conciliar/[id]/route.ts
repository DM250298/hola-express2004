import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { consultarOrdenPago } from '@/lib/mercadopago/point'
import { procesarCobroAprobado } from '@/lib/mercadopago/registro'

export const runtime = 'nodejs'

interface Ctx {
  params: Promise<{ id: string }>
}

/**
 * Concilia un cobro con terminal: verifica en Mercado Pago si la orden está
 * aprobada y, si lo está, registra la venta desde el intento (idempotente).
 *
 * Lo usa el botón "Registrar venta" de la pantalla de conciliación y también
 * cubre el caso en que el webhook nunca llegó (verifica el estado real en MP
 * en el momento). Requiere sesión.
 */
export async function POST(_request: Request, ctx: Ctx) {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })
  }

  const { id } = await ctx.params
  const admin = createAdminClient()

  const { data: intento, error: errInt } = await admin
    .from('cobros_terminal')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (errInt) {
    return NextResponse.json({ error: errInt.message }, { status: 500 })
  }
  if (!intento) {
    return NextResponse.json({ error: 'El cobro no existe.' }, { status: 404 })
  }

  // Ya registrada: nada que hacer.
  if (intento.venta_id) {
    return NextResponse.json({
      ok: true,
      ya_registrada: true,
      venta_id: intento.venta_id,
    })
  }

  if (!intento.orden_mp_id) {
    return NextResponse.json(
      { error: 'El cobro no tiene una orden de Mercado Pago asociada.' },
      { status: 400 }
    )
  }

  let orden
  try {
    orden = await consultarOrdenPago(intento.orden_mp_id as string)
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof Error
            ? e.message
            : 'No se pudo consultar la orden en Mercado Pago.',
      },
      { status: 502 }
    )
  }

  // Si el pago no está aprobado, reflejamos el estado real y avisamos.
  if (orden.status !== 'processed') {
    await admin
      .from('cobros_terminal')
      .update({
        estado: orden.status ?? intento.estado,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .is('venta_id', null)
    return NextResponse.json({
      ok: false,
      estado: orden.status ?? null,
      mensaje: 'El pago no está aprobado en Mercado Pago.',
    })
  }

  const resultado = await procesarCobroAprobado(admin, orden, id)
  if (!resultado.registrada) {
    return NextResponse.json(
      { error: resultado.error ?? 'No se pudo registrar la venta.' },
      { status: 500 }
    )
  }
  return NextResponse.json({ ok: true, ...resultado })
}
