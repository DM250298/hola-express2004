'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useAgregarTareasConteo } from '@/lib/hooks/useConteoFisico'
import { aTareasNuevas, type TareaBorrador } from '@/lib/conteo/tareas'
import { ConstructorTareas } from './ConstructorTareas'

interface Props {
  sesionId: number
  sesionNombre: string
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
}

/**
 * Sumar tareas a la sesión abierta: mandar a contar otra cosa sin cerrar el
 * conteo en curso. Lo que ya es de otra tarea (o ya se contó) no entra.
 */
export function DialogoAgregarTareas({
  sesionId,
  sesionNombre,
  abierto,
  onCambioAbierto,
}: Props) {
  const [tareas, setTareas] = useState<TareaBorrador[]>([])
  const [validas, setValidas] = useState(false)
  const agregar = useAgregarTareasConteo()

  function confirmar() {
    if (tareas.length === 0) return
    agregar.mutate(
      { sesion_id: sesionId, zonas: aTareasNuevas(tareas) },
      {
        onSuccess: () => {
          setTareas([])
          onCambioAbierto(false)
        },
      }
    )
  }

  return (
    <Dialog
      open={abierto}
      onOpenChange={(v) => !agregar.isPending && onCambioAbierto(v)}
    >
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-[#391511]">Agregar tareas</DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            Se suman a “{sesionNombre}”. Los productos que ya son de otra tarea
            de esta sesión, o que ya se contaron, no vuelven a entrar.
          </DialogDescription>
        </DialogHeader>

        {abierto && (
          <ConstructorTareas
            borradores={tareas}
            onCambio={setTareas}
            onValidez={setValidas}
          />
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onCambioAbierto(false)}
            disabled={agregar.isPending}
            className="border-[#e4c9b0] text-[#6f3a2a]"
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={confirmar}
            disabled={agregar.isPending || !validas}
            className="bg-[#f9b44c] font-semibold text-[#391511] hover:bg-[#e4a42a]"
          >
            {agregar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Mandar a contar
            {tareas.length > 0 && ` (${tareas.length})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
