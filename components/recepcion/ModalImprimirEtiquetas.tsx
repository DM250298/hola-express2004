'use client'

import { useEffect, useMemo, useState } from 'react'
import { Minus, Plus, Printer, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EtiquetaVencimiento } from './EtiquetaVencimiento'

export interface ItemParaEtiqueta {
  producto_id: number
  producto_nombre: string
  codigo_barras: string | null
  fecha_vencimiento: string // ISO yyyy-MM-dd
  cantidad_recibida: number
  lote_id?: number | null
}

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  items: ItemParaEtiqueta[]
}

export function ModalImprimirEtiquetas({
  abierto,
  onCambioAbierto,
  items,
}: Props) {
  // Cantidad de etiquetas a imprimir por item (default = cantidad recibida)
  const [cantidades, setCantidades] = useState<Record<number, number>>({})

  useEffect(() => {
    if (abierto) {
      const inicial: Record<number, number> = {}
      for (const it of items) {
        inicial[it.producto_id] = it.cantidad_recibida
      }
      setCantidades(inicial)
    }
  }, [abierto, items])

  function ajustar(producto_id: number, delta: number) {
    setCantidades((prev) => ({
      ...prev,
      [producto_id]: Math.max(0, (prev[producto_id] ?? 0) + delta),
    }))
  }

  function setCantidad(producto_id: number, valor: string) {
    const n = Math.max(0, Math.floor(Number(valor) || 0))
    setCantidades((prev) => ({ ...prev, [producto_id]: n }))
  }

  // Expansión: cada item × cantidad = N etiquetas idénticas
  const etiquetasExpandidas = useMemo(() => {
    const lista: ItemParaEtiqueta[] = []
    for (const it of items) {
      const n = cantidades[it.producto_id] ?? 0
      for (let i = 0; i < n; i++) {
        lista.push(it)
      }
    }
    return lista
  }, [items, cantidades])

  const totalEtiquetas = etiquetasExpandidas.length

  function imprimir() {
    if (totalEtiquetas === 0) return
    // El CSS @media print ya se encarga de ocultar todo menos
    // `.etiquetas-imprimir`. Solo invocamos el diálogo del browser.
    window.print()
  }

  return (
    <Dialog open={abierto} onOpenChange={onCambioAbierto}>
      <DialogContent className="sm:max-w-2xl p-0 gap-0 overflow-hidden max-h-[90vh] flex flex-col">
        <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6] shrink-0">
          <DialogTitle className="text-[#391511] text-lg flex items-center gap-2">
            <Printer className="h-5 w-5 text-[#f9b44c]" />
            Imprimir etiquetas de vencimiento
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            Impresora térmica de 58mm. Una etiqueta por unidad para pegar en
            cada producto.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {items.length === 0 ? (
            <div className="text-center py-8 text-[#6f3a2a] text-sm">
              Ningún producto cargó fecha de vencimiento en esta recepción.
              <br />
              No hay etiquetas para imprimir.
            </div>
          ) : (
            <>
              <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                Productos con vencimiento ({items.length})
              </div>

              <ul className="space-y-2">
                {items.map((it) => (
                  <li
                    key={it.producto_id}
                    className="bg-white border border-[#e4c9b0]/60 rounded-xl px-3 py-2.5 flex items-center gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-[#391511] text-sm truncate">
                        {it.producto_nombre}
                      </div>
                      <div className="text-xs text-[#6f3a2a] mt-0.5">
                        Vence: <span className="font-semibold tabular-nums">{it.fecha_vencimiento}</span>
                        {it.codigo_barras && (
                          <span className="text-[#c8a58a] font-mono ml-2">
                            {it.codigo_barras}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => ajustar(it.producto_id, -1)}
                        className="h-8 w-8 border-[#e4c9b0]"
                        aria-label="Menos"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </Button>
                      <Input
                        type="number"
                        min="0"
                        value={cantidades[it.producto_id] ?? 0}
                        onChange={(e) => setCantidad(it.producto_id, e.target.value)}
                        className="w-16 h-8 text-center font-bold tabular-nums border-[#e4c9b0]"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => ajustar(it.producto_id, 1)}
                        className="h-8 w-8 border-[#e4c9b0]"
                        aria-label="Más"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>

              {/* Preview compacto */}
              {totalEtiquetas > 0 && (
                <div className="pt-3 border-t border-[#e4c9b0]/40">
                  <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold mb-2">
                    Vista previa (primera etiqueta)
                  </div>
                  <div className="flex justify-center bg-[#fdfaf6] rounded-xl p-4">
                    <EtiquetaVencimiento datos={etiquetasExpandidas[0]} />
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="border-t border-[#e4c9b0]/60 bg-[#fdfaf6] px-6 py-4 flex gap-2 shrink-0">
          <Button
            variant="outline"
            onClick={() => onCambioAbierto(false)}
            className="flex-1 h-11 border-[#e4c9b0] text-[#6f3a2a] gap-1.5"
          >
            <X className="h-4 w-4" />
            No imprimir
          </Button>
          <Button
            onClick={imprimir}
            disabled={totalEtiquetas === 0}
            className="flex-[2] h-11 bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-extrabold rounded-xl disabled:opacity-50 gap-2"
          >
            <Printer className="h-4 w-4" />
            Imprimir {totalEtiquetas} {totalEtiquetas === 1 ? 'etiqueta' : 'etiquetas'}
          </Button>
        </div>
      </DialogContent>

      {/* Render OFF-SCREEN de las etiquetas reales para imprimir.
          El CSS @media print en globals.css las hace visibles y oculta el resto. */}
      {totalEtiquetas > 0 && (
        <div className="etiquetas-imprimir" aria-hidden>
          {etiquetasExpandidas.map((it, idx) => (
            <EtiquetaVencimiento key={`${it.producto_id}-${idx}`} datos={it} />
          ))}
        </div>
      )}
    </Dialog>
  )
}
