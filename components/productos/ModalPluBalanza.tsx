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
import {
  FormularioPluBalanza,
  type ProductoParaPlu,
} from './FormularioPluBalanza'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  /** PLU leído de una etiqueta sin producto (POS): precarga el campo. */
  pluInicial?: number | null
  /** Producto ya elegido (ficha de Inventario): sin buscador, solo el PLU. */
  producto?: ProductoParaPlu | null
  onGuardado?: (producto: ProductoParaPlu, plu: number) => void
}

/**
 * Asignar el PLU de balanza (mig 327). Lo abre el POS cuando el cajero
 * escanea una etiqueta cuyo PLU no tiene producto (`pluInicial`, se elige el
 * producto adentro) y la ficha de Inventario (`producto` fijo). Sin cámara:
 * en la PC el lector USB escribe en el buscador del formulario.
 */
export function ModalPluBalanza({
  abierto,
  onCambioAbierto,
  pluInicial = null,
  producto: productoFijo = null,
  onGuardado,
}: Props) {
  const [producto, setProducto] = useState<ProductoParaPlu | null>(null)
  const [plu, setPlu] = useState('')

  // Cada apertura arranca limpia: con el producto de la ficha y su PLU actual,
  // o con el PLU de la etiqueta. Deps PRIMITIVAS a propósito: un refetch de
  // la ficha recrea el objeto y no debe pisar lo que se está tipeando.
  const fijoId = productoFijo?.id ?? null
  const fijoPlu = productoFijo?.plu_balanza ?? null
  useEffect(() => {
    if (!abierto) return
    setProducto(productoFijo ?? null)
    setPlu(
      pluInicial != null
        ? String(pluInicial)
        : fijoPlu != null
          ? String(fijoPlu)
          : ''
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, pluInicial, fijoId, fijoPlu])

  const descripcion = productoFijo
    ? `Poné el número que tiene "${productoFijo.nombre}" en la balanza.`
    : pluInicial != null
      ? `Ningún producto tiene el PLU ${pluInicial}. Elegí cuál es y queda guardado.`
      : 'Buscá el producto por kg y poné el número que tiene en la balanza.'

  return (
    <Dialog open={abierto} onOpenChange={onCambioAbierto}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[#391511]">
            <Scale className="h-5 w-5 text-[#f9b44c]" />
            PLU de balanza
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            {descripcion}
          </DialogDescription>
        </DialogHeader>

        <FormularioPluBalanza
          producto={producto}
          onCambiarProducto={setProducto}
          productoFijo={productoFijo !== null}
          plu={plu}
          onCambiarPlu={setPlu}
          autoFocusBusqueda={productoFijo === null}
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
