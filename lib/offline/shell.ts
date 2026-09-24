/**
 * Le pide al service worker que borre las copias guardadas de páginas
 * autenticadas (el "app shell" `/` y `/pos`, que llevan el usuario horneado
 * en el HTML). Se llama al iniciar y al cerrar sesión, ANTES de navegar: si
 * se corta internet justo después de un cambio de usuario, el SW nunca sirve
 * la pantalla de otra persona.
 *
 * Espera la confirmación del SW por MessageChannel (con tope de tiempo) para
 * que la navegación siguiente no compita con la purga. Usa el SW que controla
 * esta página (`controller`); `reg.active` puede ser una versión en tránsito.
 * Usa getRegistration() (no `.ready`, que puede quedar colgado si no hay SW).
 */
const TIMEOUT_ACK_MS = 1500

export async function purgarShellSW(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return
  }
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    const sw = navigator.serviceWorker.controller ?? reg?.active ?? null
    if (!sw) return
    await new Promise<void>((resolve) => {
      const canal = new MessageChannel()
      const timer = setTimeout(resolve, TIMEOUT_ACK_MS)
      canal.port1.onmessage = () => {
        clearTimeout(timer)
        resolve()
      }
      try {
        sw.postMessage({ tipo: 'purgar-shell' }, [canal.port2])
      } catch {
        clearTimeout(timer)
        resolve()
      }
    })
  } catch {
    // sin SW (desarrollo o primer arranque): no hay nada que purgar
  }
}
