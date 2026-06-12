import { timingSafeEqual } from 'crypto'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Cron diario (Vercel Cron, 09:00 UTC = 06:00 AR). Hace 3 cosas:
 *  1. Cierra la asistencia de AYER (marca ausentes injustificados).
 *  2. Materializa las tareas recurrentes de HOY (antes del turno mañana).
 *  3. Marca vencidas las tareas de días pasados sin completar.
 *
 * Lo dispara Vercel con GET + header Authorization Bearer CRON_SECRET
 * (Vercel → Settings → Environment Variables). Si querés correrlo a mano:
 * GET con el mismo header.
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

  // Fechas en hora argentina (UTC-3, sin DST).
  const arMs = Date.now() - 3 * 60 * 60 * 1000
  const pad = (n: number) => String(n).padStart(2, '0')
  const aFecha = (ms: number) => {
    const d = new Date(ms)
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  }
  const ayer = aFecha(arMs - 24 * 60 * 60 * 1000)
  const hoy = aFecha(arMs)

  try {
    const supabase = createAdminClient()

    const { data: cerrados, error: e1 } = await supabase.rpc(
      'fn_cerrar_dia_asistencia',
      { p_fecha: ayer }
    )
    if (e1) return NextResponse.json({ error: e1.message }, { status: 500 })

    const { data: materializadas, error: e2 } = await supabase.rpc(
      'fn_materializar_tareas_turno',
      { p_fecha: hoy }
    )
    if (e2) return NextResponse.json({ error: e2.message }, { status: 500 })

    const { data: vencidas, error: e3 } = await supabase.rpc(
      'fn_marcar_tareas_vencidas',
      {}
    )
    if (e3) return NextResponse.json({ error: e3.message }, { status: 500 })

    return NextResponse.json({
      ok: true,
      ayer,
      hoy,
      cerrados: cerrados ?? 0,
      tareas_materializadas: materializadas ?? 0,
      tareas_vencidas: vencidas ?? 0,
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error interno.' },
      { status: 500 }
    )
  }
}
