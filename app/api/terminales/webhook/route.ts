import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  consultarOrdenPago,
  validarFirmaWebhook,
  ESTADOS_FINALES_ORDEN,
} from '@/lib/mercadopago/point'
import { procesarCobroAprobado } from '@/lib/mercadopago/registro'

export const runtime = 'nodejs'

/**
 * Webhook de Mercado Pago (server-to-server, SIN cookie de sesión).
 *
 * Es la RED DE SEGURIDAD del cobro con terminal: cuando MP aprueba un pago,
 * este endpoint registra la venta desde el intento de cobro (cobros_terminal),
 * aunque la pestaña del POS se haya cerrado. La idempotencia de
 * `fn_crear_venta` (por cliente_uuid = id del intento) evita duplicar con la
 * venta que también intenta crear el POS.
 *
 * Seguridad: valida la firma HMAC (`x-signature` + `x-request-id` con
 * `MP_WEBHOOK_SECRET`). Sin firma válida → 401.
 *
 * Responde 200 en todos los casos que ya procesó (incluso si la venta ya
 * estaba registrada) para que MP no reintente en loop.
 */
export async function POST(request: Request) {
  const url = new URL(request.url)
  const xSignature = request.headers.get('x-signature')
  const xRequestId = request.headers.get('x-request-id')

  // MP manda el id del recurso en el query param `data.id` (y también en el body).
  let body: {
    type?: string
    action?: string
    data?: { id?: string | number }
  } = {}
  try {
    body = await request.json()
  } catch {
    // Algunas notificaciones vienen sin body JSON; seguimos con el query.
  }

  const dataId =
    url.searchParams.get('data.id') ??
    url.searchParams.get('id') ??
    (body.data?.id != null ? String(body.data.id) : null)

  // ── Validación de firma ──
  if (!validarFirmaWebhook({ xSignature, xRequestId, dataId })) {
    return NextResponse.json({ error: 'Firma inválida.' }, { status: 401 })
  }

  if (!dataId) {
    // Nada que procesar, pero devolvemos 200 para que MP no reintente.
    return NextResponse.json({ ok: true, ignored: 'sin data.id' })
  }

  // Solo nos interesan las notificaciones de órdenes (las que generamos con la
  // terminal). Si es de otro tipo (payment suelto, etc.), la orden asociada
  // igual va a notificar; devolvemos 200 y esperamos esa.
  const admin = createAdminClient()

  let orden
  try {
    orden = await consultarOrdenPago(dataId)
  } catch {
    // data.id no es una orden que podamos consultar (o es un id de pago).
    return NextResponse.json({ ok: true, ignored: 'no es una orden' })
  }

  // Localizar el intento: el external_reference es el id del intento; si no,
  // por el id de la orden MP.
  const externalRef = orden.external_reference ?? null
  let cobroId: string | null = null
  {
    const { data: porRef } = externalRef
      ? await admin
          .from('cobros_terminal')
          .select('id')
          .eq('id', externalRef)
          .maybeSingle()
      : { data: null }
    if (porRef?.id) {
      cobroId = porRef.id as string
    } else {
      const { data: porOrden } = await admin
        .from('cobros_terminal')
        .select('id')
        .eq('orden_mp_id', orden.id)
        .maybeSingle()
      cobroId = (porOrden?.id as string) ?? null
    }
  }

  if (!cobroId) {
    // Cobro sin intento asociado (ej: prueba de cobro desde Terminales, o una
    // orden previa a este blindaje). No hay venta que registrar.
    return NextResponse.json({ ok: true, ignored: 'sin intento asociado' })
  }

  const estado = orden.status ?? ''

  if (estado === 'processed') {
    const resultado = await procesarCobroAprobado(admin, orden, cobroId)
    return NextResponse.json({ ok: true, ...resultado })
  }

  // Estados finales no exitosos: reflejarlos en el intento.
  if (ESTADOS_FINALES_ORDEN.has(estado) && estado !== 'processed') {
    await admin
      .from('cobros_terminal')
      .update({ estado, updated_at: new Date().toISOString() })
      .eq('id', cobroId)
      .is('venta_id', null)
    return NextResponse.json({ ok: true, estado })
  }

  // Aún pendiente: nada que hacer todavía.
  return NextResponse.json({ ok: true, estado })
}
