'use client'

import { useEffect, useState } from 'react'
import { CalendarCheck, Clock, Loader2, User, UserCheck, Users } from 'lucide-react'
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
import { MultiSelectEmpleados } from './MultiSelectEmpleados'
import { ORDEN_ROL_OPERATIVO, ROLES_OPERATIVOS, nombreCompleto } from './constantes'
import {
  ALCANCE_TAREA,
  DIAS_SEMANA,
  PRIORIDAD_TAREA,
  TIPO_ACTIVIDAD,
  TIPO_RECURRENCIA,
} from './tareasConstantes'
import { horaDeMinutos, minutosDeHora } from './tareasAgenda'
import { NOMBRE_TURNO, hoyAr } from './asistenciaConstantes'
import { useEmpleados } from '@/lib/hooks/useRrhh'
import { useTurnos } from '@/lib/hooks/useAsistencia'
import { useGuardarPlantilla } from '@/lib/hooks/useTareas'
import { cn } from '@/lib/utils'
import type { DatosRutina, PlantillaConAsignados } from '@/lib/queries/tareas'
import type {
  AlcanceTarea,
  AplicaDesde,
  ModoTarea,
  PrioridadTarea,
  RolOperativo,
  TipoActividadTarea,
  TipoRecurrenciaTarea,
} from '@/types/database'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  plantilla: PlantillaConAsignados | null
  /** Turno preseleccionado al crear (desde Configurar rutina). */
  turnoDefault?: number | null
  /** Administrador de tareas: puede cambiar recurrencia y vigencia. */
  esAdmin?: boolean
}

type ModoHora = 'fija' | 'desde_inicio' | 'sin_hora'

const claseInput = 'border-[#e4c9b0] focus-visible:ring-[#f9b44c]'
const ITEMS_PRIORIDAD: Record<string, string> = { baja: 'Baja', media: 'Media', alta: 'Alta' }

export function ModalPlantilla({
  abierto,
  onCambioAbierto,
  plantilla,
  turnoDefault,
  esAdmin = false,
}: Props) {
  const editando = !!plantilla
  const { data: empleados } = useEmpleados()
  const { data: turnos } = useTurnos()
  const guardarRutina = useGuardarPlantilla()
  // Desde cuándo rige: mañana por defecto (hoy sigue la versión de antes).
  const [aplicar, setAplicar] = useState<AplicaDesde>('manana')

  const [titulo, setTitulo] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [alcance, setAlcance] = useState<AlcanceTarea>('puesto')
  const [roles, setRoles] = useState<RolOperativo[]>([])
  const [asignados, setAsignados] = useState<number[]>([])
  const [modo, setModo] = useState<ModoTarea>('individual')
  const [turnoId, setTurnoId] = useState('')
  const [tipoRecurrencia, setTipoRecurrencia] = useState<TipoRecurrenciaTarea>('dias_semana')
  const [dias, setDias] = useState<number[]>([])
  const [diaMes, setDiaMes] = useState('')
  const [cadaN, setCadaN] = useState('')
  const [fechaBase, setFechaBase] = useState('')
  const [vigenciaDesde, setVigenciaDesde] = useState('')
  const [vigenciaHasta, setVigenciaHasta] = useState('')
  const [prioridad, setPrioridad] = useState<PrioridadTarea>('media')
  const [requiereEvidencia, setRequiereEvidencia] = useState(false)
  // Horario (mig 251)
  const [modoHora, setModoHora] = useState<ModoHora>('sin_hora')
  const [hora, setHora] = useState('')
  const [minutosDesde, setMinutosDesde] = useState('')
  const [duracion, setDuracion] = useState('')
  const [tipoActividad, setTipoActividad] = useState<TipoActividadTarea>('puntual')
  const [checklist, setChecklist] = useState('')

  useEffect(() => {
    if (abierto) {
      setModoHora(
        plantilla?.hora ? 'fija' : plantilla?.minutos_desde_inicio != null ? 'desde_inicio' : 'sin_hora'
      )
      setHora(plantilla?.hora ? plantilla.hora.slice(0, 5) : '')
      setMinutosDesde(
        plantilla?.minutos_desde_inicio != null ? String(plantilla.minutos_desde_inicio) : ''
      )
      setDuracion(plantilla?.duracion_min ? String(plantilla.duracion_min) : '')
      setTipoActividad(plantilla?.tipo_actividad ?? 'puntual')
      setChecklist((plantilla?.checklist ?? []).join('\n'))
      setTitulo(plantilla?.titulo ?? '')
      setDescripcion(plantilla?.descripcion ?? '')
      setAlcance(plantilla?.alcance ?? 'puesto')
      setRoles(plantilla?.roles_puesto ?? [])
      setAsignados(
        plantilla?.tareas_recurrentes_asignados?.map((a) => a.empleado_id) ??
          (plantilla?.empleado_id ? [plantilla.empleado_id] : [])
      )
      setModo(plantilla?.modo ?? 'individual')
      setTurnoId(
        plantilla?.turno_id
          ? String(plantilla.turno_id)
          : turnoDefault
            ? String(turnoDefault)
            : ''
      )
      setTipoRecurrencia(plantilla?.tipo_recurrencia ?? 'dias_semana')
      setDias(plantilla?.dias_semana ?? (plantilla ? [] : [0, 1, 2, 3, 4, 5, 6]))
      setDiaMes(plantilla?.dia_mes ? String(plantilla.dia_mes) : '')
      setCadaN(plantilla?.cada_n_dias ? String(plantilla.cada_n_dias) : '')
      setFechaBase(plantilla?.fecha_base ?? hoyAr())
      setVigenciaDesde(plantilla?.vigencia_desde ?? '')
      setAplicar('manana')
      setVigenciaHasta(plantilla?.vigencia_hasta ?? '')
      setPrioridad(plantilla?.prioridad ?? 'media')
      setRequiereEvidencia(plantilla?.requiere_evidencia ?? false)
    }
  }, [abierto, plantilla, turnoDefault])

  const activos = (empleados ?? []).filter((e) => e.activo)
  const turnoSel = (turnos ?? []).find((t) => String(t.id) === turnoId) ?? null
  const minutosDesdeNum = Number(minutosDesde)
  const duracionNum = Number(duracion)
  const horaValida =
    modoHora === 'sin_hora' ||
    (modoHora === 'fija' && /^\d{2}:\d{2}$/.test(hora)) ||
    (modoHora === 'desde_inicio' && Number.isInteger(minutosDesdeNum) && minutosDesdeNum >= 0 && !!turnoSel)
  const duracionValida = duracion === '' || (Number.isInteger(duracionNum) && duracionNum > 0)
  const horaPrevia =
    modoHora === 'desde_inicio' && turnoSel && Number.isInteger(minutosDesdeNum)
      ? horaDeMinutos(minutosDeHora(turnoSel.hora_inicio) + minutosDesdeNum)
      : null
  // Asignados que quedaron inactivos: se muestran igual para poder sacarlos.
  const asignadosInactivos = (empleados ?? []).filter(
    (e) => !e.activo && asignados.includes(e.id)
  )
  const opciones = [...activos, ...asignadosInactivos].map((e) => ({
    id: e.id,
    nombre: e.activo ? nombreCompleto(e) : `${nombreCompleto(e)} (inactivo)`,
  }))
  // Toda tarea de la rutina va en un turno activo (la base lo exige).
  const itemsTurno: Record<string, string> = Object.fromEntries(
    (turnos ?? []).filter((t) => t.activo).map((t) => [String(t.id), NOMBRE_TURNO[t.nombre]])
  )

  const diaMesNum = Number(diaMes)
  const cadaNNum = Number(cadaN)
  const recurrenciaValida =
    tipoRecurrencia === 'dias_semana'
      ? dias.length > 0
      : tipoRecurrencia === 'dia_mes'
        ? Number.isInteger(diaMesNum) && diaMesNum >= 1 && diaMesNum <= 31
        : Number.isInteger(cadaNNum) && cadaNNum >= 1 && !!fechaBase

  const procesando = guardarRutina.isPending
  const puedeGuardar =
    titulo.trim().length > 0 &&
    !!turnoSel &&
    (alcance === 'todos' ||
      (alcance === 'puesto' ? roles.length > 0 : asignados.length > 0)) &&
    recurrenciaValida &&
    horaValida &&
    duracionValida &&
    !procesando

  function toggleRol(r: RolOperativo) {
    setRoles((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]))
  }

  function toggleDia(n: number) {
    setDias((prev) => (prev.includes(n) ? prev.filter((d) => d !== n) : [...prev, n]))
  }

  function guardar() {
    if (!puedeGuardar || !turnoSel) return
    const datos: DatosRutina = {
      titulo: titulo.trim(),
      descripcion: descripcion.trim() || null,
      turno_id: turnoSel.id,
      alcance,
      roles_puesto: alcance === 'puesto' ? roles : [],
      modo,
      prioridad,
      requiere_evidencia: requiereEvidencia,
      duracion_min: duracion === '' ? null : duracionNum,
      tipo_actividad: tipoActividad,
      checklist: checklist
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean),
    }
    // La base guarda siempre minutos desde el inicio del turno: la hora fija
    // se manda como `hora` y se convierte allá.
    if (modoHora === 'fija') datos.hora = hora
    else if (modoHora === 'desde_inicio') datos.minutos_desde_inicio = minutosDesdeNum
    else {
      datos.hora = null
      datos.minutos_desde_inicio = null
    }
    if (tipoRecurrencia === 'dias_semana') datos.dias_semana = [...dias].sort((a, b) => a - b)
    // Recurrencia y vigencia: solo un administrador (la base lo controla).
    if (esAdmin) {
      Object.assign(datos, {
        tipo_recurrencia: tipoRecurrencia,
        dias_semana: tipoRecurrencia === 'dias_semana' ? [...dias].sort((a, b) => a - b) : [],
        dia_mes: tipoRecurrencia === 'dia_mes' ? diaMesNum : null,
        cada_n_dias: tipoRecurrencia === 'cada_n_dias' ? cadaNNum : null,
        fecha_base: tipoRecurrencia === 'cada_n_dias' ? fechaBase : null,
        vigencia_desde: vigenciaDesde || null,
        vigencia_hasta: vigenciaHasta || null,
      })
    }
    // Con 'puesto' los asignados fijos se conservan: son el último recurso
    // cuando el cronograma del día está vacío (mig 249).
    const listaAsignados = alcance === 'todos' ? [] : asignados
    guardarRutina.mutate(
      { id: plantilla?.id ?? null, datos, asignados: listaAsignados, aplicar },
      { onSuccess: () => onCambioAbierto(false) }
    )
  }

  return (
    <Dialog open={abierto} onOpenChange={(v) => !procesando && onCambioAbierto(v)}>
      <DialogContent className="sm:max-w-lg p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <DialogTitle className="text-[#391511] text-lg">
            {editando ? 'Tarea recurrente' : 'Nueva tarea recurrente'}
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            Se genera sola según la frecuencia elegida, con su hora dentro del turno.
            {editando &&
              ' Los cambios rigen desde mañana (o desde hoy, si lo elegís) y nunca pisan lo que alguien editó a mano.'}
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

          {/* Quién la hace */}
          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">Quién la hace</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setAlcance('puesto')}
                disabled={procesando}
                className={cn(
                  'rounded-xl border px-3 py-2.5 text-left transition-colors',
                  alcance === 'puesto'
                    ? 'border-[#f9b44c] bg-[#f9b44c]/15'
                    : 'border-[#e4c9b0]/60 bg-[#fdfaf6]'
                )}
              >
                <span className="flex items-center gap-1.5 text-sm font-semibold text-[#391511]">
                  <CalendarCheck className="h-3.5 w-3.5" /> Por puesto
                </span>
                <span className="block text-[11px] text-[#6f3a2a] mt-0.5">
                  Según quién esté en el cronograma del día.
                </span>
              </button>
              <button
                type="button"
                onClick={() => alcance === 'puesto' && setAlcance('empleados')}
                disabled={procesando}
                className={cn(
                  'rounded-xl border px-3 py-2.5 text-left transition-colors',
                  alcance !== 'puesto'
                    ? 'border-[#f9b44c] bg-[#f9b44c]/15'
                    : 'border-[#e4c9b0]/60 bg-[#fdfaf6]'
                )}
              >
                <span className="flex items-center gap-1.5 text-sm font-semibold text-[#391511]">
                  <UserCheck className="h-3.5 w-3.5" /> Personas fijas
                </span>
                <span className="block text-[11px] text-[#6f3a2a] mt-0.5">
                  Siempre las mismas personas (o todos).
                </span>
              </button>
            </div>
            <p className="text-[11px] text-[#c8a58a]">{ALCANCE_TAREA[alcance].ayuda}</p>
          </div>

          {alcance === 'puesto' ? (
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">Puesto(s)</Label>
              <div className="flex flex-wrap gap-1.5">
                {ORDEN_ROL_OPERATIVO.map((r) => {
                  const activo = roles.includes(r)
                  return (
                    <button
                      key={r}
                      type="button"
                      onClick={() => toggleRol(r)}
                      disabled={procesando}
                      className={cn(
                        'rounded-full border px-3 py-1 text-xs font-semibold transition-colors',
                        activo
                          ? 'bg-[#f9b44c] border-[#f9b44c] text-[#391511]'
                          : 'bg-[#fdfaf6] border-[#e4c9b0] text-[#6f3a2a]'
                      )}
                    >
                      {ROLES_OPERATIVOS[r]}
                    </button>
                  )
                })}
              </div>
              {roles.length === 0 ? (
                <p className="text-[11px] text-[#c43e2c]">Elegí al menos un puesto.</p>
              ) : null}
            </div>
          ) : (
            <MultiSelectEmpleados
              opciones={opciones}
              seleccionados={asignados}
              onCambio={setAsignados}
              todos={alcance === 'todos'}
              onCambioTodos={(v) => setAlcance(v ? 'todos' : 'empleados')}
              disabled={procesando}
            />
          )}

          {/* Modo de cumplimiento */}
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
                  Se genera una tarea por empleado.
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
                  La hace uno cualquiera y se cierra para todos.
                </span>
              </button>
            </div>
          </div>

          {/* Recurrencia */}
          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">Se repite</Label>
            <Select
              items={TIPO_RECURRENCIA}
              value={tipoRecurrencia}
              onValueChange={(v) => v && setTipoRecurrencia(v as TipoRecurrenciaTarea)}
              disabled={procesando || !esAdmin}
            >
              <SelectTrigger className={`w-full ${claseInput}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(TIPO_RECURRENCIA) as TipoRecurrenciaTarea[]).map((t) => (
                  <SelectItem key={t} value={t}>
                    {TIPO_RECURRENCIA[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {tipoRecurrencia === 'dias_semana' && (
              <div className="flex gap-1.5 flex-wrap pt-1">
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
            )}
            {tipoRecurrencia === 'dia_mes' && (
              <div className="pt-1 space-y-1">
                <Input
                  type="number"
                  min={1}
                  max={31}
                  value={diaMes}
                  onChange={(e) => setDiaMes(e.target.value)}
                  placeholder="Día del mes (1-31)"
                  disabled={procesando || !esAdmin}
                  className={`${claseInput} tabular-nums`}
                />
                <p className="text-[11px] text-[#c8a58a]">
                  En meses cortos cae el último día (el 31 → 30 o 28).
                </p>
              </div>
            )}
            {tipoRecurrencia === 'cada_n_dias' && (
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="space-y-1">
                  <Input
                    type="number"
                    min={1}
                    value={cadaN}
                    onChange={(e) => setCadaN(e.target.value)}
                    placeholder="Cada cuántos días"
                    disabled={procesando || !esAdmin}
                    className={`${claseInput} tabular-nums`}
                  />
                  <p className="text-[11px] text-[#c8a58a]">Ej: 15 = quincenal.</p>
                </div>
                <div className="space-y-1">
                  <Input
                    type="date"
                    value={fechaBase}
                    onChange={(e) => setFechaBase(e.target.value)}
                    disabled={procesando || !esAdmin}
                    className={`${claseInput} tabular-nums`}
                  />
                  <p className="text-[11px] text-[#c8a58a]">Arranca desde esta fecha.</p>
                </div>
              </div>
            )}
          </div>

          {/* Vigencia */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">
                Vigente desde
              </Label>
              <Input
                type="date"
                value={vigenciaDesde}
                onChange={(e) => setVigenciaDesde(e.target.value)}
                disabled={procesando || !esAdmin}
                className={`${claseInput} tabular-nums`}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">Hasta (opcional)</Label>
              <Input
                type="date"
                value={vigenciaHasta}
                onChange={(e) => setVigenciaHasta(e.target.value)}
                disabled={procesando || !esAdmin}
                className={`${claseInput} tabular-nums`}
              />
            </div>
          </div>
          {!esAdmin && (
            <p className="text-[11px] text-[#c8a58a] -mt-2">
              La repetición mensual o cada N días y la vigencia las cambia un administrador.
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">Turno</Label>
              <Select
                items={itemsTurno}
                value={turnoId}
                onValueChange={(v) => setTurnoId(v ?? '')}
                disabled={procesando}
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
            <div className="flex items-center gap-1.5">
              <Clock className="h-4 w-4 text-[#6f3a2a]" />
              <Label className="text-[#391511] font-medium text-sm">Horario y duración</Label>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[#6f3a2a] text-xs">Tipo de actividad</Label>
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
              <p className="text-[11px] text-[#c8a58a]">{TIPO_ACTIVIDAD[tipoActividad].ayuda}</p>
            </div>

            {tipoActividad !== 'continua' && (
              <>
                <div className="space-y-1.5">
                  <Label className="text-[#6f3a2a] text-xs">Cuándo empieza</Label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(
                      [
                        ['fija', 'Hora fija'],
                        ['desde_inicio', 'Desde el inicio del turno'],
                        ['sin_hora', 'Durante el turno'],
                      ] as [ModoHora, string][]
                    ).map(([k, l]) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setModoHora(k)}
                        disabled={procesando || (k === 'desde_inicio' && !turnoSel)}
                        aria-pressed={modoHora === k}
                        className={cn(
                          'rounded-lg border px-2 py-1.5 text-xs font-semibold transition-colors disabled:opacity-40',
                          modoHora === k
                            ? 'bg-[#f9b44c] border-[#f9b44c] text-[#391511]'
                            : 'bg-[#fdfaf6] border-[#e4c9b0] text-[#6f3a2a]'
                        )}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                  {modoHora === 'fija' && (
                    <Input
                      type="time"
                      value={hora}
                      onChange={(e) => setHora(e.target.value)}
                      disabled={procesando}
                      className={`${claseInput} tabular-nums`}
                    />
                  )}
                  {modoHora === 'desde_inicio' && (
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={0}
                        value={minutosDesde}
                        onChange={(e) => setMinutosDesde(e.target.value)}
                        placeholder="Minutos"
                        disabled={procesando}
                        className={`${claseInput} tabular-nums w-28`}
                      />
                      <span className="text-xs text-[#6f3a2a]">
                        min después de las {turnoSel?.hora_inicio.slice(0, 5)}
                        {horaPrevia && ` → ${horaPrevia}`}. Si cambia el turno, se mueve sola.
                      </span>
                    </div>
                  )}
                  {modoHora === 'sin_hora' && (
                    <p className="text-[11px] text-[#c8a58a]">
                      Va al final de la agenda del turno, como “durante el turno”.
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-1 gap-3">
                  <div className="space-y-1">
                    <Label className="text-[#6f3a2a] text-xs">Duración estimada (min)</Label>
                    <Input
                      type="number"
                      min={1}
                      value={duracion}
                      onChange={(e) => setDuracion(e.target.value)}
                      placeholder="Ej: 20"
                      disabled={procesando}
                      className={`${claseInput} tabular-nums`}
                    />
                  </div>
                  <p className="text-[11px] text-[#c8a58a]">
                    Tiene que terminar dentro del turno. Pasado el horario figura “Atrasada”.
                  </p>
                </div>
              </>
            )}

            <div className="space-y-1">
              <Label className="text-[#6f3a2a] text-xs">Checklist / instrucciones (una por línea, opcional)</Label>
              <textarea
                value={checklist}
                onChange={(e) => setChecklist(e.target.value)}
                rows={3}
                disabled={procesando}
                placeholder={'Revisar heladera 1\nRevisar heladera 2'}
                className="w-full rounded-lg border border-[#e4c9b0] bg-white px-3 py-2 text-sm text-[#391511] placeholder:text-[#c8a58a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f9b44c]"
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-[#e4c9b0]/60 px-3 py-2.5">
            <span className="text-[#391511] text-sm font-medium">Pide foto de evidencia</span>
            <Switch
              checked={requiereEvidencia}
              onCheckedChange={setRequiereEvidencia}
              disabled={procesando}
            />
          </div>
          {editando && plantilla && !plantilla.activa && (
            <p className="rounded-xl border border-[#c43e2c]/30 bg-[#c43e2c]/5 px-3 py-2 text-xs text-[#c43e2c]">
              Esta tarea está fuera de la rutina. Para volver a ponerla, usá “Volver a la rutina” en la lista.
            </p>
          )}

          {/* Desde cuándo rige */}
          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">
              {editando ? '¿Desde cuándo rigen los cambios?' : '¿Desde cuándo se hace?'}
            </Label>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ['manana', 'Desde mañana', 'La agenda de hoy no cambia.'],
                  ['hoy', 'Desde hoy', 'Solo en lo que nadie empezó ni editó a mano.'],
                ] as [AplicaDesde, string, string][]
              ).map(([k, l, ayuda]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setAplicar(k)}
                  disabled={procesando}
                  aria-pressed={aplicar === k}
                  className={cn(
                    'rounded-xl border px-3 py-2 text-left transition-colors',
                    aplicar === k ? 'border-[#f9b44c] bg-[#f9b44c]/15' : 'border-[#e4c9b0]/60 bg-[#fdfaf6]'
                  )}
                >
                  <span className="block text-sm font-semibold text-[#391511]">{l}</span>
                  <span className="block text-[11px] text-[#6f3a2a] mt-0.5">{ayuda}</span>
                </button>
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
