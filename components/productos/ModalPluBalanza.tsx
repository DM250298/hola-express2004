'use client'

import { useEffect, useState } from 'react'
import { Scale } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { FormularioPluBalanza } from './FormularioPluBalanza'
import type { ProductoConRelaciones } from '@/lib/queries/productos'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  /** PLU leído de una etiqueta sin producto (POS): precarga el campo. */
  pluInicial?: number | null
  onGuardado?: (producto: ProductoConRelaciones, plu: number) => void
}

/**
 * Asignar el PLU de balanza desde el POS (mig 327): se abre cuando el cajero
 * escanea una etiqueta cuyo PLU no tiene producto. Sin cámara: en la PC el
 * lector USB escribe en el buscador del formulario.
 */
export function ModalPluBalanza({
  abierto,
  onCambioAbierto,
  pluInicial = null,
  onGuardado,
}: Props) {
  const [producto, setProducto] = useState<ProductoConRelaciones | null>(null)
  const [plu, setPlu] = useState('')

  // Cada apertura arranca limpia, con el PLU de la etiqueta si vino.
  useEffect(() => {
    if (!abierto) return
    setProducto(null)
    setPlu(pluInicial != null ? String(pluInicial) : '')
  }, [abierto, pluInicial])

  return (
    <Dialog open={abierto} onOpenChange={onCambioAbierto}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[#391511]">
            <Scale className="h-5 w-5 text-[#f9b44c]" />
            PLU de balanza
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            {pluInicial != null
              ? `Ningún producto tiene el PLU ${pluInicial}. Elegí cuál es y queda guardado.`
              : 'Buscá el producto por kg y poné el número que tiene en la balanza.'}
          </DialogDescription>
        </DialogHeader>

        <FormularioPluBalanza
          producto={producto}
          onCambiarProducto={setProducto}
          plu={plu}
          onCambiarPlu={setPlu}
          autoFocusBusqueda
          onCancelar={() => onCambioAbierto(false)}
          onGuardado={(p, n) => {
            onGuardado?.(p, n)
            onCambioAbierto(false)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
