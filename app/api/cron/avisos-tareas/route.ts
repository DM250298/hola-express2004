import { timingSafeEqual } from 'crypto'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { enviarPush, pushConfigurado } from '@/lib/push/servidor'

/**
 * Avisos de tareas al celular (Tareas v2, Etapas 6 B y 7): atrasos para la
 * encargada o los administradores, y la cola de urgentes / "ahora empieza"
 * para cada persona (tabla notificaciones_push).
 *
 * Lo llama la base cada minuto (pg_cron + pg_net, migs 298 y 300) solo cuando
 * hay algo sin mandar, con Authorization: Bearer AVISOS_TAREAS_SECRET (la misma
 * clave que está en el Vault como hex_avisos_secret). Manda un Web Push a cada
 * dispositivo de esas personas que activó el tema ('tareas' para atrasos,
 * 'mis_tareas' para urgentes, 'inicio_tareas' para "ahora empieza") y anota
 * cada envío aunque nadie tenga el celular suscripto, para no reintentar.
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
    const expirados = new Set<string>()
    type Sub = { endpoint: string; p256dh: string; auth: string }

    /** Manda a todos los dispositivos de esas personas que eligieron el tema. */
    async function mandar(usuarios: string[], tema: string, payload: { title: string; body: string; url: string; tag: string }) {
      if (usuarios.length === 0) return { ok: 0, mal: 0 }
      const { data: subs } = await supabase
        .from('push_subscriptions')
        .select('endpoint, p256dh, auth')
        .in('usuario_id', usuarios)
        .contains('temas', [tema])
      let ok = 0
      let mal = 0
      for (const sub of (subs ?? []) as Sub[]) {
        const r = await enviarPush(sub, payload)
        if (r.ok) ok++
        else {
          mal++
          if (r.expirada) expirados.add(sub.endpoint)
        }
      }
      return { ok, mal }
    }

    // 1. Avisos de atraso (Etapa 5): a la encargada o a los administradores.
    const { data: avisos, error: eAv } = await supabase
      .from('tareas_avisos')
      .select('id, titulo, duenos_nombres, minutos_atraso, destinatarios')
      .is('resuelto_at', null)
      .gte('created_at', desde)
    if (eAv) return NextResponse.json({ error: eAv.message }, { status: 500 })
    type Aviso = { id: number; titulo: string; duenos_nombres: string | null; minutos_atraso: number; destinatarios: string[] }
    const lista = (avisos ?? []) as Aviso[]
    let pendientesAvisos: Aviso[] = []
    if (lista.length > 0) {
      const { data: hechos, error: eHe } = await supabase
        .from('tareas_avisos_push')
        .select('aviso_id')
        .in('aviso_id', lista.map((x) => x.id))
      if (eHe) return NextResponse.json({ error: eHe.message }, { status: 500 })
      const yaMandados = new Set(((hechos ?? []) as { aviso_id: number }[]).map((h) => h.aviso_id))
      pendientesAvisos = lista.filter((x) => !yaMandados.has(x.id))
    }
    let enviadas = 0
    for (const aviso of pendientesAvisos) {
      const r = await mandar(aviso.destinatarios, 'tareas', {
        title: 'Tarea atrasada',
        body: `${aviso.titulo}${aviso.duenos_nombres ? ` (${aviso.duenos_nombres})` : ''}: ${aviso.minutos_atraso} min de atraso`,
        url: '/alertas',
        tag: `tarea-atrasada-${aviso.id}`,
      })
      enviadas += r.ok
      await supabase
        .from('tareas_avisos_push')
        .upsert({ aviso_id: aviso.id, enviados: r.ok, fallidos: r.mal }, { onConflict: 'aviso_id', ignoreDuplicates: true })
    }

    // 2. Cola de la Etapa 7: tareas urgentes y "ahora empieza" a cada persona.
    const { data: cola, error: eCo } = await supabase
      .from('notificaciones_push')
      .select('id, tipo, tema, usuario_id, tarea_turno_id, titulo, cuerpo, url')
      .is('enviado_at', null)
      .gte('created_at', desde)
      .order('id')
      .limit(200)
    if (eCo) return NextResponse.json({ error: eCo.message }, { status: 500 })
    type Notif = { id: number; tipo: string; tema: string; usuario_id: string; tarea_turno_id: string; titulo: string; cuerpo: string; url: string }
    const notifs = (cola ?? []) as Notif[]
    for (const n of notifs) {
      const r = await mandar([n.usuario_id], n.tema, {
        title: n.titulo,
        body: n.cuerpo,
        url: n.url,
        tag: `${n.tipo}-${n.tarea_turno_id}`,
      })
      enviadas += r.ok
      await supabase
        .from('notificaciones_push')
        .update({ enviado_at: new Date().toISOString(), enviados: r.ok, fallidos: r.mal })
        .eq('id', n.id)
    }

    if (expirados.size > 0) {
      await supabase.from('push_subscriptions').delete().in('endpoint', [...expirados])
    }
    return NextResponse.json({
      ok: true,
      avisos: pendientesAvisos.length,
      notificaciones: notifs.length,
      enviadas,
      expiradas: expirados.size,
    })
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
