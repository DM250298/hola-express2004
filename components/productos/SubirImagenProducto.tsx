'use client'

import { useRef, useState } from 'react'
import { ImagePlus, Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'

interface Props {
  /** URL actual de la imagen (o null). */
  value: string | null
  onChange: (url: string | null) => void
  disabled?: boolean
}

const BUCKET = 'productos'
const MAX_MB = 3

/**
 * Subida de imagen de producto a Supabase Storage (bucket público `productos`).
 * Muestra preview, sube al elegir y devuelve la URL pública por onChange.
 */
export function SubirImagenProducto({ value, onChange, disabled }: Props) {
  const [subiendo, setSubiendo] = useState(false)
  const [previewLocal, setPreviewLocal] = useState<string | null>(null)
  const refInput = useRef<HTMLInputElement>(null)

  async function manejarArchivo(file: File | null) {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error('Elegí un archivo de imagen.')
      return
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      toast.error(`La imagen supera los ${MAX_MB} MB.`)
      return
    }
    setPreviewLocal(URL.createObjectURL(file))
    setSubiendo(true)
    try {
      const supabase = createClient()
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
      const nombre = `${crypto.randomUUID()}.${ext}`
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(nombre, file, { cacheControl: '3600', upsert: false })
      if (error) throw error
      const { data } = supabase.storage.from(BUCKET).getPublicUrl(nombre)
      onChange(data.publicUrl)
    } catch (e) {
      setPreviewLocal(null)
      toast.error(
        `No se pudo subir la imagen: ${e instanceof Error ? e.message : 'error'}`
      )
    } finally {
      setSubiendo(false)
    }
  }

  const src = previewLocal ?? value

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <div className="h-20 w-20 shrink-0 rounded-xl border border-[#e4c9b0] bg-[#fdfaf6] overflow-hidden flex items-center justify-center">
          {src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt="Producto" className="h-full w-full object-cover" />
          ) : (
            <ImagePlus className="h-6 w-6 text-[#c8a58a]" />
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <input
            ref={refInput}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => manejarArchivo(e.target.files?.[0] ?? null)}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || subiendo}
            onClick={() => refInput.current?.click()}
            className="border-[#e4c9b0] text-[#6f3a2a] hover:bg-[#f9d2a2]/40 gap-1.5"
          >
            {subiendo ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ImagePlus className="h-3.5 w-3.5" />
            )}
            {src ? 'Cambiar imagen' : 'Subir imagen'}
          </Button>
          {src && !subiendo && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => {
                setPreviewLocal(null)
                onChange(null)
              }}
              className="text-[#c43e2c] hover:bg-[#c43e2c]/10 gap-1.5 h-8"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Quitar
            </Button>
          )}
        </div>
      </div>
      <p className="text-[11px] text-[#c8a58a]">
        JPG o PNG, hasta {MAX_MB} MB. Se muestra en la tienda online.
      </p>
    </div>
  )
}
