'use client'

import { useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** Cada cuánto se pregunta por una versión nueva, además de al volver a la pestaña. */
const TICK_MS = 15 * 60_000

/**
 * Aviso de versión nueva.
 *
 * Una pestaña abierta antes de un deploy sigue corriendo el JS viejo (el
 * mostrador y los celulares quedan abiertos días). Cuando la base cambia
 * (p. ej. Tareas v2 cierra las escrituras directas), ese JS falla. Este
 * componente compara la versión con la que se armó la pantalla con la que
 * está publicada y, si cambió, pide recargar. No recarga solo: podría haber
 * una venta o un formulario a medio cargar.
 *
 * Va como franja dentro del layout (entre el encabezado y el contenido), no
 * flotando: así nunca tapa las barras de acción fijas del modo móvil.
 * "Más tarde" lo esconde hasta el próximo chequeo.
 *
 * La versión propia sale de NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA (la fija el
 * build); si no está, se toma la primera respuesta del servidor.
 */
export function AvisoVersion({ className }: { className?: string }) {
  const [hayNueva, setHayNueva] = useState(false)
  const [pospuesto, setPospuesto] = useState(false)
  const propiaRef = useRef<string | null>(process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || null)
  const posponerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let activo = true

    async function verificar() {
      try {
        const res = await fetch('/api/version', { cache: 'no-store' })
        if (!res.ok) return
        const { version } = (await res.json()) as { version: string | null }
        if (!activo || !version) return
        if (propiaRef.current === null) {
          propiaRef.current = version
          return
        }
        if (version !== propiaRef.current) setHayNueva(true)
      } catch {
        // Sin red o sesión vencida (redirige a /login): se reintenta después.
      }
    }

    const alCambiarVisibilidad = () => {
      if (document.visibilityState === 'visible') void verificar()
    }
    document.addEventListener('visibilitychange', alCambiarVisibilidad)
    window.addEventListener('focus', alCambiarVisibilidad)
    const tick = setInterval(() => void verificar(), TICK_MS)
    void verificar()

    return () => {
      activo = false
      document.removeEventListener('visibilitychange', alCambiarVisibilidad)
      window.removeEventListener('focus', alCambiarVisibilidad)
      clearInterval(tick)
      if (posponerRef.current) clearTimeout(posponerRef.current)
    }
  }, [])

  function posponer() {
    setPospuesto(true)
    if (posponerRef.current) clearTimeout(posponerRef.current)
    posponerRef.current = setTimeout(() => setPospuesto(false), TICK_MS)
  }

  // La región viva existe siempre: los lectores de pantalla anuncian el
  // texto cuando aparece adentro, no si la región entera aparece de golpe.
  return (
    <div role="status" aria-live="polite" className={className}>
      {hayNueva && !pospuesto && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[#e4c9b0] bg-[#fff6e5] px-4 py-2">
          <p className="min-w-48 flex-1 text-sm text-[#391511]">
            Hay una versión nueva de HEX. Recargá cuando termines lo que estás haciendo.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={posponer} className="border-[#e4c9b0] text-[#6f3a2a]">
              Más tarde
            </Button>
            <Button
              onClick={() => window.location.reload()}
              className="bg-[#f9b44c] font-bold text-[#391511] hover:bg-[#e4a42a]"
            >
              <RefreshCw className="mr-1.5 h-4 w-4" />
              Recargar
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
