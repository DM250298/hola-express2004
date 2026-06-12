'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, Loader2, Trash2 } from 'lucide-react'
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
import { SubirEvidencia } from './SubirEvidencia'
import { nombreCompleto } from './constantes'
import { ESTADO_TAREA, PRIORIDAD_TAREA } from './tareasConstantes'
import { useEmpleados } from '@/lib/hooks/useRrhh'
import { useTurnos } from '@/lib/hooks/useAsistencia'
import {
  useCambiarEstadoTarea,
  useCompletarTarea,
  useCreateTarea,
  useDeleteTarea,
  useUpdateTarea,
} from '@/lib/hooks/useTareas'
import { NOMBRE_TURNO } from './asistenciaConstantes'
import { cn } from '@/lib/utils'
import type { PrioridadTarea, TareaTurnoRow } from '@/types/database'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  tarea: TareaTurnoRow | null
  fechaDefault: string
}

const claseInput = 'border-[#e4c9b0] focus-visible:ring-[#f9b44c]'
const ITEMS_PRIORIDAD: Record<string, string> = {
  baja: 'Baja',
  media: 'Media',
  alta: 'Alta',
}

export function ModalTarea({ abierto, onCambioAbierto, tarea, fechaDefault }: Props) {
  const editando = !!tarea
  const { data: empleados } = useEmpleados()
  const { data: turnos } = useTurnos()
  const crear = useCreateTarea()
  const actualizar = useUpdateTarea()
  const completar = useCompletarTarea()
  const cambiarEstado = useCambiarEstadoTarea()
  const borrar = useDeleteTarea()

  const [titulo, setTitulo] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [empleadoId, setEmpleadoId] = useState('')
  const [turnoId, setTurnoId] = useState('__ninguno__')
  const [fecha, setFecha] = useState(fechaDefault)
  const [prioridad, setPrioridad] = useState<PrioridadTarea>('media')
  const [requiereEvidencia, setRequiereEvidencia] = useState(false)
  const [evidenciaUrl, setEvidenciaUrl] = useState<string | null>(null)

  useEffect(() => {
    if (abierto) {
      setTitulo(tarea?.titulo ?? '')
      setDescripcion(tarea?.descripcion ?? '')
      setEmpleadoId(tarea?.empleado_id ? String(tarea.empleado_id) : '')
      setTurnoId(tarea?.turno_id ? String(tarea.turno_id) : '__ninguno__')
      setFecha(tarea?.fecha ?? fechaDefault)
      setPrioridad(tarea?.prioridad ?? 'media')
      setRequiereEvidencia(tarea?.requiere_evidencia ?? false)
      setEvidenciaUrl(tarea?.evidencia_url ?? null)
    }
  }, [abierto, tarea, fechaDefault])

  const activos = (empleados ?? []).filter((e) => e.activo)
  // Si el responsable quedó inactivo, lo incluimos igual para que el Select
  // muestre su nombre (y no el id crudo) al editar.
  const asignadoInactivo = (empleados ?? []).find(
    (e) => tarea?.empleado_id === e.id && !e.activo
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
  const puedeGuardar = titulo.trim().length > 0 && !!empleadoId && !procesando
  const completada = tarea?.estado === 'completada'

  function guardar() {
    if (!puedeGuardar) return
    const datos = {
      titulo: titulo.trim(),
      descripcion: descripcion.trim() || null,
      empleado_id: Number(empleadoId),
      turno_id: turnoId === '__ninguno__' ? null : Number(turnoId),
      fecha,
      prioridad,
      requiere_evidencia: requiereEvidencia,
    }
    if (editando && tarea) {
      actualizar.mutate(
        { id: tarea.id, datos },
        { onSuccess: () => onCambioAbierto(false) }
      )
    } else {
      crear.mutate(datos, { onSuccess: () => onCambioAbierto(false) })
    }
  }

  function onCompletar() {
    if (!tarea) return
    completar.mutate(
      { id: tarea.id, evidenciaUrl },
      { onSuccess: () => onCambioAbierto(false) }
    )
  }

  return (
    <Dialog open={abierto} onOpenChange={(v) => !procesando && onCambioAbierto(v)}>
      <DialogContent className="sm:max-w-lg p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <DialogTitle className="text-[#391511] text-lg flex items-center gap-2">
            {editando ? 'Tarea' : 'Nueva tarea'}
            {tarea && (
              <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full', ESTADO_TAREA[tarea.estado].clase)}>
                {ESTADO_TAREA[tarea.estado].label}
              </span>
            )}
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            Asigná un responsable y, si hace falta, foto de evidencia.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-5 space-y-4 max-h-[64vh] overflow-y-auto">
          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">Título</Label>
            <Input
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Ej: Limpiar la cámara de frío"
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

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">Fecha</Label>
              <Input
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                disabled={procesando}
                className={`${claseInput} tabular-nums`}
              />
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
          </div>

          <div className="flex items-center justify-between rounded-xl border border-[#e4c9b0]/60 px-3 py-2.5">
            <div>
              <p className="text-[#391511] text-sm font-medium">Pide foto de evidencia</p>
              <p className="text-[#c8a58a] text-xs">No se puede completar sin foto.</p>
            </div>
            <Switch
              checked={requiereEvidencia}
              onCheckedChange={setRequiereEvidencia}
              disabled={procesando}
            />
          </div>

          {/* Completar (solo edición, si no está completada) */}
          {editando && !completada && tarea?.estado !== 'cancelada' && (
            <div className="rounded-xl bg-[#fdfaf6] border border-[#e4c9b0]/60 p-3 space-y-2">
              <p className="text-[#391511] text-sm font-semibold">Completar tarea</p>
              {/* El gate usa el valor PERSISTIDO (no el toggle sin guardar). */}
              {tarea?.requiere_evidencia && (
                <SubirEvidencia
                  value={evidenciaUrl}
                  onChange={setEvidenciaUrl}
                  disabled={completar.isPending}
                />
              )}
              <Button
                onClick={onCompletar}
                disabled={completar.isPending || (!!tarea?.requiere_evidencia && !evidenciaUrl)}
                className="w-full bg-[#2f7d4f] hover:bg-[#276b43] text-white font-semibold gap-1.5 disabled:opacity-50"
              >
                {completar.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                Marcar completada
              </Button>
              <div className="flex gap-2">
                {tarea?.estado === 'pendiente' && (
                  <Button
                    variant="outline"
                    onClick={() => cambiarEstado.mutate({ id: tarea.id, estado: 'en_curso' })}
                    disabled={cambiarEstado.isPending}
                    className="flex-1 border-[#e4c9b0] text-[#6f3a2a] text-xs h-8"
                  >
                    Marcar en curso
                  </Button>
                )}
                <Button
                  variant="ghost"
                  onClick={() => {
                    if (tarea && confirm('¿Cancelar esta tarea?'))
                      cambiarEstado.mutate(
                        { id: tarea.id, estado: 'cancelada' },
                        { onSuccess: () => onCambioAbierto(false) }
                      )
                  }}
                  disabled={cambiarEstado.isPending}
                  className="flex-1 text-[#c43e2c] hover:bg-[#c43e2c]/10 text-xs h-8"
                >
                  Cancelar tarea
                </Button>
              </div>
            </div>
          )}
          {completada && tarea?.evidencia_url && (
            <div className="rounded-xl bg-[#2f7d4f]/10 border border-[#2f7d4f]/30 p-3 flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={tarea.evidencia_url} alt="Evidencia" className="h-14 w-14 rounded-lg object-cover" />
              <p className="text-[#2f7d4f] text-sm font-medium">Completada con evidencia.</p>
            </div>
          )}
        </div>

        <div className="border-t border-[#e4c9b0]/60 bg-[#fdfaf6] px-6 py-4 flex gap-2">
          {editando && tarea && (
            <Button
              variant="ghost"
              onClick={() => {
                if (confirm('¿Eliminar esta tarea?'))
                  borrar.mutate(tarea.id, { onSuccess: () => onCambioAbierto(false) })
              }}
              className="text-[#c43e2c] hover:bg-[#c43e2c]/10 px-3"
              aria-label="Eliminar"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => onCambioAbierto(false)}
            disabled={procesando}
            className="flex-1 border-[#e4c9b0] text-[#6f3a2a]"
          >
            Cerrar
          </Button>
          <Button
            onClick={guardar}
            disabled={!puedeGuardar}
            className="flex-[2] bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-bold disabled:opacity-50"
          >
            {procesando ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : editando ? (
              'Guardar cambios'
            ) : (
              'Crear tarea'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
