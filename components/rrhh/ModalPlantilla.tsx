'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
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
import { nombreCompleto } from './constantes'
import { DIAS_SEMANA, PRIORIDAD_TAREA } from './tareasConstantes'
import { NOMBRE_TURNO } from './asistenciaConstantes'
import { useEmpleados } from '@/lib/hooks/useRrhh'
import { useTurnos } from '@/lib/hooks/useAsistencia'
import { useCreatePlantilla, useUpdatePlantilla } from '@/lib/hooks/useTareas'
import { cn } from '@/lib/utils'
import type { PrioridadTarea, TareaRecurrenteRow } from '@/types/database'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  plantilla: TareaRecurrenteRow | null
}

const claseInput = 'border-[#e4c9b0] focus-visible:ring-[#f9b44c]'
const ITEMS_PRIORIDAD: Record<string, string> = { baja: 'Baja', media: 'Media', alta: 'Alta' }

export function ModalPlantilla({ abierto, onCambioAbierto, plantilla }: Props) {
  const editando = !!plantilla
  const { data: empleados } = useEmpleados()
  const { data: turnos } = useTurnos()
  const crear = useCreatePlantilla()
  const actualizar = useUpdatePlantilla()

  const [titulo, setTitulo] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [empleadoId, setEmpleadoId] = useState('')
  const [turnoId, setTurnoId] = useState('__ninguno__')
  const [dias, setDias] = useState<number[]>([])
  const [prioridad, setPrioridad] = useState<PrioridadTarea>('media')
  const [requiereEvidencia, setRequiereEvidencia] = useState(false)
  const [activa, setActiva] = useState(true)

  useEffect(() => {
    if (abierto) {
      setTitulo(plantilla?.titulo ?? '')
      setDescripcion(plantilla?.descripcion ?? '')
      setEmpleadoId(plantilla?.empleado_id ? String(plantilla.empleado_id) : '')
      setTurnoId(plantilla?.turno_id ? String(plantilla.turno_id) : '__ninguno__')
      setDias(plantilla?.dias_semana ?? [])
      setPrioridad(plantilla?.prioridad ?? 'media')
      setRequiereEvidencia(plantilla?.requiere_evidencia ?? false)
      setActiva(plantilla?.activa ?? true)
    }
  }, [abierto, plantilla])

  const activos = (empleados ?? []).filter((e) => e.activo)
  const asignadoInactivo = (empleados ?? []).find(
    (e) => plantilla?.empleado_id === e.id && !e.activo
  )
  const opcionesEmpleado = asignadoInactivo ? [...activos, asignadoInactivo] : activos
  const itemsEmpleado: Record<string, string> = Object.fromEntries(
    opcionesEmpleado.map((e) => [
      String(e.id),
      e.activo ? nombreCompleto(e) : `${nombreCompleto(e)} (inactivo)`,
    ])
  )
  const itemsTurno: Record<string, string> = {
    __ninguno__: 'Sin turno',
    ...Object.fromEntries((turnos ?? []).map((t) => [String(t.id), NOMBRE_TURNO[t.nombre]])),
  }

  const procesando = crear.isPending || actualizar.isPending
  const puedeGuardar =
    titulo.trim().length > 0 && !!empleadoId && dias.length > 0 && !procesando

  function toggleDia(n: number) {
    setDias((prev) => (prev.includes(n) ? prev.filter((d) => d !== n) : [...prev, n]))
  }

  function guardar() {
    if (!puedeGuardar) return
    const datos = {
      titulo: titulo.trim(),
      descripcion: descripcion.trim() || null,
      empleado_id: Number(empleadoId),
      turno_id: turnoId === '__ninguno__' ? null : Number(turnoId),
      dias_semana: [...dias].sort((a, b) => a - b),
      prioridad,
      requiere_evidencia: requiereEvidencia,
      activa,
    }
    if (editando && plantilla) {
      actualizar.mutate(
        { id: plantilla.id, datos },
        { onSuccess: () => onCambioAbierto(false) }
      )
    } else {
      crear.mutate(datos, { onSuccess: () => onCambioAbierto(false) })
    }
  }

  return (
    <Dialog open={abierto} onOpenChange={(v) => !procesando && onCambioAbierto(v)}>
      <DialogContent className="sm:max-w-lg p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <DialogTitle className="text-[#391511] text-lg">
            {editando ? 'Tarea recurrente' : 'Nueva tarea recurrente'}
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            Se genera sola cada día elegido, asignada al responsable.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-5 space-y-4 max-h-[64vh] overflow-y-auto">
          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">Título</Label>
            <Input
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Ej: Reponer góndola de bebidas"
              disabled={procesando}
              className={claseInput}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">Descripción</Label>
            <Input
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              placeholder="Opcional"
              disabled={procesando}
              className={claseInput}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">Responsable</Label>
              <Select
                items={itemsEmpleado}
                value={empleadoId}
                onValueChange={(v) => setEmpleadoId(v ?? '')}
                disabled={procesando}
              >
                <SelectTrigger className={`w-full ${claseInput}`}>
                  <SelectValue placeholder="Elegí empleado" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(itemsEmpleado).map(([v, l]) => (
                    <SelectItem key={v} value={v}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">Turno (opcional)</Label>
              <Select
                items={itemsTurno}
                value={turnoId}
                onValueChange={(v) => setTurnoId(v ?? '__ninguno__')}
                disabled={procesando}
              >
                <SelectTrigger className={`w-full ${claseInput}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(itemsTurno).map(([v, l]) => (
                    <SelectItem key={v} value={v}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">Días que se repite</Label>
            <div className="flex gap-1.5 flex-wrap">
              {DIAS_SEMANA.map((d) => (
                <button
                  key={d.n}
                  type="button"
                  onClick={() => toggleDia(d.n)}
                  disabled={procesando}
                  className={cn(
                    'h-9 w-9 rounded-lg text-sm font-bold transition-colors',
                    dias.includes(d.n)
                      ? 'bg-[#f9b44c] text-[#391511]'
                      : 'bg-[#fdfaf6] border border-[#e4c9b0] text-[#6f3a2a]'
                  )}
                >
                  {d.corto}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">Prioridad</Label>
            <Select
              items={ITEMS_PRIORIDAD}
              value={prioridad}
              onValueChange={(v) => v && setPrioridad(v as PrioridadTarea)}
              disabled={procesando}
            >
              <SelectTrigger className={`w-full ${claseInput}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(ITEMS_PRIORIDAD) as PrioridadTarea[]).map((p) => (
                  <SelectItem key={p} value={p}>
                    {PRIORIDAD_TAREA[p].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-[#e4c9b0]/60 px-3 py-2.5">
            <span className="text-[#391511] text-sm font-medium">Pide foto de evidencia</span>
            <Switch
              checked={requiereEvidencia}
              onCheckedChange={setRequiereEvidencia}
              disabled={procesando}
            />
          </div>
          {editando && (
            <div className="flex items-center justify-between rounded-xl border border-[#e4c9b0]/60 px-3 py-2.5">
              <span className="text-[#391511] text-sm font-medium">Activa</span>
              <Switch checked={activa} onCheckedChange={setActiva} disabled={procesando} />
            </div>
          )}
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
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : editando ? (
              'Guardar'
            ) : (
              'Crear recurrente'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
