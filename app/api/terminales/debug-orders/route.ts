import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

/**
 * Endpoint TEMPORAL de diagnóstico — lista las órdenes de los últimos 7
 * días según MP para esta cuenta, tal cual las devuelve la API. Sirve
 * para ver qué hay encolado y por qué el auto-liberar no las encuentra.
 */
export async function GET() {
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

  const ahora = new Date()
  const hace7 = new Date(ahora.getTime() - 7 * 24 * 60 * 60 * 1000)
  const fmt = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, '.000Z')
  const url = `https://api.mercadopago.com/v1/orders?begin_date=${encodeURIComponent(
    fmt(hace7)
  )}&end_date=${encodeURIComponent(fmt(ahora))}&limit=50`

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  })

  const texto = await res.text()
  let data: unknown = null
  try {
    data = texto ? JSON.parse(texto) : null
  } catch {
    data = texto
  }

  return NextResponse.json({
    estadoMP: res.status,
    urlConsultada: url,
    respuesta: data,
  })
}
