'use client'

import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { CheckCircle2, Loader2, Trash2, Undo2, User, Users } from 'lucide-react'
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
import { MultiSelectEmpleados } from './MultiSelectEmpleados'
import { nombreCompleto } from './constantes'
import { ESTADO_TAREA, MODO_TAREA, PRIORIDAD_TAREA } from './tareasConstantes'
import { useEmpleados } from '@/lib/hooks/useRrhh'
import { useTurnos } from '@/lib/hooks/useAsistencia'
import {
  useCambiarEstadoTarea,
  useCompletarTarea,
  useCreateTareas,
  useDeleteTarea,
  useRechazarTarea,
  useUpdateTarea,
} from '@/lib/hooks/useTareas'
import { NOMBRE_TURNO } from './asistenciaConstantes'
import { cn } from '@/lib/utils'
import type { TareaConParticipantes } from '@/lib/queries/tareas'
import type { ModoTarea, PrioridadTarea } from '@/types/database'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  tarea: TareaConParticipantes | null
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
  const crear = useCreateTareas()
  const actualizar = useUpdateTarea()
  const completar = useCompletarTarea()
  const rechazar = useRechazarTarea()
  const cambiarEstado = useCambiarEstadoTarea()
  const borrar = useDeleteTarea()

  const [titulo, setTitulo] = useState('')
  const [descripcion, setDescripcion] = useState('')
  // Creación: multi-select + modo. Edición individual: un responsable.
  const [seleccionados, setSeleccionados] = useState<number[]>([])
  const [todos, setTodos] = useState(false)
  const [modo, setModo] = useState<ModoTarea>('individual')
  const [empleadoId, setEmpleadoId] = useState('')
  const [turnoId, setTurnoId] = useState('__ninguno__')
  const [fecha, setFecha] = useState(fechaDefault)
  const [prioridad, setPrioridad] = useState<PrioridadTarea>('media')
  const [requiereEvidencia, setRequiereEvidencia] = useState(false)
  const [evidenciaUrl, setEvidenciaUrl] = useState<string | null>(null)
  const [mostrarRechazo, setMostrarRechazo] = useState(false)
  const [motivoRechazo, setMotivoRechazo] = useState('')

  useEffect(() => {
    if (abierto) {
      setTitulo(tarea?.titulo ?? '')
      setDescripcion(tarea?.descripcion ?? '')
      setSeleccionados([])
      setTodos(false)
      setModo(tarea?.modo ?? 'individual')
      setEmpleadoId(tarea?.empleado_id ? String(tarea.empleado_id) : '')
      setTurnoId(tarea?.turno_id ? String(tarea.turno_id) : '__ninguno__')
      setFecha(tarea?.fecha ?? fechaDefault)
      setPrioridad(tarea?.prioridad ?? 'media')
      setRequiereEvidencia(tarea?.requiere_evidencia ?? false)
      setEvidenciaUrl(tarea?.evidencia_url ?? null)
      setMostrarRechazo(false)
      setMotivoRechazo('')
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
  const nombrePorId = new Map<number, string>(
    (empleados ?? []).map((e) => [e.id, nombreCompleto(e)])
  )

  const esGrupal = editando ? tarea?.empleado_id === null : modo === 'grupal'
  const procesando = crear.isPending || actualizar.isPending
  const puedeGuardar =
    titulo.trim().length > 0 &&
    !procesando &&
    (editando ? esGrupal || !!empleadoId : todos || seleccionados.length > 0)
  const completada = tarea?.estado === 'completada'

  function guardar() {
    if (!puedeGuardar) return
    const base = {
      titulo: titulo.trim(),
      descripcion: descripcion.trim() || null,
      turno_id: turnoId === '__ninguno__' ? null : Number(turnoId),
      fecha,
      prioridad,
      requiere_evidencia: requiereEvidencia,
    }
    if (editando && tarea) {
      actualizar.mutate(
        {
          id: tarea.id,
          datos: esGrupal ? base : { ...base, empleado_id: Number(empleadoId) },
        },
        { onSuccess: () => onCambioAbierto(false) }
      )
    } else {
      const empleadosDestino = todos ? activos.map((e) => e.id) : seleccionados
      crear.mutate(
        { datos: base, empleados: empleadosDestino, grupal: modo === 'grupal' },
        { onSuccess: () => onCambioAbierto(false) }
      )
    }
  }

  function onCompletar() {
    if (!tarea) return
    completar.mutate(
      { id: tarea.id, evidenciaUrl },
      { onSuccess: () => onCambioAbierto(false) }
    )
  }

  function onRechazar() {
    if (!tarea || motivoRechazo.trim().length === 0) return
    rechazar.mutate(
      { id: tarea.id, motivo: motivoRechazo.trim() },
      { onSuccess: () => onCambioAbierto(false) }
    )
  }

  const participantes = tarea?.tareas_turno_participantes ?? []

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
            {tarea && tarea.empleado_id === null && (
              <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full', MODO_TAREA.grupal.clase)}>
                Grupal
              </span>
            )}
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            {editando
              ? 'Asigná un responsable y, si hace falta, foto de evidencia.'
              : 'Elegí a quién va y cómo se cumple.'}
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

          {/* Asignación: multi al crear; responsable único / participantes al editar */}
          {!editando ? (
            <>
              <MultiSelectEmpleados
                opciones={activos.map((e) => ({ id: e.id, nombre: nombreCompleto(e) }))}
                seleccionados={seleccionados}
                onCambio={setSeleccionados}
                todos={todos}
                onCambioTodos={setTodos}
                disabled={procesando}
              />
              <div className="space-y-1.5">
                <Label className="text-[#391511] font-medium text-sm">Cómo se cumple</Label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setModo('individual')}
                    disabled={procesando}
                    className={cn(
                      'rounded-xl border px-3 py-2.5 text-left transition-colors',
                      modo === 'individual'
                        ? 'border-[#f9b44c] bg-[#f9b44c]/15'
                        : 'border-[#e4c9b0]/60 bg-[#fdfaf6]'
                    )}
                  >
                    <span className="flex items-center gap-1.5 text-sm font-semibold text-[#391511]">
                      <User className="h-3.5 w-3.5" /> Cada uno la suya
                    </span>
                    <span className="block text-[11px] text-[#6f3a2a] mt-0.5">
                      Una tarea por empleado.
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setModo('grupal')}
                    disabled={procesando}
                    className={cn(
                      'rounded-xl border px-3 py-2.5 text-left transition-colors',
                      modo === 'grupal'
                        ? 'border-[#f9b44c] bg-[#f9b44c]/15'
                        : 'border-[#e4c9b0]/60 bg-[#fdfaf6]'
                    )}
                  >
                    <span className="flex items-center gap-1.5 text-sm font-semibold text-[#391511]">
                      <Users className="h-3.5 w-3.5" /> Grupal
                    </span>
                    <span className="block text-[11px] text-[#6f3a2a] mt-0.5">
                      La hace uno y se cierra para todos.
                    </span>
                  </button>
                </div>
              </div>
            </>
          ) : esGrupal ? (
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">Participantes</Label>
              <div className="rounded-xl border border-[#e4c9b0]/60 px-3 py-2.5 text-sm text-[#6f3a2a]">
                {participantes.length === 0
                  ? 'Sin participantes registrados.'
                  : participantes
                      .map((p) => nombrePorId.get(p.empleado_id) ?? `#${p.empleado_id}`)
                      .join(', ')}
                <p className="text-[11px] text-[#c8a58a] mt-1">
                  La completa cualquiera del grupo y se cierra para todos.
                </p>
              </div>
            </div>
          ) : (
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
          )}

          <div className="grid grid-cols-3 gap-3">
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
              <Label className="text-[#391511] font-medium text-sm">Turno</Label>
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

          {/* Último rechazo (si la devolvieron) */}
          {tarea && tarea.rechazos_count > 0 && !completada && (
            <div className="rounded-xl bg-[#c43e2c]/8 border border-[#c43e2c]/25 p-3">
              <p className="text-[#c43e2c] text-sm font-semibold">
                Rechazada {tarea.rechazos_count > 1 ? `${tarea.rechazos_count} veces` : ''}
                {tarea.rechazada_at &&
                  ` · ${format(new Date(tarea.rechazada_at), "d 'de' MMM HH:mm", { locale: es })}`}
              </p>
              {tarea.motivo_rechazo && (
                <p className="text-[#6f3a2a] text-sm mt-0.5">“{tarea.motivo_rechazo}”</p>
              )}
            </div>
          )}

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

          {/* Completada: evidencia + quién + rechazo (control de la encargada) */}
          {completada && tarea && (
            <div className="space-y-2">
              <div className="rounded-xl bg-[#2f7d4f]/10 border border-[#2f7d4f]/30 p-3 flex items-center gap-3">
                {tarea.evidencia_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={tarea.evidencia_url} alt="Evidencia" className="h-14 w-14 rounded-lg object-cover" />
                )}
                <div>
                  <p className="text-[#2f7d4f] text-sm font-medium">
                    Completada
                    {tarea.completada_por != null &&
                      ` por ${nombrePorId.get(tarea.completada_por) ?? '—'}`}
                    {tarea.evidencia_url && ' con evidencia'}.
                  </p>
                  {tarea.completada_at && (
                    <p className="text-[#6f3a2a] text-xs">
                      {format(new Date(tarea.completada_at), "d 'de' MMM HH:mm", { locale: es })}
                    </p>
                  )}
                </div>
              </div>

              {!mostrarRechazo ? (
                <Button
                  variant="outline"
                  onClick={() => setMostrarRechazo(true)}
                  className="w-full border-[#c43e2c]/40 text-[#c43e2c] hover:bg-[#c43e2c]/10 gap-1.5"
                >
                  <Undo2 className="h-4 w-4" />
                  Rechazar (está mal hecha)
                </Button>
              ) : (
                <div className="rounded-xl border border-[#c43e2c]/30 bg-[#c43e2c]/5 p-3 space-y-2">
                  <Label className="text-[#391511] font-medium text-sm">
                    ¿Por qué se rechaza? El empleado lo va a ver.
                  </Label>
                  <textarea
                    value={motivoRechazo}
                    onChange={(e) => setMotivoRechazo(e.target.value)}
                    placeholder="Ej: La heladera sigue con manchas, repasala."
                    disabled={rechazar.isPending}
                    rows={2}
                    className="w-full rounded-lg border border-[#e4c9b0] bg-white px-3 py-2 text-sm text-[#391511] placeholder:text-[#c8a58a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f9b44c]"
                  />
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => setMostrarRechazo(false)}
                      disabled={rechazar.isPending}
                      className="flex-1 border-[#e4c9b0] text-[#6f3a2a] text-xs h-9"
                    >
                      Volver
                    </Button>
                    <Button
                      onClick={onRechazar}
                      disabled={rechazar.isPending || motivoRechazo.trim().length === 0}
                      className="flex-[2] bg-[#c43e2c] hover:bg-[#a93325] text-white font-semibold text-xs h-9 gap-1.5 disabled:opacity-50"
                    >
                      {rechazar.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Undo2 className="h-4 w-4" />
                      )}
                      Rechazar y devolver a pendiente
                    </Button>
                  </div>
                </div>
              )}
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
