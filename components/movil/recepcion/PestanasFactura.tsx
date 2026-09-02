'use client'

import { useRef } from 'react'
import { Check, Plus, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { formatearNumero } from '@/lib/utils/formato'
import { unidadesDeCargas, type FacturaEntrega } from '@/lib/recepcion/borrador'
import { cn } from '@/lib/utils'

interface Props {
  facturas: FacturaEntrega[]
  activaIdx: number
  deshabilitado: boolean
  onCambiar: (idx: number) => void
  onAgregar: () => void
  onCerrar: (idx: number) => void
  onNumero: (numero: string) => void
}

/**
 * Pestañas de las facturas de una misma entrega.
 *
 * Se muestran SIEMPRE, aunque haya una sola: antes se ocultaban con una única
 * factura y por eso nadie descubría que se podían cargar varias, que es
 * justamente lo normal cuando el proveedor entrega con dos o tres remitos.
 *
 * Todas son borradores hasta el Confirmar final; el N° es obligatorio recién
 * ahí, así que se puede ir y venir entre pestañas sin completarlo.
 */
export function PestanasFactura({
  facturas,
  activaIdx,
  deshabilitado,
  onCambiar,
  onAgregar,
  onCerrar,
  onNumero,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const activa = facturas[activaIdx]

  return (
    <div>
      <div className="-mx-4 mb-2 flex gap-1.5 overflow-x-auto px-4 pb-1">
        {facturas.map((f, i) => {
          const esActiva = i === activaIdx
          const unidades = unidadesDeCargas(f.cargas)
          const numero = f.numero.trim()
          return (
            <div
              key={f.id}
              className={cn(
                'flex h-11 shrink-0 items-center rounded-xl border transition',
                esActiva
                  ? 'border-[#e4a42a] bg-[#f9b44c] text-[#391511]'
                  : 'border-[#e4c9b0] bg-white text-[#6f3a2a]'
              )}
            >
              <button
                type="button"
                onClick={() => onCambiar(i)}
                className="flex h-full items-center gap-1.5 pl-3 pr-2 text-xs font-semibold active:scale-95"
              >
                {numero ? (
                  <Check
                    className={cn(
                      'h-3.5 w-3.5 shrink-0',
                      esActiva ? 'text-[#391511]' : 'text-[#9e6b15]'
                    )}
                  />
                ) : unidades > 0 ? (
                  // Tiene mercadería pero le falta el N° (obligatorio al final).
                  <span className="h-2 w-2 shrink-0 rounded-full bg-[#c43e2c]" />
                ) : null}
                <span className="max-w-28 truncate">
                  {numero ? `Fact. ${numero}` : `Factura ${i + 1}`}
                </span>
                <span className="shrink-0 tabular-nums opacity-80">
                  {formatearNumero(Math.round(unidades * 1000) / 1000)} u.
                </span>
              </button>
              {esActiva && facturas.length > 1 && (
                <button
                  type="button"
                  onClick={() => onCerrar(i)}
                  disabled={deshabilitado}
                  aria-label={`Cerrar la factura ${i + 1}`}
                  className="flex h-full w-8 items-center justify-center text-[#391511]/60 active:scale-90"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          )
        })}
        <button
          type="button"
          onClick={onAgregar}
          disabled={deshabilitado}
          aria-label="Otra factura"
          className="flex h-11 shrink-0 items-center gap-1 rounded-xl border border-dashed border-[#e4c9b0] bg-white/60 px-3 text-xs font-semibold text-[#9e6b15] active:scale-95"
        >
          <Plus className="h-4 w-4" />
          Otra
        </button>
      </div>

      <Input
        ref={inputRef}
        value={activa?.numero ?? ''}
        onChange={(e) => onNumero(e.target.value)}
        placeholder="N° de la factura"
        aria-label="Número de la factura de esta entrega"
        className="h-11 border-[#e4c9b0] text-sm focus-visible:ring-[#f9b44c]"
      />
    </div>
  )
}
