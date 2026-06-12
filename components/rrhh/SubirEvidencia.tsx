'use client'

import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Camera, ImagePlus, Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { subirEvidencia } from '@/lib/queries/tareas'

interface Props {
  value: string | null
  onChange: (url: string | null) => void
  disabled?: boolean
}

const MAX_MB = 5

/**
 * Sube una foto de evidencia. En móvil, `capture="environment"` abre la cámara
 * trasera directo (el checklist de tareas se usa en el celu).
 */
export function SubirEvidencia({ value, onChange, disabled }: Props) {
  const [subiendo, setSubiendo] = useState(false)
  const [previewLocal, setPreviewLocal] = useState<string | null>(null)
  const refInput = useRef<HTMLInputElement>(null)

  async function manejar(file: File | null) {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error('Tiene que ser una imagen.')
      return
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      toast.error(`La foto supera los ${MAX_MB} MB.`)
      return
    }
    setPreviewLocal(URL.createObjectURL(file))
    setSubiendo(true)
    try {
      const url = await subirEvidencia(file)
      onChange(url)
    } catch (e) {
      setPreviewLocal(null)
      toast.error(`No se pudo subir: ${e instanceof Error ? e.message : 'error'}`)
    } finally {
      setSubiendo(false)
    }
  }

  const src = previewLocal ?? value

  return (
    <div className="flex items-center gap-3">
      <div className="h-20 w-20 shrink-0 rounded-xl border border-[#e4c9b0] bg-[#fdfaf6] overflow-hidden flex items-center justify-center">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="Evidencia" className="h-full w-full object-cover" />
        ) : (
          <ImagePlus className="h-6 w-6 text-[#c8a58a]" />
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <input
          ref={refInput}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => manejar(e.target.files?.[0] ?? null)}
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
            <Camera className="h-3.5 w-3.5" />
          )}
          {src ? 'Cambiar foto' : 'Sacar foto'}
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
  )
}
