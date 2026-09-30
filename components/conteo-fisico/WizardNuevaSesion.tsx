'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
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
import { useAbrirSesionConteo } from '@/lib/hooks/useConteoFisico'
import { aTareasNuevas, type TareaBorrador } from '@/lib/conteo/tareas'
import { ConstructorTareas } from './ConstructorTareas'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
}

/**
 * Sesión nueva: nombre → tareas (por área, proveedor, clase ABC, categoría,
 * marca, alertas o combinadas) con quién cuenta cada una → confirmar y abrir.
 */
export function WizardNuevaSesion({ abierto, onCambioAbierto }: Props) {
  const [nombre, setNombre] = useState('')
  const [umbral, setUmbral] = useState('5000')
  const [notas, setNotas] = useState('')
  const [tareas, setTareas] = useState<TareaBorrador[]>([])
  const [tareasValidas, setTareasValidas] = useState(false)

  const abrir = useAbrirSesionConteo()

  function confirmar() {
    const nombreLimpio = nombre.trim()
    if (!nombreLimpio) {
      toast.error('Poné un nombre a la sesión (ej. "Inventario Julio 2026").')
      return
    }
    if (tareas.length === 0) {
      toast.error('Armá al menos una tarea: qué se cuenta y quién lo cuenta.')
      return
    }
    const umbralNumero = Number(umbral)
    abrir.mutate(
      {
        nombre: nombreLimpio,
        umbral: Number.isFinite(umbralNumero) && umbralNumero > 0 ? umbralNumero : 5000,
        zonas: aTareasNuevas(tareas),
        notas: notas.trim() === '' ? null : notas.trim(),
      },
      {
        onSuccess: () => {
          onCambioAbierto(false)
          setNombre('')
          setNotas('')
          setTareas([])
        },
      }
    )
  }

  return (
    <Dialog
      open={abierto}
      onOpenChange={(v) => !abrir.isPending && onCambioAbierto(v)}
    >
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-[#391511]">
            Nueva sesión de conteo
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            Al abrirla se toma la foto del stock teórico de todos los
            productos. Se puede contar con el local vendiendo: las ventas se
            compensan solas. Lo que no entre en ninguna tarea no se toca.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="conteo-nombre" className="text-[#391511]">
              Nombre de la sesión
            </Label>
            <Input
              id="conteo-nombre"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder='Ej: "Inventario Julio 2026"'
              className="border-[#e4c9b0]"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-[#391511]">Tareas de conteo</Label>
            {/* Se monta recién con el diálogo abierto: la vista previa
                consulta la base y no tiene sentido pedirla con esto cerrado. */}
            {abierto && (
              <ConstructorTareas
                borradores={tareas}
                onCambio={setTareas}
                onValidez={setTareasValidas}
              />
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="conteo-umbral" className="text-[#391511]">
                Umbral de diferencia relevante ($)
              </Label>
              <Input
                id="conteo-umbral"
                type="number"
                min="0"
                inputMode="numeric"
                value={umbral}
                onChange={(e) => setUmbral(e.target.value)}
                className="border-[#e4c9b0]"
              />
              <p className="text-xs text-[#6f3a2a]">
                Se marca para revisar si la diferencia supera el 5% del teórico
                o este monto a costo.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="conteo-notas" className="text-[#391511]">
                Notas (opcional)
              </Label>
              <Input
                id="conteo-notas"
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
                placeholder="Visible para el equipo"
                className="border-[#e4c9b0]"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onCambioAbierto(false)}
            disabled={abrir.isPending}
            className="border-[#e4c9b0] text-[#6f3a2a]"
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={confirmar}
            disabled={abrir.isPending || !tareasValidas}
            className="bg-[#f9b44c] font-semibold text-[#391511] hover:bg-[#e4a42a]"
          >
            {abrir.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Confirmar y abrir
            {tareas.length > 0 && ` (${tareas.length})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
