import type { MetadataRoute } from 'next'

/**
 * Manifest PWA — permite "instalar" Hola Express en la tablet del POS y, junto
 * con el service worker, que el punto de venta arranque sin conexión.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '¡Hola! Express — Sistema de Gestión',
    short_name: 'Hola Express',
    description:
      'Punto de venta y gestión operativa para Hola Express, La Rioja.',
    start_url: '/pos',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    lang: 'es-AR',
    background_color: '#fdfaf6',
    theme_color: '#391511',
    icons: [
      {
        src: '/icono.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        src: '/favicon.ico',
        sizes: 'any',
        type: 'image/x-icon',
      },
    ],
  }
}
