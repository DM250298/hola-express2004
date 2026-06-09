'use client'

import { useRef } from 'react'
import {
  Camera,
  ImagePlus,
  Loader2,
  Receipt,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  useComprobantesPedido,
  useEliminarComprobante,
  useSubirComprobante,
} from '@/lib/hooks/useComprobantes'

interface Props {
  pedidoId: number | undefined
  usuarioId: string | null
  /** Oculta las acciones de subir/quitar (solo ver). */
  soloLectura?: boolean
}

/**
 * Galería de imágenes del comprobante (factura/remito) de un pedido.
 * "Sacar foto" abre la cámara en tablet/celular (input capture); "Subir
 * archivo" permite elegir una o varias imágenes. Se puede reusar en la
 * recepción y al cargar la factura — todo asociado al mismo pedido.
 */
export function GaleriaComprobantes({ pedidoId, usuarioId, soloLectura }: Props) {
  const { data: imagenes, isLoading } = useComprobantesPedido(pedidoId)
  const subir = useSubirComprobante(pedidoId)
  const eliminar = useEliminarComprobante(pedidoId)
  const refCamara = useRef<HTMLInputElement>(null)
  const refArchivo = useRef<HTMLInputElement>(null)

  function manejarArchivos(files: FileList | null) {
    if (!files || files.length === 0) return
    Array.from(files).forEach((file) => subir.mutate({ file, usuarioId }))
  }

  const cantidad = imagenes?.length ?? 0

  return (
    <div className="bg-[#f9b44c]/8 border border-[#f9b44c]/40 rounded-xl p-3 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold flex items-center gap-1">
          <Receipt className="h-3.5 w-3.5 text-[#f9b44c]" />
          Comprobante (factura / remito)
          {cantidad > 0 && (
            <span className="ml-1 text-[#391511] tabular-nums">· {cantidad}</span>
          )}
        </div>
        {!soloLectura && (
          <div className="flex gap-2">
            <input
              ref={refCamara}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                manejarArchivos(e.target.files)
                e.target.value = ''
              }}
            />
            <input
              ref={refArchivo}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                manejarArchivos(e.target.files)
                e.target.value = ''
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!pedidoId || subir.isPending}
              onClick={() => refCamara.current?.click()}
              className="border-[#e4c9b0] text-[#6f3a2a] hover:bg-[#f9d2a2]/40 gap-1.5 h-8"
            >
              {subir.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Camera className="h-3.5 w-3.5" />
              )}
              Sacar foto
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!pedidoId || subir.isPending}
              onClick={() => refArchivo.current?.click()}
              className="border-[#e4c9b0] text-[#6f3a2a] hover:bg-[#f9d2a2]/40 gap-1.5 h-8"
            >
              <ImagePlus className="h-3.5 w-3.5" />
              Subir archivo
            </Button>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="flex gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 w-20 rounded-lg bg-[#f9d2a2]/40" />
          ))}
        </div>
      ) : cantidad === 0 ? (
        <p className="text-[11px] text-[#6f3a2a]">
          {soloLectura
            ? 'No se adjuntó ningún comprobante.'
            : 'Sacá una foto de la factura o el remito, o subí una imagen. Podés adjuntar varias.'}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {imagenes?.map((img) => (
            <div
              key={img.id}
              className="relative h-20 w-20 rounded-lg overflow-hidden border border-[#e4c9b0] bg-[#fdfaf6] group"
            >
              {img.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <a href={img.url} target="_blank" rel="noopener noreferrer">
                  <img
                    src={img.url}
                    alt="Comprobante"
                    className="h-full w-full object-cover"
                  />
                </a>
              ) : (
                <div className="h-full w-full flex items-center justify-center">
                  <Receipt className="h-5 w-5 text-[#c8a58a]" />
                </div>
              )}
              {!soloLectura && (
                <button
                  type="button"
                  onClick={() =>
                    eliminar.mutate({
                      id: img.id,
                      storagePath: img.storage_path,
                    })
                  }
                  disabled={eliminar.isPending}
                  aria-label="Quitar comprobante"
                  className="absolute top-0.5 right-0.5 p-1 rounded-md bg-white/90 text-[#c43e2c] hover:bg-[#c43e2c] hover:text-white shadow-sm transition-colors"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
