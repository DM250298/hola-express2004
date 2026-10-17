import { timingSafeEqual } from 'crypto'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { enviarPush, pushConfigurado } from '@/lib/push/servidor'

/**
 * Avisos de tareas atrasadas al celular (Tareas v2, Etapa 6 B).
 *
 * Lo llama la base cada 5 minutos (pg_cron + pg_net, mig 298) solo cuando hay
 * avisos sin mandar, con Authorization: Bearer AVISOS_TAREAS_SECRET (la misma
 * clave que está en el Vault como hex_avisos_secret). Manda un Web Push a cada
 * dispositivo de los destinatarios que activó el tema 'tareas' y anota el
 * envío en tareas_avisos_push (uno por aviso, aunque nadie tenga el celular
 * suscripto, para no reintentar).
 */
async function manejar(request: Request) {
  const secret = process.env.AVISOS_TAREAS_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Falta configurar AVISOS_TAREAS_SECRET en el servidor.' }, { status: 500 })
  }
  const a = Buffer.from(request.headers.get('authorization') ?? '')
  const b = Buffer.from(`Bearer ${secret}`)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 401 })
  }
  if (!pushConfigurado()) {
    return NextResponse.json({ error: 'Faltan las claves VAPID en el servidor.' }, { status: 500 })
  }

  try {
    const supabase = createAdminClient()
    const desde = new Date(Date.now() - 30 * 60 * 1000).toISOString()
    const { data: avisos, error: eAv } = await supabase
      .from('tareas_avisos')
      .select('id, titulo, duenos_nombres, minutos_atraso, destinatarios')
      .is('resuelto_at', null)
      .gte('created_at', desde)
    if (eAv) return NextResponse.json({ error: eAv.message }, { status: 500 })

    type Aviso = { id: number; titulo: string; duenos_nombres: string | null; minutos_atraso: number; destinatarios: string[] }
    const lista = (avisos ?? []) as Aviso[]
    if (lista.length === 0) return NextResponse.json({ ok: true, avisos: 0 })

    const { data: hechos, error: eHe } = await supabase
      .from('tareas_avisos_push')
      .select('aviso_id')
      .in('aviso_id', lista.map((x) => x.id))
    if (eHe) return NextResponse.json({ error: eHe.message }, { status: 500 })
    const yaMandados = new Set(((hechos ?? []) as { aviso_id: number }[]).map((h) => h.aviso_id))
    const pendientes = lista.filter((x) => !yaMandados.has(x.id))

    let enviadas = 0
    const expirados = new Set<string>()
    for (const aviso of pendientes) {
      const { data: subs } = await supabase
        .from('push_subscriptions')
        .select('endpoint, p256dh, auth')
        .in('usuario_id', aviso.destinatarios)
        .contains('temas', ['tareas'])
      let ok = 0
      let mal = 0
      for (const sub of (subs ?? []) as { endpoint: string; p256dh: string; auth: string }[]) {
        const r = await enviarPush(sub, {
          title: 'Tarea atrasada',
          body: `${aviso.titulo}${aviso.duenos_nombres ? ` (${aviso.duenos_nombres})` : ''}: ${aviso.minutos_atraso} min de atraso`,
          url: '/alertas',
          tag: `tarea-atrasada-${aviso.id}`,
        })
        if (r.ok) ok++
        else {
          mal++
          if (r.expirada) expirados.add(sub.endpoint)
        }
      }
      enviadas += ok
      await supabase
        .from('tareas_avisos_push')
        .upsert({ aviso_id: aviso.id, enviados: ok, fallidos: mal }, { onConflict: 'aviso_id', ignoreDuplicates: true })
    }

    if (expirados.size > 0) {
      await supabase.from('push_subscriptions').delete().in('endpoint', [...expirados])
    }
    return NextResponse.json({ ok: true, avisos: pendientes.length, enviadas, expiradas: expirados.size })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error interno.' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  return manejar(request)
}

/** Para probarlo a mano con el mismo header. */
export async function GET(request: Request) {
  return manejar(request)
}
