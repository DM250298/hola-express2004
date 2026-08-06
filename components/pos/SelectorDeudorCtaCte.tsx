'use client'

import { useEffect, useState } from 'react'
import { Loader2, Search, X } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { MontoARS } from '@/components/shared/MontoARS'
import { useBuscarDeudores } from '@/lib/hooks/useCtaCte'
import { cn } from '@/lib/utils'
import type { DeudorBuscado } from '@/types/database'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  /** Devuelve el deudor elegido. */
  onSeleccionar: (deudor: DeudorBuscado) => void
  /**
   * 'fiar' (default): elegibles los que tienen cupo — para cargar deuda.
   * 'cobrar': elegibles los que tienen deuda — para cobrarla.
   */
  modo?: 'fiar' | 'cobrar'
}

const MAX_RESULTADOS = 8

/**
 * Buscador unificado de deudores (clientes + empleados) para fiar en el POS.
 * Molde de SelectorCliente: debounce 250ms, ↑↓/Enter. Alimentado por
 * fn_buscar_deudores (definer): trae nombre, saldo y tiene_cupo — para
 * empleados NO trae el cupo disponible (revelaría el sueldo).
 */
export function SelectorDeudorCtaCte({
  abierto,
  onCambioAbierto,
  onSeleccionar,
  modo = 'fiar',
}: Props) {
  const [busquedaInput, setBusquedaInput] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [indiceSeleccionado, setIndiceSeleccionado] = useState(0)

  useEffect(() => {
    if (abierto) {
      setBusquedaInput('')
      setBusqueda('')
      setIndiceSeleccionado(0)
    }
  }, [abierto])

  useEffect(() => {
    const t = setTimeout(() => setBusqueda(busquedaInput), 250)
    return () => clearTimeout(t)
  }, [busquedaInput])

  const { data: deudores, isLoading } = useBuscarDeudores(busqueda, abierto)

  const resultados = (deudores ?? []).slice(0, MAX_RESULTADOS)
  const esElegible = (d: DeudorBuscado) =>
    modo === 'fiar' ? d.tiene_cupo : d.saldo > 0.009
  const elegibles = resultados.filter(esElegible)

  useEffect(() => {
    setIndiceSeleccionado(0)
  }, [busqueda])

  function elegir(d: DeudorBuscado) {
    if (!esElegible(d)) return
    onSeleccionar(d)
    onCambioAbierto(false)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' && elegibles.length > 0) {
      e.preventDefault()
      setIndiceSeleccionado((i) => Math.min(i + 1, elegibles.length - 1))
    } else if (e.key === 'ArrowUp' && elegibles.length > 0) {
      e.preventDefault()
      setIndiceSeleccionado((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter' && elegibles.length > 0) {
      e.preventDefault()
      elegir(elegibles[Math.min(indiceSeleccionado, elegibles.length - 1)])
    } else if (e.key === 'Escape' && busquedaInput) {
      e.preventDefault()
      setBusquedaInput('')
    }
  }

  return (
    <Dialog open={abierto} onOpenChange={onCambioAbierto}>
      <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-4 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <DialogTitle className="text-[#391511] text-lg">
            {modo === 'fiar' ? '¿A quién se le fía?' : '¿Quién viene a pagar?'}
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            {modo === 'fiar'
              ? 'La venta queda cargada en su cuenta corriente.'
              : 'El pago baja la deuda de su cuenta corriente.'}
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-4 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#c8a58a] pointer-events-none" />
            <Input
              autoFocus
              value={busquedaInput}
              onChange={(e) => setBusquedaInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Buscar cliente o empleado…"
              className="pl-9 pr-9 border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
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

          <div className="border border-[#e4c9b0]/60 rounded-xl overflow-hidden max-h-[300px] overflow-y-auto">
            {isLoading ? (
              <div className="p-6 flex items-center justify-center gap-2 text-[#6f3a2a] text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Buscando…
              </div>
            ) : resultados.length === 0 ? (
              <div className="p-6 text-center text-[#6f3a2a] text-sm">
                {busqueda
                  ? 'No se encontró a nadie con ese nombre.'
                  : 'Escribí para buscar un cliente o empleado.'}
              </div>
            ) : (
              <ul className="divide-y divide-[#e4c9b0]/40">
                {resultados.map((d) => {
                  const elegible = esElegible(d)
                  const idxElegible = elegibles.indexOf(d)
                  const resaltado =
                    elegible && idxElegible === indiceSeleccionado
                  return (
                    <li key={`${d.deudor_tipo}-${d.deudor_id}`}>
                      <button
                        type="button"
                        onClick={() => elegir(d)}
                        onMouseEnter={() => {
                          if (idxElegible >= 0) setIndiceSeleccionado(idxElegible)
                        }}
                        disabled={!elegible}
                        className={cn(
                          'w-full px-4 py-2.5 flex items-center justify-between gap-3 text-left',
                          !elegible
                            ? 'opacity-55 cursor-not-allowed'
                            : resaltado
                              ? 'bg-[#f9d2a2]/40'
                              : 'hover:bg-[#fdfaf6]'
                        )}
                      >
                        <div className="min-w-0">
                          <div className="font-medium text-[#391511] text-sm truncate flex items-center gap-1.5">
                            {d.nombre}
                            <span
                              className={cn(
                                'text-[9px] uppercase tracking-wider rounded-full px-1.5 py-0.5 shrink-0',
                                d.deudor_tipo === 'empleado'
                                  ? 'bg-[#f9d2a2]/60 text-[#6f3a2a]'
                                  : 'bg-[#6f3a2a]/10 text-[#6f3a2a]'
                              )}
                            >
                              {d.deudor_tipo === 'empleado'
                                ? 'Empleado'
                                : 'Cliente'}
                            </span>
                          </div>
                          <div className="text-xs text-[#c8a58a] truncate">
                            {d.saldo > 0.009 ? (
                              <>
                                Debe <MontoARS monto={d.saldo} />
                              </>
                            ) : (
                              'Sin deuda'
                            )}
                            {d.disponible !== null && d.tiene_cupo && (
                              <>
                                {' · '}cupo <MontoARS monto={d.disponible} />
                              </>
                            )}
                          </div>
                        </div>
                        {!elegible && (
                          <span className="text-[9px] uppercase tracking-wider text-[#9e2f25] bg-[#c43e2c]/10 rounded-full px-1.5 py-0.5 shrink-0">
                            {modo === 'fiar' ? 'Sin cupo' : 'Sin deuda'}
                          </span>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <p className="text-[10px] text-[#c8a58a] text-center">
            {modo === 'fiar'
              ? 'Los que dicen “Sin cupo” no tienen tope habilitado o ya lo usaron. El tope se configura en Finanzas → Fiado.'
              : 'Solo se puede cobrar a quien tiene deuda.'}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
