/*
 * Service Worker — Hola Express POS (FASE 2 · offline)
 *
 * Hace que el punto de venta cargue aunque no haya internet.
 *
 *  • install  → se activa de inmediato.
 *  • activate → limpia versiones viejas y PRECACHEA el shell del POS y el
 *               dashboard (el usuario está online y autenticado en ese
 *               momento, así que se guarda la versión real de cada página).
 *  • fetch    → navegaciones a `/` y `/pos`: red primero, con caída a la
 *               copia guardada; estáticos (chunks, imágenes, fuentes, wasm):
 *               stale-while-revalidate; TODO lo demás (datos RSC de Next,
 *               /api/*, otras páginas): red pura, nunca se cachea.
 *
 * Identidad (mig 218 / commit 70d6170): las páginas autenticadas llevan el
 * usuario horneado en el HTML. Por eso:
 *  - Solo se guardan `/` y `/pos`, y solo si la respuesta es un HTML propio
 *    sin redirect (un `/pos` sin sesión redirige al login: NO se guarda).
 *  - Los payloads RSC (`?_rsc=`, header `RSC: 1`) no se cachean: la clave
 *    no depende del usuario y servirían la pantalla de otra persona.
 *  - `purgar-shell` (login/logout) borra todo lo que no sea estático y
 *    responde por MessageChannel para que la app espere antes de navegar.
 *
 * No toca las llamadas a Supabase — esas las maneja la cola offline de la app.
 */

// Subir esta versión en cada deploy que deba invalidar el caché del shell:
// al cambiar el nombre, el SW nuevo borra el caché viejo en `activate` y toma
// control de las pestañas (skipWaiting + clients.claim), sirviendo código fresco.
const CACHE = 'hola-express-v6'

// Documentos del "app shell" que se precachean al activar el SW y que son
// los únicos que se guardan/sirven offline.
const SHELL_DOCS = ['/', '/pos']

const EXT_ESTATICA =
  /\.(js|mjs|css|map|woff2?|ttf|otf|eot|png|jpe?g|gif|webp|avif|svg|ico|wasm|webmanifest)$/i

function esShell(pathname) {
  return SHELL_DOCS.includes(pathname)
}

function esEstatico(url) {
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/_next/image') ||
    EXT_ESTATICA.test(url.pathname)
  )
}

/** Fetch de datos de página de Next (App Router): nunca se cachea. */
function esRSC(req, url) {
  if (url.searchParams.has('_rsc')) return true
  const h = req.headers
  if (h.get('RSC') === '1') return true
  if (h.get('Next-Router-Prefetch') === '1') return true
  if (h.get('Next-Router-Segment-Prefetch') === '1') return true
  return (h.get('accept') || '').includes('text/x-component')
}

self.addEventListener('install', () => {
  // Activar la versión nueva sin esperar a que se cierren las pestañas.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // 1. Borrar caches de versiones anteriores (incluye copias contaminadas).
      const nombres = await caches.keys()
      await Promise.all(
        nombres.filter((n) => n !== CACHE).map((n) => caches.delete(n))
      )

      // 2. Tomar control de las pestañas ya abiertas.
      await self.clients.claim()

      // 3. Precachear el shell. Se hace con `credentials` para que el POS
      //    se guarde ya autenticado. Si no hay conexión, se ignora. Si la
      //    respuesta vino de un redirect (sin sesión → /login) NO se guarda.
      const cache = await caches.open(CACHE)
      await Promise.all(
        SHELL_DOCS.map(async (url) => {
          try {
            const res = await fetch(url, { credentials: 'same-origin' })
            if (esRespuestaShellValida(res, url)) await cache.put(url, res.clone())
          } catch {
            // sin conexión al activar — se cacheará en el primer uso online
          }
        })
      )
    })()
  )
})

/** HTML propio, sin redirect, cuya URL final sigue siendo la del shell. */
function esRespuestaShellValida(res, pathname) {
  if (!res || !res.ok || res.redirected || res.type !== 'basic') return false
  if (!(res.headers.get('content-type') || '').includes('text/html')) return false
  try {
    return new URL(res.url).pathname === pathname
  } catch {
    return false
  }
}

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
    event.respondWith(navegacion(req, url))
    return
  }

  // Datos de Next (RSC), API y cualquier GET dinámico: red pura, sin caché.
  if (esRSC(req, url) || url.pathname.startsWith('/api/')) return
  if (!esEstatico(url)) return

  event.respondWith(staleWhileRevalidate(req))
})

/*
 * Purga del shell autenticado.
 *
 * La app manda { tipo: 'purgar-shell' } al iniciar y cerrar sesión. Borra
 * todas las copias guardadas que no sean estáticos, para que, si se corta
 * internet justo después de un cambio de usuario, el SW NUNCA sirva la
 * pantalla (con el usuario horneado en el HTML) de otra persona. Responde
 * por el puerto que manda la app, así ella espera antes de navegar.
 */
self.addEventListener('message', (event) => {
  if (!event.data || event.data.tipo !== 'purgar-shell') return
  const puerto = event.ports && event.ports[0]
  event.waitUntil(
    purgarShell().finally(() => {
      if (puerto) {
        try {
          puerto.postMessage({ ok: true })
        } catch {
          // el puerto pudo cerrarse (la página ya navegó)
        }
      }
    })
  )
})

async function purgarShell() {
  const cache = await caches.open(CACHE)
  const keys = await cache.keys()
  await Promise.all(
    keys.map(async (req) => {
      try {
        if (!esEstatico(new URL(req.url))) await cache.delete(req)
      } catch {
        // ignore
      }
    })
  )
}

function respuestaSinConexion() {
  return new Response(
    'Sin conexión. Abrí la app con internet al menos una vez.',
    { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
  )
}

/**
 * Documentos: red primero (para tener siempre la versión fresca online).
 * Sin conexión, sirve la copia guardada SOLO para el shell (`/` y `/pos`):
 * nunca se responde `/pos` para otra ruta (ej. `/login`), que generaría un
 * loop con el guardián de sesión.
 */
async function navegacion(req, url) {
  const cache = await caches.open(CACHE)
  try {
    const res = await fetch(req)
    if (esShell(url.pathname) && esRespuestaShellValida(res, url.pathname)) {
      cache.put(url.pathname, res.clone())
    }
    return res
  } catch {
    if (!esShell(url.pathname)) return respuestaSinConexion()
    const cacheado =
      (await cache.match(url.pathname)) ||
      (await cache.match(url.pathname === '/pos' ? '/' : '/pos'))
    return cacheado || respuestaSinConexion()
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
