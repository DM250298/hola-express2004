import { timingSafeEqual } from 'crypto'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Cron diario (Vercel Cron, 09:00 UTC = 06:00 AR). Cierra la asistencia del día
 * anterior: marca ausentes injustificados a quienes tenían turno planificado y
 * no ficharon. Lo dispara Vercel con un GET + header Authorization Bearer
 * CRON_SECRET (se configura en Vercel → Settings → Environment Variables).
 *
 * La lógica vive en la RPC fn_cerrar_dia_asistencia; este endpoint sólo la
 * agenda. Si querés correrlo a mano: GET con el mismo header.
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

  // Fecha de "ayer" en hora argentina (UTC-3, sin DST).
  const arMs = Date.now() - 3 * 60 * 60 * 1000
  const ayer = new Date(arMs - 24 * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  const fecha = `${ayer.getUTCFullYear()}-${pad(ayer.getUTCMonth() + 1)}-${pad(
    ayer.getUTCDate()
  )}`

  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase.rpc('fn_cerrar_dia_asistencia', {
      p_fecha: fecha,
    })
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true, fecha, cerrados: data ?? 0 })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error interno.' },
      { status: 500 }
    )
  }
}
