'use client'

import { useEffect, useState } from 'react'
import { Loader2, Search, UserPlus, UserX, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ModalCliente } from '@/components/clientes/ModalCliente'
import { useClientes } from '@/lib/hooks/useClientes'
import { cn } from '@/lib/utils'

export interface ClienteSeleccionado {
  id: number
  nombre: string
}

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  /** Devuelve el cliente elegido, o null para una venta al mostrador. */
  onSeleccionar: (cliente: ClienteSeleccionado | null) => void
}

const MAX_RESULTADOS = 8

export function SelectorCliente({
  abierto,
  onCambioAbierto,
  onSeleccionar,
}: Props) {
  const [busquedaInput, setBusquedaInput] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [modalNuevo, setModalNuevo] = useState(false)
  // Índice del cliente resaltado para navegación con teclado (↑/↓ + Enter).
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

  const { data: clientes, isLoading } = useClientes({
    busqueda: busqueda || undefined,
    activo: true,
  })

  const resultados = (clientes ?? []).slice(0, MAX_RESULTADOS)

  // Al cambiar los resultados, volver el resaltado al primero.
  useEffect(() => {
    setIndiceSeleccionado(0)
  }, [busqueda])

  function elegir(c: ClienteSeleccionado | null) {
    onSeleccionar(c)
    onCambioAbierto(false)
  }

  /** Navegación por teclado sobre la lista de clientes. */
  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' && resultados.length > 0) {
      e.preventDefault()
      setIndiceSeleccionado((i) => Math.min(i + 1, resultados.length - 1))
    } else if (e.key === 'ArrowUp' && resultados.length > 0) {
      e.preventDefault()
      setIndiceSeleccionado((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter' && resultados.length > 0) {
      e.preventDefault()
      const c = resultados[Math.min(indiceSeleccionado, resultados.length - 1)]
      elegir({ id: c.id, nombre: c.nombre })
    } else if (e.key === 'Escape' && busquedaInput) {
      // Primer Esc limpia la búsqueda; el segundo (sin texto) cierra el modal.
      e.preventDefault()
      setBusquedaInput('')
    }
  }

  return (
    <>
      <Dialog open={abierto} onOpenChange={onCambioAbierto}>
        <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-6 py-4 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
            <DialogTitle className="text-[#391511] text-lg">
              Cliente de la venta
            </DialogTitle>
            <DialogDescription className="text-[#6f3a2a]">
              Asociá la venta a un cliente para su historial. Es opcional.
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
                placeholder="Buscar por nombre, teléfono o documento…"
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

            <div className="border border-[#e4c9b0]/60 rounded-xl overflow-hidden max-h-[280px] overflow-y-auto">
              {/* Opción: sin cliente */}
              <button
                type="button"
                onClick={() => elegir(null)}
                className="w-full px-4 py-2.5 flex items-center gap-2 text-left border-b border-[#e4c9b0]/40 hover:bg-[#fdfaf6] text-[#6f3a2a]"
              >
                <UserX className="h-4 w-4 text-[#c8a58a]" />
                <span className="text-sm font-medium">
                  Venta al mostrador (sin cliente)
                </span>
              </button>

              {isLoading ? (
                <div className="p-6 flex items-center justify-center gap-2 text-[#6f3a2a] text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Buscando…
                </div>
              ) : resultados.length === 0 ? (
                <div className="p-6 text-center text-[#6f3a2a] text-sm">
                  {busqueda
                    ? 'No se encontraron clientes.'
                    : 'Escribí para buscar un cliente.'}
                </div>
              ) : (
                <ul className="divide-y divide-[#e4c9b0]/40">
                  {resultados.map((c, idx) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => elegir({ id: c.id, nombre: c.nombre })}
                        onMouseEnter={() => setIndiceSeleccionado(idx)}
                        className={cn(
                          'w-full px-4 py-2.5 flex items-center justify-between gap-3 text-left',
                          idx === indiceSeleccionado
                            ? 'bg-[#f9d2a2]/40'
                            : 'hover:bg-[#fdfaf6]'
                        )}
                      >
                        <div className="min-w-0">
                          <div className="font-medium text-[#391511] text-sm truncate">
                            {c.nombre}
                          </div>
                          <div className="text-xs text-[#c8a58a] truncate">
                            {[c.telefono, c.documento]
                              .filter(Boolean)
                              .join(' · ') || 'Sin contacto'}
                          </div>
                        </div>
                        <span className="text-[10px] text-[#6f3a2a] tabular-nums shrink-0">
                          {c.cantidad_compras}{' '}
                          {c.cantidad_compras === 1 ? 'compra' : 'compras'}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {resultados.length > 0 && (
              <p className="text-[10px] text-[#c8a58a] text-center">
                Usá{' '}
                <kbd className="px-1 py-0 bg-[#fdfaf6] border border-[#e4c9b0] rounded text-[9px] font-mono">
                  ↑↓
                </kbd>{' '}
                para navegar ·{' '}
                <kbd className="px-1 py-0 bg-[#fdfaf6] border border-[#e4c9b0] rounded text-[9px] font-mono">
                  ↵
                </kbd>{' '}
                para elegir
              </p>
            )}

            <Button
              type="button"
              variant="outline"
              onClick={() => setModalNuevo(true)}
              className="w-full border-[#e4c9b0] text-[#6f3a2a] gap-1.5"
            >
              <UserPlus className="h-4 w-4" />
              Crear cliente nuevo
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ModalCliente
        abierto={modalNuevo}
        onCambioAbierto={setModalNuevo}
        onCreado={(nuevo) => elegir({ id: nuevo.id, nombre: nuevo.nombre })}
      />
    </>
  )
}
