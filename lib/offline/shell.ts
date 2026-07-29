/**
 * Le pide al service worker que borre la copia guardada del "app shell"
 * autenticado (`/` y `/pos`). Se llama al iniciar y al cerrar sesión: así,
 * si se corta internet justo después de un cambio de usuario, el SW nunca
 * sirve la pantalla de otra persona (el usuario va horneado en el HTML del POS).
 *
 * Usa getRegistration() (no `.ready`, que puede quedar colgado si no hay SW).
 */
export async function purgarShellSW(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return
  }
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    reg?.active?.postMessage({ tipo: 'purgar-shell' })
  } catch {
    // sin SW (desarrollo o primer arranque): no hay nada que purgar
  }
}
