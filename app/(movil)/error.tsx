'use client'

import { useEffect } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'

/**
 * Error boundary del modo móvil: cartel claro y botones grandes (mobile-first)
 * en lugar de una pantalla en blanco si algo falla.
 */
export default function ErrorMovil({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Error en el modo móvil:', error)
  }, [error])

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#c43e2c]/12">
        <AlertTriangle className="h-8 w-8 text-[#c43e2c]" />
      </div>
      <div className="space-y-1">
        <h1 className="text-xl font-bold text-[#391511]">Algo salió mal</h1>
        <p className="text-sm text-[#6f3a2a]">
          No pudimos cargar esta pantalla. Probá de nuevo.
        </p>
      </div>
      <button
        onClick={reset}
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#f9b44c] text-base font-bold text-[#391511] transition active:scale-[0.99]"
      >
        <RotateCcw className="h-5 w-5" />
        Reintentar
      </button>
      <a
        href="/movil"
        className="text-sm font-medium text-[#9e6b15]"
      >
        Volver al inicio
      </a>
    </div>
  )
}
