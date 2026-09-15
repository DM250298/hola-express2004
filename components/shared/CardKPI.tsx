'use client'

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'

const formatoUnDecimal = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

interface PropsCardKPI {
  icono: React.ElementType
  etiqueta: string
  valor: React.ReactNode
  detalle?: React.ReactNode
  /** Línea inferior separada (comparación, nota). */
  pie?: React.ReactNode
  /** Ícono (?) con explicación. No combinar con `href`: sería un botón dentro de un link. */
  ayuda?: React.ReactNode
  destacado?: boolean
  href?: string
}

/**
 * Tarjeta de KPI compartida (estilo del tablero directivo de Finanzas).
 * La usa el Tablero del dueño; pensada para reemplazar las tarjetas
 * locales duplicadas en otras pantallas.
 */
export function CardKPI({
  icono: Icono,
  etiqueta,
  valor,
  detalle,
  pie,
  ayuda,
  destacado,
  href,
}: PropsCardKPI) {
  const contenido = (
    <>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
        <Icono className="h-3.5 w-3.5 shrink-0 text-[#f9b44c]" />
        <span className="truncate">{etiqueta}</span>
        {ayuda}
        {href && <ArrowRight className="ml-auto h-3 w-3 opacity-50" />}
      </div>
      <div className="mt-1 text-2xl font-extrabold leading-tight tabular-nums text-[#391511]">
        {valor}
      </div>
      {detalle && <div className="mt-0.5 text-xs text-[#6f3a2a]">{detalle}</div>}
      {pie && (
        <div className="mt-2 border-t border-[#e4c9b0]/50 pt-1.5 text-[11px]">
          {pie}
        </div>
      )}
    </>
  )

  const clases = cn(
    'block rounded-2xl p-4',
    destacado
      ? 'border-2 border-[#f9b44c]/50 bg-[#f9b44c]/10'
      : 'border border-[#e4c9b0]/60 bg-white shadow-sm',
    href && 'transition-colors hover:border-[#f9b44c] hover:shadow-md'
  )

  if (href) {
    return (
      <Link href={href} className={clases}>
        {contenido}
      </Link>
    )
  }
  return <div className={clases}>{contenido}</div>
}

/**
 * Variación contra un valor anterior: ▲ verde / ▼ rojo.
 * `porcentaje` = cambio relativo; `puntos` = diferencia absoluta (para
 * comparar dos porcentajes, ej. margen 28,5 % vs 27,3 % = +1,2 pts).
 */
export function Variacion({
  actual,
  anterior,
  texto,
  modo = 'porcentaje',
}: {
  actual: number | null | undefined
  anterior: number | null | undefined
  texto: string
  modo?: 'porcentaje' | 'puntos'
}) {
  if (
    actual == null ||
    anterior == null ||
    (modo === 'porcentaje' && anterior === 0)
  ) {
    return <span className="text-[#c8a58a]">{texto}: sin datos para comparar</span>
  }
  const delta =
    modo === 'porcentaje'
      ? ((actual - anterior) / Math.abs(anterior)) * 100
      : actual - anterior
  const igual = Math.abs(delta) < 0.05
  const sube = delta > 0
  const unidad = modo === 'porcentaje' ? '%' : ' pts'

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span
        className={cn(
          'font-semibold tabular-nums',
          igual ? 'text-[#6f3a2a]' : sube ? 'text-[#2f7d4f]' : 'text-[#c43e2c]'
        )}
      >
        {igual
          ? '= igual'
          : `${sube ? '▲' : '▼'} ${formatoUnDecimal.format(Math.abs(delta))}${unidad}`}
      </span>
      <span className="text-[#6f3a2a]">{texto}</span>
    </span>
  )
}
