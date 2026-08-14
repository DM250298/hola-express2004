'use client'

import { useEffect, useState } from 'react'
import { Barcode, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
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
import { EscanerCamara } from './EscanerCamara'
import { useAsignarCodigoBarras } from '@/lib/hooks/useProductos'
import { esCodigoAutogenerado } from '@/lib/utils/codigoBarras'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  producto: { id: number; nombre: string; codigo_barras: string | null } | null
  /** Se llama con el código guardado, para refrescar la pantalla que lo abrió. */
  onGuardado: (productoId: number, codigo: string) => void
}

/**
 * Editar / asignar el código de barras de un producto desde el teléfono.
 * Pensado para la recepción: un producto dado de alta al vuelo queda con el
 * código autogenerado (`HEX-…`) y no se puede escanear nunca más; acá el
 * encargado le pega el EAN del envase con la cámara, sin salir de la descarga.
 */
export function ModalCodigoBarras({
  abierto,
  onCambioAbierto,
  producto,
  onGuardado,
}: Props) {
  const [codigo, setCodigo] = useState('')
  const asignar = useAsignarCodigoBarras()

  // Precarga en cada apertura (y en cada cambio de producto): el código real
  // se edita, el autogenerado arranca vacío porque no sirve de nada.
  useEffect(() => {
    if (!abierto || !producto) return
    setCodigo(
      esCodigoAutogenerado(producto.codigo_barras)
        ? ''
        : (producto.codigo_barras ?? '')
    )
  }, [abierto, producto])

  if (!producto) return null

  async function guardar() {
    if (!producto) return
    const cod = codigo.trim()
    if (!cod) {
      toast.error('Poné o escaneá el código de barras.')
      return
    }
    try {
      await asignar.mutateAsync({ id: producto.id, codigo: cod })
      onGuardado(producto.id, cod)
      onCambioAbierto(false)
    } catch {
      // el toast de error lo muestra el hook
    }
  }

  return (
    <Dialog open={abierto} onOpenChange={onCambioAbierto}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[#391511]">
            <Barcode className="h-5 w-5 text-[#f9b44c]" />
            Código de barras
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            {producto.nombre}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <EscanerCamara
            onDetectado={(c) => {
              setCodigo(c)
              toast.success(`Leí ${c}`)
            }}
            ayuda="Escaneá el envase para copiar su código"
          />

          <div>
            <Label className="text-xs text-[#6f3a2a]">
              Código (se puede corregir a mano)
            </Label>
            <Input
              inputMode="numeric"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              placeholder="Ej: 7790040000123"
              className="h-12 border-[#e4c9b0] font-mono text-base focus-visible:ring-[#f9b44c]"
            />
            {esCodigoAutogenerado(producto.codigo_barras) && (
              <p className="mt-1 text-[11px] leading-snug text-[#6f3a2a]">
                Este producto todavía no tiene código real ({producto.codigo_barras}).
                Cargalo para poder escanearlo en la caja y en la recepción.
              </p>
            )}
          </div>

          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              onClick={() => onCambioAbierto(false)}
              disabled={asignar.isPending}
              className="flex-1 border-[#e4c9b0] text-[#6f3a2a]"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={guardar}
              disabled={asignar.isPending}
              className="flex-1 bg-[#f9b44c] font-semibold text-[#391511] hover:bg-[#e4a42a]"
            >
              {asignar.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Guardando…
                </>
              ) : (
                'Guardar código'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
