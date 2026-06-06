import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

/**
 * Endpoint TEMPORAL de diagnóstico de comisión real.
 *
 * Uso: hacé un cobro con la terminal, luego abrí en el navegador:
 *   /api/terminales/debug-pago
 * (toma la orden más reciente) o
 *   /api/terminales/debug-pago?order_id=XXXX
 *
 * Devuelve el JSON CRUDO de la orden y del pago tal cual los manda MP, para
 * ver dónde está la comisión/IIBB real y por qué el parser no la encuentra.
 */
export async function GET(request: Request) {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })
  }

  const token = process.env.MP_ACCESS_TOKEN
  if (!token) {
    return NextResponse.json({ error: 'Falta MP_ACCESS_TOKEN' }, { status: 500 })
  }

  const base = 'https://api.mercadopago.com'
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
  const getJson = async (url: string) => {
    const res = await fetch(url, { headers, cache: 'no-store' })
    const txt = await res.text()
    let body: unknown = null
    try {
      body = txt ? JSON.parse(txt) : null
    } catch {
      body = txt
    }
    return { status: res.status, body }
  }

  let orderId = new URL(request.url).searchParams.get('order_id')?.trim() || ''

  // Si no pasaron order_id, tomar la orden más reciente de los últimos 2 días.
  let listaReciente: unknown = null
  if (!orderId) {
    const ahora = new Date()
    const hace2 = new Date(ahora.getTime() - 2 * 24 * 60 * 60 * 1000)
    const fmt = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, '.000Z')
    const lista = await getJson(
      `${base}/v1/orders?begin_date=${encodeURIComponent(
        fmt(hace2)
      )}&end_date=${encodeURIComponent(fmt(ahora))}&limit=10`
    )
    listaReciente = lista.body
    const lb = lista.body as {
      elements?: Array<{ id?: string }>
      results?: Array<{ id?: string }>
    } | null
    const arr = lb?.elements ?? lb?.results ?? []
    orderId = arr[0]?.id ?? ''
  }

  if (!orderId) {
    return NextResponse.json({
      error: 'No se encontró ninguna orden reciente. Pasá ?order_id=XXXX',
      listaReciente,
    })
  }

  // 1. Orden cruda
  const orden = await getJson(`${base}/v1/orders/${orderId}`)

  // 2. Buscar el payment id en TODAS las rutas posibles del JSON de la orden.
  const ob = orden.body as Record<string, unknown>
  const candidatosPagoId: Array<{ ruta: string; id: string }> = []
  const transactions = ob?.transactions as
    | { payments?: Array<Record<string, unknown>> }
    | undefined
  for (const [i, p] of (transactions?.payments ?? []).entries()) {
    if (p?.id != null)
      candidatosPagoId.push({ ruta: `transactions.payments[${i}].id`, id: String(p.id) })
    if (p?.payment_id != null)
      candidatosPagoId.push({
        ruta: `transactions.payments[${i}].payment_id`,
        id: String(p.payment_id),
      })
  }

  // 3. Para cada candidato, intentar /v1/payments/{id}
  const pagos: Array<{ ruta: string; id: string; status: number; body: unknown }> = []
  for (const c of candidatosPagoId) {
    const pago = await getJson(`${base}/v1/payments/${c.id}`)
    pagos.push({ ruta: c.ruta, id: c.id, status: pago.status, body: pago.body })
  }

  return NextResponse.json({
    orderId,
    ordenStatus: orden.status,
    ordenCruda: orden.body,
    candidatosPagoId,
    pagosConsultados: pagos,
  })
}
