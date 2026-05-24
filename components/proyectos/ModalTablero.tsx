'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
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
import { useCreateTablero, useUpdateTablero } from '@/lib/hooks/useTableros'
import type { TableroRow } from '@/types/database'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  tablero?: TableroRow | null
}

const COLORES = [
  '#f9b44c',
  '#c43e2c',
  '#2f8f4e',
  '#3a7dc1',
  '#9b59b6',
  '#6f3a2a',
]

export function ModalTablero({ abierto, onCambioAbierto, tablero }: Props) {
  const crear = useCreateTablero()
  const actualizar = useUpdateTablero()
  const editando = !!tablero

  const [nombre, setNombre] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [color, setColor] = useState(COLORES[0])
  const [imagenUrl, setImagenUrl] = useState('')

  useEffect(() => {
    if (abierto) {
      setNombre(tablero?.nombre ?? '')
      setDescripcion(tablero?.descripcion ?? '')
      setColor(tablero?.color ?? COLORES[0])
      setImagenUrl(tablero?.imagen_url ?? '')
    }
  }, [abierto, tablero])

  const procesando = crear.isPending || actualizar.isPending
  const puedeGuardar = nombre.trim().length > 0 && !procesando

  function guardar() {
    if (!puedeGuardar) return
    const datos = {
      nombre: nombre.trim(),
      descripcion: descripcion.trim() || null,
      color,
      imagen_url: imagenUrl.trim() || null,
    }
    if (editando && tablero) {
      actualizar.mutate(
        { id: tablero.id, datos },
        { onSuccess: () => onCambioAbierto(false) }
      )
    } else {
      crear.mutate(datos, { onSuccess: () => onCambioAbierto(false) })
    }
  }

  return (
    <Dialog
      open={abierto}
      onOpenChange={(v) => !procesando && onCambioAbierto(v)}
    >
      <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <DialogTitle className="text-[#391511] text-lg">
            {editando ? 'Editar tablero' : 'Nuevo tablero'}
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            Un tablero agrupa proyectos y define quién puede acceder.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-5 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">
              Nombre
            </Label>
            <Input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej: Operaciones del local"
              disabled={procesando}
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">
              Descripción (opcional)
            </Label>
            <Input
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              placeholder="Para qué sirve este tablero…"
              disabled={procesando}
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">
              Portada (URL de imagen, opcional)
            </Label>
            <Input
              value={imagenUrl}
              onChange={(e) => setImagenUrl(e.target.value)}
              placeholder="https://…"
              disabled={procesando}
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">Color</Label>
            <div className="flex flex-wrap gap-2">
              {COLORES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className="h-8 w-8 rounded-full border-2"
                  style={{
                    backgroundColor: c,
                    borderColor: c === color ? '#391511' : 'transparent',
                  }}
                  aria-label={`Color ${c}`}
                />
              ))}
            </div>
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
            className="flex-[2] bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-bold disabled:opacity-50"
          >
            {procesando ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Guardando…
              </>
            ) : editando ? (
              'Guardar cambios'
            ) : (
              'Crear tablero'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
