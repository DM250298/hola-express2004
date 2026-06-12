'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useSubirDocumento } from '@/lib/hooks/useRrhh'
import { TIPOS_DOCUMENTO } from './constantes'
import type { TipoDocumentoEmpleado } from '@/types/database'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  empleadoId: number
}

const claseInput = 'border-[#e4c9b0] focus-visible:ring-[#f9b44c]'

export function ModalDocumento({ abierto, onCambioAbierto, empleadoId }: Props) {
  const subir = useSubirDocumento()
  const [tipo, setTipo] = useState<TipoDocumentoEmpleado>('dni')
  const [archivo, setArchivo] = useState<File | null>(null)
  const [vencimiento, setVencimiento] = useState('')
  const [notas, setNotas] = useState('')

  useEffect(() => {
    if (abierto) {
      setTipo('dni')
      setArchivo(null)
      setVencimiento('')
      setNotas('')
    }
  }, [abierto])

  const procesando = subir.isPending
  const puedeGuardar = !!archivo && !procesando

  function onElegirArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null
    if (f) {
      const tipoOk =
        f.type.startsWith('image/') || f.type === 'application/pdf'
      if (!tipoOk) {
        toast.error('El archivo debe ser una imagen o PDF.')
        e.target.value = ''
        setArchivo(null)
        return
      }
      if (f.size > 10 * 1024 * 1024) {
        toast.error('El archivo no puede superar los 10 MB.')
        e.target.value = ''
        setArchivo(null)
        return
      }
    }
    setArchivo(f)
  }

  function guardar() {
    if (!archivo) return
    subir.mutate(
      {
        empleadoId,
        tipo,
        archivo,
        fechaVencimiento: vencimiento || null,
        notas: notas.trim() || null,
      },
      { onSuccess: () => onCambioAbierto(false) }
    )
  }

  return (
    <Dialog open={abierto} onOpenChange={(v) => !procesando && onCambioAbierto(v)}>
      <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <DialogTitle className="text-[#391511] text-lg">
            Subir documento
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            Se guarda en el bucket privado de RRHH.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-5 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">Tipo</Label>
            <Select
              items={TIPOS_DOCUMENTO}
              value={tipo}
              onValueChange={(v) => v && setTipo(v as TipoDocumentoEmpleado)}
              disabled={procesando}
            >
              <SelectTrigger className={`w-full ${claseInput}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(TIPOS_DOCUMENTO).map(([v, l]) => (
                  <SelectItem key={v} value={v}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">Archivo</Label>
            <Input
              type="file"
              accept="image/*,application/pdf"
              onChange={onElegirArchivo}
              disabled={procesando}
              className={`${claseInput} file:text-[#6f3a2a]`}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">
              Fecha de vencimiento (opcional)
            </Label>
            <Input
              type="date"
              value={vencimiento}
              onChange={(e) => setVencimiento(e.target.value)}
              disabled={procesando}
              className={`${claseInput} tabular-nums`}
            />
            <p className="text-[#c8a58a] text-xs">
              Para aptos médicos y certificados que vencen.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">
              Notas (opcional)
            </Label>
            <Input
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="Observaciones…"
              disabled={procesando}
              className={claseInput}
            />
          </div>
        </div>

        <div className="border-t border-[#e4c9b0]/60 bg-[#fdfaf6] px-6 py-4 flex gap-2">
          <Button
            variant="outline"
            onClick={() => onCambioAbierto(false)}
            disabled={procesando}
            className="flex-1 border-[#e4c9b0] text-[#6f3a2a]"
          >
            Cancelar
          </Button>
          <Button
            onClick={guardar}
            disabled={!puedeGuardar}
            className="flex-[2] bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-bold disabled:opacity-50 gap-1.5"
          >
            {procesando ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Subiendo…
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" />
                Subir
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
