'use client'

import { useEffect, useState } from 'react'
import { Check, Loader2, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useAsignarAUbicacion } from '@/lib/hooks/useMapa'
import {
  buscarProductosUbicables,
  type ProductoUbicable,
} from '@/lib/queries/ubicaciones'

/**
 * Asignar productos a una ubicación desde la computadora: buscás por nombre
 * o código y vas asignando uno atrás de otro sin cerrar el modal.
 */
export function ModalAsignarProductos({
  ubicacion,
  onCerrar,
}: {
  ubicacion: { id: number; nombre: string }
  onCerrar: () => void
}) {
  const [termino, setTermino] = useState('')
  const [resultados, setResultados] = useState<ProductoUbicable[]>([])
  const [buscando, setBuscando] = useState(false)
  const [hechos, setHechos] = useState<Map<number, string>>(new Map())
  const asignar = useAsignarAUbicacion()

  useEffect(() => {
    const t = termino.trim()
    if (t.length < 2) {
      setResultados([])
      return
    }
    let cancelado = false
    const timer = setTimeout(async () => {
      setBuscando(true)
      try {
        const r = await buscarProductosUbicables(t)
        if (!cancelado) setResultados(r)
      } catch {
        if (!cancelado) toast.error('No se pudo buscar. Probá de nuevo.')
      } finally {
        if (!cancelado) setBuscando(false)
      }
    }, 250)
    return () => {
      cancelado = true
      clearTimeout(timer)
    }
  }, [termino])

  function alAsignar(p: ProductoUbicable) {
    asignar.mutate(
      { productoId: p.id, ubicacionId: ubicacion.id },
      {
        onSuccess: (como) => {
          setHechos((prev) => new Map(prev).set(p.id, como))
          toast.success(
            como === 'ya estaba' ? `${p.nombre} ya estaba acá` : `${p.nombre} → ${como}`
          )
        },
      }
    )
  }

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && onCerrar()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Asignar productos</DialogTitle>
          <DialogDescription>
            A {ubicacion.nombre}. Si el producto no tenía ubicación queda como principal;
            si ya tenía, como secundaria.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#c8a58a]" />
          <input
            autoFocus
            value={termino}
            onChange={(e) => setTermino(e.target.value)}
            placeholder="Nombre o código de barras…"
            className="h-10 w-full rounded-lg border border-[#e4c9b0] bg-white pl-9 pr-3 text-sm text-[#391511] focus:outline-none focus:ring-2 focus:ring-[#f9b44c]/40"
          />
        </div>

        <ul className="max-h-80 divide-y divide-[#e4c9b0]/40 overflow-y-auto">
          {buscando && (
            <li className="flex items-center gap-2 py-3 text-sm text-[#6f3a2a]">
              <Loader2 className="h-4 w-4 animate-spin" /> Buscando…
            </li>
          )}
          {!buscando && termino.trim().length >= 2 && resultados.length === 0 && (
            <li className="py-3 text-sm text-[#c8a58a]">Sin resultados.</li>
          )}
          {resultados.map((p) => {
            const hecho = hechos.get(p.id)
            return (
              <li key={p.id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-[#391511]">{p.nombre}</p>
                  {p.codigo_barras && (
                    <p className="font-mono text-xs text-[#c8a58a]">{p.codigo_barras}</p>
                  )}
                </div>
                {hecho ? (
                  <span className="flex items-center gap-1 text-xs font-semibold text-[#2f7d4f]">
                    <Check className="h-4 w-4" /> {hecho}
                  </span>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => alAsignar(p)}
                    disabled={asignar.isPending}
                  >
                    Asignar
                  </Button>
                )}
              </li>
            )
          })}
        </ul>

        <div className="flex justify-end">
          <Button variant="outline" onClick={onCerrar}>
            Listo
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
