import { timingSafeEqual } from 'crypto'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { enviarPush, pushConfigurado } from '@/lib/push/servidor'

/**
 * Cron diario (Vercel Cron, 11:00 UTC = 08:00 AR): si hay órdenes de producción
 * en borrador, manda un Web Push con el resumen a cada dispositivo suscripto.
 *
 * Lo dispara Vercel con GET + header Authorization Bearer CRON_SECRET. Para
 * correrlo a mano: GET con el mismo header. Sin órdenes pendientes no envía nada.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json(
      { error: 'Falta configurar CRON_SECRET en el servidor.' },
      { status: 500 }
    )
  }
  const auth = request.headers.get('authorization') ?? ''
  const esperado = `Bearer ${secret}`
  const a = Buffer.from(auth)
  const b = Buffer.from(esperado)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 401 })
  }

  if (!pushConfigurado()) {
    return NextResponse.json(
      { error: 'Faltan las claves VAPID en el servidor.' },
      { status: 500 }
    )
  }

  try {
    const supabase = createAdminClient()

    // Órdenes pendientes de elaborar (borrador) con el nombre del producto.
    const { data, error: eOrd } = await supabase
      .from('ordenes_produccion')
      .select('id, productos(nombre)')
      .eq('estado', 'borrador')
    if (eOrd) return NextResponse.json({ error: eOrd.message }, { status: 500 })

    type FilaOrden = { id: number; productos: { nombre: string } | null }
    const ordenes = (data ?? []) as unknown as FilaOrden[]
    const pendientes = ordenes.length
    if (pendientes === 0) {
      return NextResponse.json({ ok: true, pendientes: 0, enviadas: 0 })
    }

    const nombres = ordenes
      .map((o) => o.productos?.nombre)
      .filter((n): n is string => !!n)
    const lista = nombres.slice(0, 4).join(', ')
    const resto = nombres.length > 4 ? ` y ${nombres.length - 4} más` : ''
    const payload = {
      title: 'Producción pendiente',
      body:
        pendientes === 1
          ? `1 producto para elaborar${lista ? `: ${lista}` : ''}.`
          : `${pendientes} productos para elaborar${lista ? `: ${lista}${resto}` : ''}.`,
      url: '/produccion',
    }

    const { data: subs, error: eSub } = await supabase
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth')
    if (eSub) return NextResponse.json({ error: eSub.message }, { status: 500 })

    type FilaSub = { endpoint: string; p256dh: string; auth: string }
    const suscripciones = (subs ?? []) as unknown as FilaSub[]

    let enviadas = 0
    const expirados: string[] = []
    for (const sub of suscripciones) {
      const r = await enviarPush(sub, payload)
      if (r.ok) enviadas++
      else if (r.expirada) expirados.push(sub.endpoint)
    }

    if (expirados.length > 0) {
      await supabase
        .from('push_subscriptions')
        .delete()
        .in('endpoint', expirados)
    }

    return NextResponse.json({
      ok: true,
      pendientes,
      enviadas,
      expiradas: expirados.length,
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error interno.' },
      { status: 500 }
    )
  }
}
