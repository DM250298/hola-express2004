/**
 * Helpers de Web Push para el browser. (El envío vive en `servidor.ts`.)
 */

/**
 * Convierte la clave VAPID pública (base64url) al `Uint8Array` que espera
 * `pushManager.subscribe({ applicationServerKey })`.
 */
export function base64UrlAUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const normal = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(normal)
  // Respaldado por un ArrayBuffer real (no ArrayBufferLike) para que sea un
  // BufferSource válido en pushManager.subscribe.
  const salida = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) salida[i] = raw.charCodeAt(i)
  return salida
}
