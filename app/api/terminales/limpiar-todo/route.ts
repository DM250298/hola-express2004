import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

interface OrdenBusqueda {
  id?: string
  status?: string
  created_date?: string
  config?: { point?: { terminal_id?: string } }
}

const FINALES = new Set([
  'processed',
  'failed',
  'canceled',
  'expired',
  'refunded',
])

function nuevaIdempotency(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/**
 * Endpoint TEMPORAL — busca todas las órdenes recientes para una terminal,
 * intenta cancelarlas una a una y devuelve el detalle de cada intento
 * (éxito o error de MP). Sirve para diagnosticar por qué la auto-limpieza
 * no termina de liberar la terminal.
 */
export async function POST(request: Request) {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })
  }

  const token = process.env.MP_ACCESS_TOKEN
  if (!token) {
    return NextResponse.json(
      { error: 'Falta MP_ACCESS_TOKEN' },
      { status: 500 }
    )
  }

  const body = await request.json().catch(() => ({}))
  const deviceId = (body as { device_id?: string }).device_id?.trim() ?? ''
  if (!deviceId) {
    return NextResponse.json(
      { error: 'Falta device_id en el body' },
      { status: 400 }
    )
  }

  const ahora = new Date()
  const desde = new Date(ahora.getTime() - 7 * 24 * 60 * 60 * 1000)
  const fmt = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, '.000Z')
  const urlBuscar = `https://api.mercadopago.com/v1/orders?begin_date=${encodeURIComponent(
    fmt(desde)
  )}&end_date=${encodeURIComponent(fmt(ahora))}&limit=50`

  const resBuscar = await fetch(urlBuscar, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  })
  if (!resBuscar.ok) {
    return NextResponse.json(
      {
        error: 'No se pudo buscar órdenes',
        estado: resBuscar.status,
        respuesta: await resBuscar.text(),
      },
      { status: 502 }
    )
  }
  const buscar = (await resBuscar.json()) as { data?: OrdenBusqueda[] }
  const candidatas = (buscar.data ?? []).filter((o) => {
    if (!o.id) return false
    if (o.status && FINALES.has(o.status)) return false
    const tid = o.config?.point?.terminal_id
    if (tid && tid !== deviceId) return false
    return true
  })

  const intentos: Array<{
    id: string
    status: string | null
    created_date: string | null
    cancelStatus: number
    cancelBody: string
  }> = []

  for (const o of candidatas) {
    const id = o.id as string
    const url = `https://api.mercadopago.com/v1/orders/${id}/cancel`
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': nuevaIdempotency(),
      },
      body: '{}',
      cache: 'no-store',
    })
    const t = await r.text()
    intentos.push({
      id,
      status: o.status ?? null,
      created_date: o.created_date ?? null,
      cancelStatus: r.status,
      cancelBody: t.slice(0, 200),
    })
  }

  return NextResponse.json({
    encontradas: candidatas.length,
    intentos,
  })
}
