import { sendNotification, setVapidDetails } from 'web-push'

/**
 * Envío de Web Push desde el servidor (cron de avisos de producción).
 *
 * ⚠️ SOLO servidor: importa `web-push` (Node) y usa VAPID_PRIVATE_KEY, que es
 * secreta. Nunca importar desde un componente cliente.
 */

let configurado = false

/** Configura VAPID una vez. Devuelve false si faltan las claves en el entorno. */
function configurar(): boolean {
  if (configurado) return true
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT ?? 'mailto:soporte@hola-express.local'
  if (!pub || !priv) return false
  setVapidDetails(subject, pub, priv)
  configurado = true
  return true
}

/** True si hay claves VAPID cargadas (para no intentar enviar sin configurar). */
export function pushConfigurado(): boolean {
  return configurar()
}

export interface SuscripcionPush {
  endpoint: string
  p256dh: string
  auth: string
}

export interface PayloadPush {
  title: string
  body: string
  url: string
}

export type ResultadoEnvio =
  | { ok: true }
  | { ok: false; expirada: boolean; error: string }

/**
 * Envía un push a una suscripción. `expirada=true` cuando el endpoint ya no
 * existe (404/410) → el caller debe borrarla de la base.
 */
export async function enviarPush(
  sub: SuscripcionPush,
  payload: PayloadPush
): Promise<ResultadoEnvio> {
  if (!configurar()) {
    return {
      ok: false,
      expirada: false,
      error: 'Web Push sin configurar: faltan las claves VAPID en el servidor.',
    }
  }
  try {
    await sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload)
    )
    return { ok: true }
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode
    const expirada = status === 404 || status === 410
    return {
      ok: false,
      expirada,
      error: e instanceof Error ? e.message : 'Error al enviar el push.',
    }
  }
}
