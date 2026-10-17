'use client'

import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import {
  AlertTriangle,
  ArrowRightToLine,
  CheckCircle2,
  Loader2,
  Play,
  RotateCcw,
  Trash2,
  Undo2,
  User,
  Users,
} from 'lucide-react'
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
import { ModalIncidencia } from './ModalIncidencia'
import { nombreCompleto } from './constantes'
import {
  estiloEstado,
  MODO_TAREA,
  PRIORIDAD_TAREA,
  TIPO_ACTIVIDAD,
  formatoDuracion,
  formatoHora,
} from './tareasConstantes'
import { useEmpleados } from '@/lib/hooks/useRrhh'
import { useTurnos } from '@/lib/hooks/useAsistencia'
import {
  useCancelarTarea,
  useCompletarTarea,
  useCrearTareaPuntual,
  useEditarTarea,
  useIniciarTarea,
  useOmitirTarea,
  useReabrirTarea,
  useRechazarTarea,
  useTrasladarTarea,
} from '@/lib/hooks/useTareas'
import { NOMBRE_TURNO } from './asistenciaConstantes'
import { cn } from '@/lib/utils'
import type { CambiosTarea, TareaConParticipantes } from '@/lib/queries/tareas'
import type { ModoTarea, PrioridadTarea, TipoActividadTarea } from '@/types/database'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  tarea: TareaConParticipantes | null
  fechaDefault: string
  /** Puede reabrir y operar cualquier tarea (tareas_gestion). */
  esGestor?: boolean
  /** Puede registrar incidencias (permiso rrhh): muestra "Registrar impedimento". */
  puedeIncidencia?: boolean
  /** Administrador de tareas (tareas_admin): puede cancelar también las de la rutina. */
  esAdmin?: boolean
}

const claseInput = 'border-[#e4c9b0] focus-visible:ring-[#f9b44c]'
const ITEMS_PRIORIDAD: Record<string, string> = {
  baja: 'Baja',
  media: 'Media',
  alta: 'Alta',
}

export function ModalTarea({
  abierto,
  onCambioAbierto,
  tarea,
  fechaDefault,
  esGestor = true,
  puedeIncidencia = false,
  esAdmin = false,
}: Props) {
  const editando = !!tarea
  const { data: empleados } = useEmpleados()
  const { data: turnos } = useTurnos()
  const crear = useCrearTareaPuntual()
  const actualizar = useEditarTarea()
  const completar = useCompletarTarea()
  const rechazar = useRechazarTarea()
  const iniciar = useIniciarTarea()
  const reabrir = useReabrirTarea()
  const omitir = useOmitirTarea()
  const trasladar = useTrasladarTarea()
  const cancelar = useCancelarTarea()

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
  // Horario (mig 251)
  const [hora, setHora] = useState('')
  const [duracion, setDuracion] = useState('')
  const [tipoActividad, setTipoActividad] = useState<TipoActividadTarea>('puntual')
  const [checklist, setChecklist] = useState('')
  // Acciones (mig 253)
  const [mostrarOmision, setMostrarOmision] = useState(false)
  const [motivoOmision, setMotivoOmision] = useState('')
  const [incidenciaAbierta, setIncidenciaAbierta] = useState(false)

  useEffect(() => {
    if (abierto) {
      setHora(tarea?.hora ? tarea.hora.slice(0, 5) : '')
      setDuracion(tarea?.duracion_min ? String(tarea.duracion_min) : '')
      setTipoActividad(tarea?.tipo_actividad ?? 'puntual')
      setChecklist((tarea?.checklist ?? []).join('\n'))
      setMostrarOmision(false)
      setMotivoOmision('')
      setIncidenciaAbierta(false)
      setTitulo(tarea?.titulo ?? '')
      setDescripcion(tarea?.descripcion ?? '')
      setSeleccionados([])
      setTodos(false)
      setModo(tarea?.modo ?? 'individual')
      setEmpleadoId(tarea?.empleado_id ? String(tarea.empleado_id) : '')
      setTurnoId(tarea?.turno_id ? String(tarea.turno_id) : tarea ? '__ninguno__' : '')
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
  // Toda tarea nueva va en un turno (la base valida que el horario quede adentro).
  const itemsTurno: Record<string, string> = {
    ...(editando && !tarea?.turno_id ? { __ninguno__: 'Sin turno' } : {}),
    ...Object.fromEntries(
      (turnos ?? [])
        .filter((t) => t.activo || t.id === tarea?.turno_id)
        .map((t) => [String(t.id), NOMBRE_TURNO[t.nombre]])
    ),
  }
  const nombrePorId = new Map<number, string>(
    (empleados ?? []).map((e) => [e.id, nombreCompleto(e)])
  )

  const esGrupal = editando ? tarea?.empleado_id === null : modo === 'grupal'
  const procesando = crear.isPending || actualizar.isPending
  const duracionNum = Number(duracion)
  const horarioValido =
    (hora === '' || /^\d{2}:\d{2}$/.test(hora)) &&
    (duracion === '' || (Number.isInteger(duracionNum) && duracionNum > 0))
  const completada = tarea?.estado === 'completada'
  const cancelada = tarea?.estado === 'cancelada'
  const noSePudo = tarea?.estado === 'no_se_pudo'
  const abierta = !!tarea && !completada && !cancelada && !noSePudo
  // Solo se editan las abiertas; las nuevas necesitan turno.
  const puedeGuardar =
    titulo.trim().length > 0 &&
    !procesando &&
    horarioValido &&
    (editando
      ? abierta && (esGrupal || !!empleadoId)
      : turnoId !== '' && turnoId !== '__ninguno__' && (todos || seleccionados.length > 0))
  // Cancelar reemplaza a "Eliminar": las de la rutina solo un administrador.
  const puedeCancelar = abierta && esGestor && (!tarea?.plantilla_id || esAdmin)
  const ocupado =
    iniciar.isPending || omitir.isPending || trasladar.isPending || reabrir.isPending

  function guardar() {
    if (!puedeGuardar) return
    const lista = checklist
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    const duracionMin = duracion === '' ? null : duracionNum
    if (editando && tarea) {
      // Solo viaja lo que cambió: la base lo registra con antes y después.
      const cambios: CambiosTarea = {}
      if (titulo.trim() !== tarea.titulo) cambios.titulo = titulo.trim()
      if ((descripcion.trim() || null) !== tarea.descripcion) cambios.descripcion = descripcion.trim() || null
      if ((hora || null) !== (tarea.hora ? tarea.hora.slice(0, 5) : null)) cambios.hora = hora || null
      if (duracionMin !== tarea.duracion_min) cambios.duracion_min = duracionMin
      if (prioridad !== tarea.prioridad) cambios.prioridad = prioridad
      if (requiereEvidencia !== tarea.requiere_evidencia) cambios.requiere_evidencia = requiereEvidencia
      if (tipoActividad !== tarea.tipo_actividad) cambios.tipo_actividad = tipoActividad
      if (lista.join('\n') !== (tarea.checklist ?? []).join('\n')) cambios.checklist = lista
      // Cambiar a mano el responsable la deja "asignada a mano": solo pasa a
      // otro si esa persona tiene franco o licencia según el cronograma.
      const nuevoResponsable =
        !esGrupal && Number(empleadoId) !== tarea.empleado_id ? [Number(empleadoId)] : null
      if (Object.keys(cambios).length === 0 && !nuevoResponsable) {
        onCambioAbierto(false)
        return
      }
      actualizar.mutate(
        { id: tarea.id, cambios, asignados: nuevoResponsable },
        { onSuccess: () => onCambioAbierto(false) }
      )
    } else {
      crear.mutate(
        {
          fecha,
          turnoId: Number(turnoId),
          titulo: titulo.trim(),
          descripcion: descripcion.trim() || null,
          hora: hora || null,
          duracionMin,
          empleadoIds: todos ? activos.map((e) => e.id) : seleccionados,
          modo,
          prioridad,
          requiereEvidencia,
          checklist: lista,
          tipoActividad,
        },
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
              <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full', estiloEstado(tarea.estado).clase)}>
                {estiloEstado(tarea.estado).label}
              </span>
            )}
            {tarea && tarea.empleado_id === null && (
              <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full', MODO_TAREA.grupal.clase)}>
                Grupal
              </span>
            )}
            {tarea?.hora && (
              <span className="text-xs font-normal text-[#6f3a2a] tabular-nums">
                {formatoHora(tarea.hora)}
                {tarea.duracion_min ? ` · ${formatoDuracion(tarea.duracion_min)}` : ''}
              </span>
            )}
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            {editando
              ? tarea?.asignacion_manual
                ? 'Asignada a mano: solo pasa a otra persona si tiene franco o licencia según el cronograma.'
                : tarea?.plantilla_id && !esGrupal
                  ? 'Si cambiás el responsable, queda asignada a mano (con franco o licencia pasa a quien cubre).'
                  : 'Los cambios quedan registrados con quién los hizo.'
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
                disabled={procesando || editando}
                className={`${claseInput} tabular-nums`}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">Turno</Label>
              <Select
                items={itemsTurno}
                value={turnoId}
                onValueChange={(v) => setTurnoId(v ?? '')}
                disabled={procesando || editando}
              >
                <SelectTrigger className={`w-full ${claseInput}`}>
                  <SelectValue placeholder="Elegí turno" />
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

          {/* Horario dentro del turno (mig 251) */}
          <div className="rounded-xl border border-[#e4c9b0]/60 p-3 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-[#6f3a2a] text-xs">Hora</Label>
                <Input
                  type="time"
                  value={hora}
                  onChange={(e) => setHora(e.target.value)}
                  disabled={procesando}
                  className={`${claseInput} tabular-nums`}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[#6f3a2a] text-xs">Duración (min)</Label>
                <Input
                  type="number"
                  min={1}
                  value={duracion}
                  onChange={(e) => setDuracion(e.target.value)}
                  placeholder="20"
                  disabled={procesando}
                  className={`${claseInput} tabular-nums`}
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {(Object.keys(TIPO_ACTIVIDAD) as TipoActividadTarea[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setTipoActividad(k)}
                  disabled={procesando}
                  aria-pressed={tipoActividad === k}
                  className={cn(
                    'rounded-lg border px-2 py-1.5 text-xs font-semibold transition-colors',
                    tipoActividad === k
                      ? 'bg-[#f9b44c] border-[#f9b44c] text-[#391511]'
                      : 'bg-[#fdfaf6] border-[#e4c9b0] text-[#6f3a2a]'
                  )}
                >
                  {TIPO_ACTIVIDAD[k].label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-[#c8a58a]">
              Sin hora vale para todo el turno. La hora y el fin tienen que quedar dentro del
              turno; pasado el horario figura “Atrasada”.
            </p>
            <textarea
              value={checklist}
              onChange={(e) => setChecklist(e.target.value)}
              rows={2}
              disabled={procesando}
              placeholder="Checklist, una línea por ítem (opcional)"
              className="w-full rounded-lg border border-[#e4c9b0] bg-white px-3 py-2 text-sm text-[#391511] placeholder:text-[#c8a58a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f9b44c]"
            />
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

          {/* Trazabilidad: quién la inició, de dónde viene, a dónde fue */}
          {tarea && (tarea.iniciada_at || tarea.trasladada_de || tarea.trasladada_a || tarea.motivo_omision) && (
            <div className="rounded-xl bg-[#fdfaf6] border border-[#e4c9b0]/60 px-3 py-2 text-xs text-[#6f3a2a] space-y-0.5">
              {tarea.iniciada_at && (
                <p>
                  Iniciada por {tarea.iniciada_por != null ? nombrePorId.get(tarea.iniciada_por) ?? '—' : '—'}
                  {' · '}
                  {format(new Date(tarea.iniciada_at), "d 'de' MMM HH:mm", { locale: es })}
                </p>
              )}
              {tarea.trasladada_de && <p>↩ Viene del turno anterior{tarea.notas ? ` (${tarea.notas})` : ''}.</p>}
              {tarea.trasladada_a && <p>→ Trasladada al turno siguiente.</p>}
              {tarea.motivo_omision && !tarea.trasladada_a && <p>Omitida: “{tarea.motivo_omision}”.</p>}
            </div>
          )}

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
          {editando && !completada && !cancelada && !noSePudo && (
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
              <div className="grid grid-cols-2 gap-2">
                {tarea && tarea.estado !== 'en_curso' && (
                  <Button
                    variant="outline"
                    onClick={() => iniciar.mutate(tarea.id)}
                    disabled={ocupado}
                    className="border-[#e4c9b0] text-[#391511] text-xs h-8 gap-1"
                  >
                    <Play className="h-3.5 w-3.5" /> Iniciar
                  </Button>
                )}
                {tarea && !tarea.trasladada_a && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (confirm('¿Trasladar esta tarea al turno siguiente? La actual queda registrada como trasladada.'))
                        trasladar.mutate(tarea.id, { onSuccess: () => onCambioAbierto(false) })
                    }}
                    disabled={ocupado}
                    className="border-[#e4c9b0] text-[#6f3a2a] text-xs h-8 gap-1"
                  >
                    <ArrowRightToLine className="h-3.5 w-3.5" /> Trasladar al turno siguiente
                  </Button>
                )}
                {puedeIncidencia && tarea && (
                  <Button
                    variant="outline"
                    onClick={() => setIncidenciaAbierta(true)}
                    disabled={ocupado}
                    className="border-[#e4c9b0] text-[#6f3a2a] text-xs h-8 gap-1"
                  >
                    <AlertTriangle className="h-3.5 w-3.5" /> Registrar impedimento
                  </Button>
                )}
                <Button
                  variant="ghost"
                  onClick={() => setMostrarOmision((v) => !v)}
                  disabled={ocupado}
                  className="text-[#c43e2c] hover:bg-[#c43e2c]/10 text-xs h-8"
                >
                  Omitir con motivo
                </Button>
              </div>
              {mostrarOmision && tarea && (
                <div className="rounded-xl border border-[#c43e2c]/30 bg-[#c43e2c]/5 p-3 space-y-2">
                  <Label className="text-[#391511] font-medium text-sm">
                    ¿Por qué no se hace? Queda registrado y no cuenta como incumplimiento.
                  </Label>
                  <textarea
                    value={motivoOmision}
                    onChange={(e) => setMotivoOmision(e.target.value)}
                    placeholder="Ej: No llegó la mercadería del proveedor."
                    disabled={omitir.isPending}
                    rows={2}
                    className="w-full rounded-lg border border-[#e4c9b0] bg-white px-3 py-2 text-sm text-[#391511] placeholder:text-[#c8a58a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f9b44c]"
                  />
                  <Button
                    onClick={() =>
                      omitir.mutate(
                        { id: tarea.id, motivo: motivoOmision.trim() },
                        { onSuccess: () => onCambioAbierto(false) }
                      )
                    }
                    disabled={omitir.isPending || motivoOmision.trim().length < 5}
                    className="w-full bg-[#c43e2c] hover:bg-[#a93325] text-white font-semibold text-xs h-9 disabled:opacity-50"
                  >
                    {omitir.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Omitir tarea'}
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Reabrir (solo gestión): omitida, "no se pudo" o vencida vuelve a pendiente */}
          {tarea && esGestor && (cancelada || noSePudo || tarea.estado === 'vencida') && !tarea.trasladada_a && (
            <Button
              variant="outline"
              onClick={() => reabrir.mutate(tarea.id, { onSuccess: () => onCambioAbierto(false) })}
              disabled={ocupado}
              className="w-full border-[#e4c9b0] text-[#6f3a2a] gap-1.5"
            >
              <RotateCcw className="h-4 w-4" />
              Reabrir (vuelve a pendiente)
            </Button>
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
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setMostrarRechazo(true)}
                    className="border-[#c43e2c]/40 text-[#c43e2c] hover:bg-[#c43e2c]/10 gap-1.5"
                  >
                    <Undo2 className="h-4 w-4" />
                    Rechazar
                  </Button>
                  {esGestor && (
                    <Button
                      variant="outline"
                      onClick={() => reabrir.mutate(tarea.id, { onSuccess: () => onCambioAbierto(false) })}
                      disabled={ocupado}
                      className="border-[#e4c9b0] text-[#6f3a2a] gap-1.5"
                    >
                      <RotateCcw className="h-4 w-4" />
                      Reabrir
                    </Button>
                  )}
                </div>
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
          {editando && tarea && puedeCancelar && (
            <Button
              variant="ghost"
              onClick={() => {
                if (confirm('¿Cancelar esta tarea? No se borra: queda registrada como cancelada.'))
                  cancelar.mutate({ id: tarea.id }, { onSuccess: () => onCambioAbierto(false) })
              }}
              disabled={cancelar.isPending}
              className="text-[#c43e2c] hover:bg-[#c43e2c]/10 px-3"
              aria-label="Cancelar tarea"
              title="Cancelar tarea"
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
      {puedeIncidencia && tarea && (
        <ModalIncidencia
          abierto={incidenciaAbierta}
          onCambioAbierto={setIncidenciaAbierta}
          empleadoIdFijo={tarea.empleado_id}
          prefill={{
            fecha: tarea.fecha,
            turnoId: tarea.turno_id,
            tareaTurnoId: tarea.id,
            tareaTitulo: tarea.titulo,
            descripcion: `Impedimento en la tarea “${tarea.titulo}”${tarea.hora ? ` (${formatoHora(tarea.hora)})` : ''}: `,
          }}
        />
      )}
    </Dialog>
  )
}
