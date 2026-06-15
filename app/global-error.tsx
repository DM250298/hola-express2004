'use client'

import { useEffect } from 'react'

/**
 * Catch-all de último recurso (incluye errores del layout raíz). Reemplaza
 * toda la app, así que renderiza su propio <html>/<body>. Evita la pantalla
 * en blanco total si algo muy de fondo falla.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Error global:', error)
  }, [error])

  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          padding: 24,
          textAlign: 'center',
          fontFamily: 'system-ui, sans-serif',
          background: '#fdfaf6',
          color: '#391511',
        }}
      >
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>
          Se produjo un error
        </h1>
        <p style={{ maxWidth: 420, fontSize: 14, color: '#6f3a2a', margin: 0 }}>
          Algo falló al cargar la aplicación. Probá de nuevo; si sigue,
          avisale al administrador.
        </p>
        <button
          onClick={reset}
          style={{
            border: 'none',
            borderRadius: 10,
            background: '#f9b44c',
            color: '#391511',
            fontWeight: 600,
            fontSize: 14,
            padding: '10px 18px',
            cursor: 'pointer',
          }}
        >
          Reintentar
        </button>
      </body>
    </html>
  )
}
