'use client'

import { useEffect, useMemo, useState } from 'react'
import { BookOpen, Plus, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MontoARS } from '@/components/shared/MontoARS'
import { SkeletonTabla } from '@/components/shared/SkeletonTabla'
import { usePreviewCostoReceta, useRecetas } from '@/lib/hooks/useProduccion'
import { formatearNumero } from '@/lib/utils/formato'
import { cn } from '@/lib/utils'
import type { RecetaConProducto } from '@/lib/queries/produccion'

/** Debajo de este margen la receta se marca en rojo (mismo criterio que Análisis). */
const UMBRAL_MARGEN = 30

interface TarjetaProps {
  receta: RecetaConProducto
  seleccionada: boolean
  onSeleccionar: (receta: RecetaConProducto) => void
}

function TarjetaReceta({ receta, seleccionada, onSeleccionar }: TarjetaProps) {
  const { data: costo } = usePreviewCostoReceta(receta.producto_id)
  const precio = receta.producto?.precio_venta ?? 0
  const costoUnit = costo ?? 0
  const margen = precio > 0 ? ((precio - costoUnit) / precio) * 100 : null

  // La etiqueta necesita estos dos datos: si faltan, se avisa desde la lista.
  const fichaIncompleta = !receta.conservacion || !receta.alergenos

  return (
    <button
      type="button"
      onClick={() => onSeleccionar(receta)}
      className={cn(
        'w-full text-left bg-white border rounded-xl p-3 shadow-sm transition-colors space-y-1.5',
        seleccionada
          ? 'border-[#f9b44c] ring-1 ring-[#f9b44c]/40'
          : 'border-[#e4c9b0]/60 hover:border-[#f9b44c]'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-semibold text-[#391511] leading-snug">
          {receta.producto?.nombre ?? '—'}
        </span>
        {fichaIncompleta && (
          <span
            className="mt-1 h-2 w-2 rounded-full bg-[#f9b44c] shrink-0"
            title="Falta conservación o alérgenos para la etiqueta"
          />
        )}
      </div>

      <div className="text-[11px] text-[#6f3a2a]">
        Rinde {formatearNumero(receta.rendimiento)} {receta.unidad_rendimiento} ·{' '}
        {receta.vida_util_dias === 0 ? (
          <span className="text-[#c43e2c] font-semibold">sin vida útil</span>
        ) : (
          `${receta.vida_util_dias} día${receta.vida_util_dias === 1 ? '' : 's'}`
        )}
      </div>

      <div className="flex items-center justify-between gap-2 text-[11px]">
        <MontoARS monto={costoUnit} className="text-[#6f3a2a]" />
        {margen != null && (
          <span
            className={cn(
              'font-bold tabular-nums',
              margen >= 50
                ? 'text-[#2f8f4e]'
                : margen >= UMBRAL_MARGEN
                  ? 'text-[#c45e14]'
                  : 'text-[#c43e2c]'
            )}
          >
            {formatearNumero(margen)}% margen
          </span>
        )}
      </div>
    </button>
  )
}

interface Props {
  seleccionadoId: number | undefined
  /** Undefined = se pidió "nueva receta". */
  onSeleccionar: (productoId: number | undefined) => void
  nuevaActiva: boolean
}

/** Columna izquierda del tab de recetas: buscador + tarjetas. */
export function ListaRecetas({
  seleccionadoId,
  onSeleccionar,
  nuevaActiva,
}: Props) {
  const { data: recetas, isLoading } = useRecetas()
  const [busquedaInput, setBusquedaInput] = useState('')
  const [busqueda, setBusqueda] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setBusqueda(busquedaInput), 250)
    return () => clearTimeout(t)
  }, [busquedaInput])

  const filtradas = useMemo(() => {
    const lista = recetas ?? []
    const q = busqueda.trim().toLowerCase()
    if (!q) return lista
    return lista.filter((r) =>
      (r.producto?.nombre ?? '').toLowerCase().includes(q)
    )
  }, [recetas, busqueda])

  return (
    <div className="space-y-3">
      <Button
        onClick={() => onSeleccionar(undefined)}
        className={cn(
          'w-full gap-1.5',
          nuevaActiva
            ? 'bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511]'
            : 'bg-[#391511] hover:bg-[#4a1d16] text-white'
        )}
      >
        <Plus className="h-4 w-4" />
        Nueva receta
      </Button>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#c8a58a] pointer-events-none" />
        <Input
          value={busquedaInput}
          onChange={(e) => setBusquedaInput(e.target.value)}
          placeholder="Buscar receta…"
          className="pl-9 pr-9 border-[#e4c9b0] focus-visible:ring-[#f9b44c] bg-white"
        />
        {busquedaInput && (
          <button
            type="button"
            onClick={() => setBusquedaInput('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[#c8a58a] hover:text-[#391511]"
            aria-label="Limpiar"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-4">
          <SkeletonTabla filas={4} columnas={1} />
        </div>
      ) : filtradas.length === 0 ? (
        <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-8 text-center">
          <div className="inline-flex p-3 rounded-full bg-[#f9d2a2]/40 mb-2">
            <BookOpen className="h-5 w-5 text-[#6f3a2a]" />
          </div>
          <p className="text-sm text-[#6f3a2a]">
            {busqueda
              ? 'Ninguna receta coincide con la búsqueda.'
              : 'Todavía no hay recetas. Creá la primera.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtradas.map((r) => (
            <TarjetaReceta
              key={r.id}
              receta={r}
              seleccionada={!nuevaActiva && r.producto_id === seleccionadoId}
              onSeleccionar={(rec) => onSeleccionar(rec.producto_id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
