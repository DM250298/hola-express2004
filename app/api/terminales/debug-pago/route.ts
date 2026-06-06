import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

/**
 * Endpoint TEMPORAL de diagnóstico de comisión real.
 *
 * Uso: hacé un cobro con la terminal, luego abrí:
 *   /api/terminales/debug-pago            (toma la última orden PROCESADA)
 *   /api/terminales/debug-pago?order_id=ORD...
 *
 * Devuelve el JSON CRUDO de la orden y del/los pago(s) consultados por sus
 * distintos ids (reference_id numérico vs id ULID), para ver cuál funciona
 * en /v1/payments y dónde viene la comisión/IIBB real.
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

  type Pago = {
    id?: string
    reference_id?: string
    status?: string
    payment_method?: { id?: string; type?: string }
  }
  type Orden = {
    id?: string
    status?: string
    transactions?: { payments?: Pago[] }
  }

  let orderId = new URL(request.url).searchParams.get('order_id')?.trim() || ''

  // Si no pasaron order_id, tomar la última orden PROCESADA del listado.
  if (!orderId) {
    const ahora = new Date()
    const hace2 = new Date(ahora.getTime() - 2 * 24 * 60 * 60 * 1000)
    const fmt = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, '.000Z')
    const lista = await getJson(
      `${base}/v1/orders?begin_date=${encodeURIComponent(
        fmt(hace2)
      )}&end_date=${encodeURIComponent(fmt(ahora))}&limit=20`
    )
    // El listado viene en data.data[]
    const arr =
      ((lista.body as { data?: Orden[] } | null)?.data ?? []) as Orden[]
    const procesada = arr.find((o) => o.status === 'processed') ?? arr[0]
    orderId = procesada?.id ?? ''
    if (!orderId) {
      return NextResponse.json({
        error: 'No se encontró orden. Pasá ?order_id=ORD...',
        primerasOrdenes: arr.slice(0, 3),
      })
    }
  }

  // 1. Orden cruda
  const orden = await getJson(`${base}/v1/orders/${orderId}`)
  const ordenBody = orden.body as Orden | null
  const pago = ordenBody?.transactions?.payments?.[0]

  // 2. Probar /v1/payments con AMBOS ids para ver cuál anda.
  const intentos: Array<{ campo: string; id: string; status: number; body: unknown }> = []
  if (pago?.reference_id) {
    const r = await getJson(`${base}/v1/payments/${pago.reference_id}`)
    intentos.push({ campo: 'reference_id', id: pago.reference_id, status: r.status, body: r.body })
  }
  if (pago?.id) {
    const r = await getJson(`${base}/v1/payments/${pago.id}`)
    intentos.push({ campo: 'id', id: pago.id, status: r.status, body: r.body })
  }

  return NextResponse.json({
    orderId,
    ordenStatus: ordenBody?.status,
    payment_method: pago?.payment_method,
    pagoEnOrden: pago,
    intentosPayments: intentos,
  })
}
