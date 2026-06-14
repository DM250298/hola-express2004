/*
 * Service Worker — Hola Express POS (FASE 2 · offline)
 *
 * Hace que el punto de venta cargue aunque no haya internet.
 *
 *  • install  → se activa de inmediato.
 *  • activate → limpia versiones viejas y PRECACHEA el shell del POS y el
 *               dashboard (el usuario está online y autenticado en ese
 *               momento, así que se guarda la versión real de cada página).
 *  • fetch    → navegaciones: red primero, con caída a la copia guardada;
 *               estáticos (chunks, imágenes): stale-while-revalidate.
 *
 * No toca las llamadas a Supabase — esas las maneja la cola offline de la app.
 */

const CACHE = 'hola-express-v2'

// Documentos del "app shell" que se precachean al activar el SW.
const PRECACHE_DOCS = ['/', '/pos']

self.addEventListener('install', () => {
  // Activar la versión nueva sin esperar a que se cierren las pestañas.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // 1. Borrar caches de versiones anteriores.
      const nombres = await caches.keys()
      await Promise.all(
        nombres.filter((n) => n !== CACHE).map((n) => caches.delete(n))
      )

      // 2. Tomar control de las pestañas ya abiertas.
      await self.clients.claim()

      // 3. Precachear el shell. Se hace con `credentials` para que el POS
      //    se guarde ya autenticado. Si no hay conexión, se ignora.
      const cache = await caches.open(CACHE)
      await Promise.all(
        PRECACHE_DOCS.map(async (url) => {
          try {
            const res = await fetch(url, { credentials: 'same-origin' })
            if (res && res.ok) await cache.put(url, res.clone())
          } catch {
            // sin conexión al activar — se cacheará en el primer uso online
          }
        })
      )
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
    event.respondWith(navegacion(req))
    return
  }

  event.respondWith(staleWhileRevalidate(req))
})

/**
 * Documentos: red primero (para tener siempre la versión fresca online).
 * Sin conexión, sirve la mejor copia guardada disponible.
 */
async function navegacion(req) {
  const cache = await caches.open(CACHE)
  try {
    const res = await fetch(req)
    if (res && res.ok) cache.put(req, res.clone())
    return res
  } catch {
    const url = new URL(req.url)
    const cacheado =
      (await cache.match(req)) ||
      (await cache.match(url.pathname)) ||
      (await cache.match('/pos')) ||
      (await cache.match('/'))
    if (cacheado) return cacheado
    return new Response(
      'Sin conexión. Abrí la app con internet al menos una vez.',
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

/*
 * Web Push — avisos de producción pendiente (resumen diario).
 * El payload llega como JSON { title, body, url } desde el cron del servidor.
 */
self.addEventListener('push', (event) => {
  let datos = {}
  try {
    datos = event.data ? event.data.json() : {}
  } catch {
    datos = {}
  }
  const title = datos.title || 'Hola Express'
  const body = datos.body || 'Tenés novedades en producción.'
  const url = datos.url || '/produccion'
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icono.svg',
      badge: '/icono.svg',
      tag: 'produccion-pendiente',
      renotify: true,
      data: { url },
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url =
    (event.notification.data && event.notification.data.url) || '/produccion'
  event.waitUntil(
    (async () => {
      const ventanas = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })
      // Si ya hay una pestaña de la app abierta, la enfoco y navego.
      for (const cliente of ventanas) {
        if ('focus' in cliente) {
          await cliente.focus()
          if ('navigate' in cliente) {
            try {
              await cliente.navigate(url)
            } catch {
              // navigate puede fallar en algunos contextos: se ignora.
            }
          }
          return
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(url)
    })()
  )
})
