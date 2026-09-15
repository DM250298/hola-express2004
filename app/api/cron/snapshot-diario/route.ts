import { timingSafeEqual } from 'crypto'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Snapshot manual de métricas por SKU (mig 173). NO está agendado en
 * vercel.json: el plan Hobby de Vercel tope en 2 cron jobs, así que la
 * corrida diaria vive como paso 4 de /api/cron/cierre-diario. Este
 * endpoint existe para re-ejecutar a mano un día puntual (la función es
 * idempotente por fecha): GET con Authorization Bearer CRON_SECRET.
 * Los huecos largos se rellenan con fn_backfill_metricas_diarias desde
 * el SQL Editor.
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

  // Fecha en hora argentina (UTC-3, sin DST).
  const arMs = Date.now() - 3 * 60 * 60 * 1000
  const pad = (n: number) => String(n).padStart(2, '0')
  const aFecha = (ms: number) => {
    const d = new Date(ms)
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  }
  const ayer = aFecha(arMs - 24 * 60 * 60 * 1000)

  try {
    const supabase = createAdminClient()

    const { data: filas, error } = await supabase.rpc(
      'fn_snapshot_metricas_diarias',
      { p_fecha: ayer }
    )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({
      ok: true,
      fecha: ayer,
      filas_snapshot: filas ?? 0,
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error interno.' },
      { status: 500 }
    )
  }
}
