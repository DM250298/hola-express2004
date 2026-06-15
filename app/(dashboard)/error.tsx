'use client'

import { useEffect } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'

/**
 * Error boundary del dashboard: si una pantalla falla, mostramos un cartel
 * claro con opción de reintentar en lugar de dejar la pantalla en blanco.
 */
export default function ErrorDashboard({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Error en el dashboard:', error)
  }, [error])

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#c43e2c]/12">
        <AlertTriangle className="h-7 w-7 text-[#c43e2c]" />
      </div>
      <div className="space-y-1">
        <h1 className="text-xl font-bold text-[#391511]">
          No pudimos cargar esta pantalla
        </h1>
        <p className="max-w-md text-sm text-[#6f3a2a]">
          Ocurrió un error inesperado. Probá de nuevo; si sigue pasando,
          avisale al administrador.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          onClick={reset}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#f9b44c] px-4 py-2 text-sm font-semibold text-[#391511] transition-colors hover:bg-[#e4a42a]"
        >
          <RotateCcw className="h-4 w-4" />
          Reintentar
        </button>
        <a
          href="/"
          className="inline-flex items-center rounded-lg border border-[#e4c9b0] px-4 py-2 text-sm font-medium text-[#6f3a2a] transition-colors hover:bg-[#fdfaf6]"
        >
          Volver al inicio
        </a>
      </div>
    </div>
  )
}
