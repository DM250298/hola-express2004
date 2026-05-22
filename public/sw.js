/*
 * Service Worker — Hola Express POS (FASE 2 · offline)
 *
 * Cachea el "app shell" para que el punto de venta siga cargando aunque se
 * caiga internet. No toca las llamadas a Supabase: esas las maneja la cola
 * offline de la aplicación.
 *
 * Estrategias:
 *   • Navegaciones (documentos) → red primero, con caída a la copia en caché.
 *   • Recursos estáticos        → stale-while-revalidate.
 */

const CACHE = 'hola-express-v1'

self.addEventListener('install', () => {
  // Activar de inmediato la versión nueva sin esperar.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const nombres = await caches.keys()
      await Promise.all(
        nombres.filter((n) => n !== CACHE).map((n) => caches.delete(n))
      )
      await self.clients.claim()
    })()
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request

  // Sólo GET. Las escrituras (ventas, etc.) van por la cola de la app.
  if (req.method !== 'GET') return

  const url = new URL(req.url)

  // Sólo el mismo origen. Supabase y otros externos pasan sin tocar.
  if (url.origin !== self.location.origin) return

  // No interceptar el propio service worker.
  if (url.pathname === '/sw.js') return

  if (req.mode === 'navigate') {
    event.respondWith(navegacionRedPrimero(req))
    return
  }

  event.respondWith(staleWhileRevalidate(req))
})

/** Documentos: intentar red; si falla, servir la última copia cacheada. */
async function navegacionRedPrimero(req) {
  const cache = await caches.open(CACHE)
  try {
    const res = await fetch(req)
    if (res && res.ok) cache.put(req, res.clone())
    return res
  } catch {
    const cacheado = await cache.match(req)
    if (cacheado) return cacheado
    // Caída al POS si esa ruta puntual no estaba cacheada.
    const pos = await cache.match('/pos')
    if (pos) return pos
    return new Response(
      'Sin conexión y sin una copia guardada de esta página.',
      { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
    )
  }
}

/** Estáticos: responder de caché al toque y refrescar en segundo plano. */
async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE)
  const cacheado = await cache.match(req)
  const red = fetch(req)
    .then((res) => {
      if (res && res.ok) cache.put(req, res.clone())
      return res
    })
    .catch(() => null)
  return cacheado || (await red) || new Response('', { status: 504 })
}
