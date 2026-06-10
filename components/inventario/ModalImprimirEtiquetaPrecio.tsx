'use client'

import { useEffect, useState } from 'react'
import { Minus, Plus, Printer, Tag, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EtiquetaPrecio, type DatosEtiquetaPrecio } from './EtiquetaPrecio'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  producto: DatosEtiquetaPrecio | null
}

export function ModalImprimirEtiquetaPrecio({
  abierto,
  onCambioAbierto,
  producto,
}: Props) {
  const [cantidad, setCantidad] = useState(1)
  // Datos editables de la etiqueta (no cambian el producto, solo lo que se imprime)
  const [nombre, setNombre] = useState('')
  const [precio, setPrecio] = useState(0)

  useEffect(() => {
    if (abierto && producto) {
      setCantidad(1)
      setNombre(producto.nombre)
      setPrecio(producto.precio_venta)
    }
  }, [abierto, producto])

  const datosEtiqueta: DatosEtiquetaPrecio = {
    nombre,
    codigo_barras: producto?.codigo_barras ?? null,
    precio_venta: precio,
  }

  function imprimir() {
    if (cantidad < 1) return
    window.print()
    // Imprimir no marca la etiqueta como colocada: eso se hace explícito con
    // el botón "Ya colocada" en la pantalla de Etiquetas.
  }

  return (
    <Dialog open={abierto} onOpenChange={onCambioAbierto}>
      <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <DialogTitle className="text-[#391511] text-lg flex items-center gap-2">
            <Tag className="h-5 w-5 text-[#f9b44c]" />
            Etiqueta de precio
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            Impresora térmica de 58mm. Etiqueta para pegar en góndola.
          </DialogDescription>
        </DialogHeader>

        {producto && (
          <div className="px-6 py-5 space-y-4">
            {/* Vista previa */}
            <div className="flex justify-center bg-[#fdfaf6] rounded-xl p-4 border border-[#e4c9b0]/60">
              <EtiquetaPrecio datos={datosEtiqueta} />
            </div>

            {/* Editar lo que se imprime */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="etq-nombre" className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                  Nombre en la etiqueta
                </Label>
                <Input
                  id="etq-nombre"
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="etq-precio" className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                  Precio
                </Label>
                <Input
                  id="etq-precio"
                  type="number"
                  min="0"
                  step="1"
                  value={precio}
                  onChange={(e) => setPrecio(Math.max(0, Number(e.target.value) || 0))}
                  className="tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
                />
              </div>
            </div>
            <p className="text-[11px] text-[#c8a58a]">
              Se imprime redondeado, sin centavos. Editar acá no cambia el precio del producto.
            </p>

            {/* Cantidad */}
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-[#391511]">
                Cantidad de etiquetas
              </span>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setCantidad((n) => Math.max(1, n - 1))}
                  className="h-8 w-8 border-[#e4c9b0]"
                  aria-label="Menos"
                >
                  <Minus className="h-3.5 w-3.5" />
                </Button>
                <Input
                  type="number"
                  min="1"
                  value={cantidad}
                  onChange={(e) =>
                    setCantidad(Math.max(1, Math.floor(Number(e.target.value) || 1)))
                  }
                  className="w-16 h-8 text-center font-bold tabular-nums border-[#e4c9b0]"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setCantidad((n) => n + 1)}
                  className="h-8 w-8 border-[#e4c9b0]"
                  aria-label="Más"
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>
        )}

        <div className="border-t border-[#e4c9b0]/60 bg-[#fdfaf6] px-6 py-4 flex gap-2">
          <Button
            variant="outline"
            onClick={() => onCambioAbierto(false)}
            className="flex-1 h-11 border-[#e4c9b0] text-[#6f3a2a] gap-1.5"
          >
            <X className="h-4 w-4" />
            Cancelar
          </Button>
          <Button
            onClick={imprimir}
            disabled={!producto}
            className="flex-[2] h-11 bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-extrabold rounded-xl gap-2"
          >
            <Printer className="h-4 w-4" />
            Imprimir {cantidad} {cantidad === 1 ? 'etiqueta' : 'etiquetas'}
          </Button>
        </div>
      </DialogContent>

      {/* Render off-screen para impresión térmica — una etiqueta por página */}
      {abierto && producto && (
        <div className="etiquetas-imprimir" aria-hidden>
          {Array.from({ length: cantidad }).map((_, i) => (
            <EtiquetaPrecio key={i} datos={datosEtiqueta} />
          ))}
        </div>
      )}
    </Dialog>
  )
}
