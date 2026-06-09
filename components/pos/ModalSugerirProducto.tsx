'use client'

import { useEffect, useState } from 'react'
import { Lightbulb, Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useCrearSugerencia } from '@/lib/hooks/useSugerencias'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  usuarioId: string | null
}

/**
 * Carga rápida desde el POS de un producto que un cliente pidió y no tenemos.
 * Va a la cola de sugerencias que el encargado revisa en Compras.
 */
export function ModalSugerirProducto({
  abierto,
  onCambioAbierto,
  usuarioId,
}: Props) {
  const crear = useCrearSugerencia()
  const [texto, setTexto] = useState('')
  const [nota, setNota] = useState('')

  useEffect(() => {
    if (abierto) {
      setTexto('')
      setNota('')
    }
  }, [abierto])

  function guardar() {
    if (!texto.trim() || crear.isPending) return
    crear.mutate(
      { texto, nota, usuario_id: usuarioId },
      { onSuccess: () => onCambioAbierto(false) }
    )
  }

  return (
    <Dialog
      open={abierto}
      onOpenChange={(v) => !crear.isPending && onCambioAbierto(v)}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[#391511] flex items-center gap-2">
            <Lightbulb className="h-5 w-5 text-[#f9b44c]" />
            Sugerir un producto
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            ¿Un cliente pidió algo que no tenemos? Anotalo y el encargado lo va a
            evaluar para sumarlo.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium">
              ¿Qué producto pidieron? <span className="text-[#c43e2c]">*</span>
            </Label>
            <Input
              autoFocus
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  guardar()
                }
              }}
              placeholder="Ej: Yerba Playadito 1 kg"
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium">Nota (opcional)</Label>
            <Input
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder="Marca, presentación, lo piden seguido…"
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onCambioAbierto(false)}
            disabled={crear.isPending}
            className="border-[#e4c9b0] text-[#6f3a2a]"
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={guardar}
            disabled={!texto.trim() || crear.isPending}
            className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold"
          >
            {crear.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Guardando…
              </>
            ) : (
              'Guardar sugerencia'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
