'use client'

import { useEffect, useState } from 'react'
import { Package } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  url: string | null
  nombre: string
  /** Clases del contenedor (tamaño, borde, radio). */
  className?: string
  /** Clases del ícono de fallback (tamaño). */
  iconClassName?: string
}

/**
 * Miniatura de producto para el POS. Muestra la foto si existe y carga bien;
 * si no hay URL o la imagen falla (p. ej. sin conexión y sin cachear), cae a
 * un ícono neutro. El catálogo guarda `imagen_url`, pero los archivos en sí
 * dependen de la red — por eso el fallback ante `onError`.
 */
export function ImagenProductoPOS({
  url,
  nombre,
  className,
  iconClassName,
}: Props) {
  const [error, setError] = useState(false)
  // Si cambia la URL (p. ej. el catálogo refresca con otra foto para el mismo
  // producto), reintentar la carga en vez de quedar pegado en el ícono.
  useEffect(() => setError(false), [url])
  const mostrarImagen = url && !error

  return (
    <div
      className={cn(
        'bg-[#fdfaf6] overflow-hidden flex items-center justify-center shrink-0',
        className
      )}
    >
      {mostrarImagen ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={nombre}
          loading="lazy"
          onError={() => setError(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <Package className={cn('text-[#e4c9b0]', iconClassName)} />
      )}
    </div>
  )
}
