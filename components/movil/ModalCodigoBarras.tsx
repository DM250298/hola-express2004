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
import {
  useAsignarCodigoBarras,
  useMarcarSinCodigoBarras,
} from '@/lib/hooks/useProductos'
import { esCodigoAutogenerado, estadoCodigo } from '@/lib/utils/codigoBarras'
import { cn } from '@/lib/utils'

/** Lo que quedó guardado: un código real, o la marca de que no lleva. */
export type CambioCodigo =
  | { codigo_barras: string; sin_codigo_barras: false }
  | { codigo_barras: null; sin_codigo_barras: true }

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  producto: {
    id: number
    nombre: string
    codigo_barras: string | null
    sin_codigo_barras?: boolean | null
  } | null
  /** Se llama con lo guardado, para refrescar la pantalla que lo abrió. */
  onGuardado: (productoId: number, cambio: CambioCodigo) => void
  /**
   * Sin cámara: en la PC el lector USB escribe en el campo y Enter guarda.
   * Montar `EscanerCamara` ahí abriría `getUserMedia` sin sentido.
   */
  sinCamara?: boolean
  /** Por qué se pide el código ("Para recibirlo hace falta…"). */
  motivo?: string
}

/**
 * Editar / asignar el código de barras de un producto.
 *
 * Pensado para la recepción: un producto dado de alta al vuelo queda con el
 * código autogenerado (`HEX-…`) y no se puede escanear nunca más; acá quien
 * recibe le pega el EAN del envase con la cámara (o el lector USB en la PC),
 * sin salir de la descarga. Desde la 328 la recepción no deja recibir un
 * producto sin código, así que el modal también ofrece el tilde "No tiene
 * código de barras" para el pan, la verdura suelta y la producción propia.
 */
export function ModalCodigoBarras({
  abierto,
  onCambioAbierto,
  producto,
  onGuardado,
  sinCamara,
  motivo,
}: Props) {
  const [codigo, setCodigo] = useState('')
  const [sinCodigo, setSinCodigo] = useState(false)
  const asignar = useAsignarCodigoBarras()
  const marcar = useMarcarSinCodigoBarras()
  const guardando = asignar.isPending || marcar.isPending

  // Precarga en cada apertura (y en cada cambio de producto): el código real
  // se edita, el autogenerado arranca vacío porque no sirve de nada.
  // Deps PRIMITIVAS a propósito: si el caller recrea el objeto `producto` en
  // cada render (detalle de inventario), un refetch de fondo no debe pisar lo
  // que se está tipeando.
  const codigoActual = producto?.codigo_barras ?? null
  const marcadoActual = producto?.sin_codigo_barras === true
  useEffect(() => {
    if (!abierto) return
    setCodigo(esCodigoAutogenerado(codigoActual) ? '' : (codigoActual ?? ''))
    setSinCodigo(marcadoActual)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, producto?.id])

  if (!producto) return null

  const estado = estadoCodigo(producto)

  async function guardar() {
    if (!producto) return
    try {
      if (sinCodigo) {
        await marcar.mutateAsync({ id: producto.id })
        onGuardado(producto.id, { codigo_barras: null, sin_codigo_barras: true })
        onCambioAbierto(false)
        return
      }
      const cod = codigo.trim()
      if (!cod) {
        toast.error('Poné o escaneá el código de barras, o marcá que no tiene.')
        return
      }
      await asignar.mutateAsync({ id: producto.id, codigo: cod })
      onGuardado(producto.id, { codigo_barras: cod, sin_codigo_barras: false })
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
          {motivo && (
            <p className="rounded-lg border border-[#e4a42a]/60 bg-[#f9b44c]/15 px-3 py-2 text-xs font-medium text-[#391511]">
              {motivo}
            </p>
          )}

          {!sinCamara && (
            <EscanerCamara
              pausado={sinCodigo}
              onDetectado={(c) => {
                setCodigo(c)
                toast.success(`Leí ${c}`)
              }}
              ayuda="Escaneá el envase para copiar su código"
            />
          )}

          <div>
            <Label className="text-xs text-[#6f3a2a]">
              {sinCamara
                ? 'Código (escaneá con el lector o escribilo)'
                : 'Código (se puede corregir a mano)'}
            </Label>
            <Input
              autoFocus={sinCamara}
              inputMode="numeric"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void guardar()
                }
              }}
              disabled={sinCodigo || guardando}
              placeholder="Ej: 7790040000123"
              className="h-12 border-[#e4c9b0] font-mono text-base focus-visible:ring-[#f9b44c] disabled:opacity-50"
            />
            {estado === 'pendiente' && !sinCodigo && (
              <p className="mt-1 text-[11px] leading-snug text-[#6f3a2a]">
                Este producto todavía no tiene código real ({producto.codigo_barras}).
                Cargalo para poder escanearlo en la caja y en la recepción.
              </p>
            )}
          </div>

          {/* Un producto con código real no tiene por qué "no llevar": el
              tilde es para los que siguen con el HEX-… de la base. */}
          {estado !== 'real' && (
            <label
              className={cn(
                'flex items-start gap-2 rounded-xl border-2 p-3 text-sm transition',
                sinCodigo
                  ? 'border-[#2f7d4f]/40 bg-[#2f7d4f]/10'
                  : 'border-[#e4c9b0] bg-white'
              )}
            >
              <input
                type="checkbox"
                checked={sinCodigo}
                onChange={(e) => {
                  setSinCodigo(e.target.checked)
                  if (e.target.checked) setCodigo('')
                }}
                disabled={guardando}
                className="mt-0.5 h-5 w-5 shrink-0 accent-[#2f7d4f]"
              />
              <span className="font-medium text-[#391511]">
                No tiene código de barras
                <span className="mt-0.5 block text-[11px] font-normal text-[#6f3a2a]">
                  Pan, verdura suelta, producción propia. Se guarda sin código y
                  la recepción no lo vuelve a pedir.
                </span>
              </span>
            </label>
          )}

          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              onClick={() => onCambioAbierto(false)}
              disabled={guardando}
              className="flex-1 border-[#e4c9b0] text-[#6f3a2a]"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={guardar}
              disabled={guardando}
              className="flex-1 bg-[#f9b44c] font-semibold text-[#391511] hover:bg-[#e4a42a]"
            >
              {guardando ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Guardando…
                </>
              ) : sinCodigo ? (
                'Guardar sin código'
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
