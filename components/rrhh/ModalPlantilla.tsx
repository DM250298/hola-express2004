'use client'

import { useEffect, useState } from 'react'
import { Loader2, User, Users } from 'lucide-react'
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
import { nombreCompleto } from './constantes'
import { DIAS_SEMANA, PRIORIDAD_TAREA, TIPO_RECURRENCIA } from './tareasConstantes'
import { NOMBRE_TURNO, hoyAr } from './asistenciaConstantes'
import { useEmpleados } from '@/lib/hooks/useRrhh'
import { useTurnos } from '@/lib/hooks/useAsistencia'
import { useCreatePlantilla, useUpdatePlantilla } from '@/lib/hooks/useTareas'
import { cn } from '@/lib/utils'
import type { PlantillaConAsignados } from '@/lib/queries/tareas'
import type {
  ModoTarea,
  PrioridadTarea,
  TipoRecurrenciaTarea,
} from '@/types/database'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  plantilla: PlantillaConAsignados | null
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
  const [todos, setTodos] = useState(false)
  const [asignados, setAsignados] = useState<number[]>([])
  const [modo, setModo] = useState<ModoTarea>('individual')
  const [turnoId, setTurnoId] = useState('__ninguno__')
  const [tipoRecurrencia, setTipoRecurrencia] = useState<TipoRecurrenciaTarea>('dias_semana')
  const [dias, setDias] = useState<number[]>([])
  const [diaMes, setDiaMes] = useState('')
  const [cadaN, setCadaN] = useState('')
  const [fechaBase, setFechaBase] = useState('')
  const [vigenciaDesde, setVigenciaDesde] = useState('')
  const [vigenciaHasta, setVigenciaHasta] = useState('')
  const [prioridad, setPrioridad] = useState<PrioridadTarea>('media')
  const [requiereEvidencia, setRequiereEvidencia] = useState(false)
  const [activa, setActiva] = useState(true)

  useEffect(() => {
    if (abierto) {
      setTitulo(plantilla?.titulo ?? '')
      setDescripcion(plantilla?.descripcion ?? '')
      setTodos(plantilla?.alcance === 'todos')
      setAsignados(
        plantilla?.tareas_recurrentes_asignados?.map((a) => a.empleado_id) ??
          (plantilla?.empleado_id ? [plantilla.empleado_id] : [])
      )
      setModo(plantilla?.modo ?? 'individual')
      setTurnoId(plantilla?.turno_id ? String(plantilla.turno_id) : '__ninguno__')
      setTipoRecurrencia(plantilla?.tipo_recurrencia ?? 'dias_semana')
      setDias(plantilla?.dias_semana ?? [])
      setDiaMes(plantilla?.dia_mes ? String(plantilla.dia_mes) : '')
      setCadaN(plantilla?.cada_n_dias ? String(plantilla.cada_n_dias) : '')
      setFechaBase(plantilla?.fecha_base ?? hoyAr())
      setVigenciaDesde(plantilla?.vigencia_desde ?? '')
      setVigenciaHasta(plantilla?.vigencia_hasta ?? '')
      setPrioridad(plantilla?.prioridad ?? 'media')
      setRequiereEvidencia(plantilla?.requiere_evidencia ?? false)
      setActiva(plantilla?.activa ?? true)
    }
  }, [abierto, plantilla])

  const activos = (empleados ?? []).filter((e) => e.activo)
  // Asignados que quedaron inactivos: se muestran igual para poder sacarlos.
  const asignadosInactivos = (empleados ?? []).filter(
    (e) => !e.activo && asignados.includes(e.id)
  )
  const opciones = [...activos, ...asignadosInactivos].map((e) => ({
    id: e.id,
    nombre: e.activo ? nombreCompleto(e) : `${nombreCompleto(e)} (inactivo)`,
  }))
  const itemsTurno: Record<string, string> = {
    __ninguno__: 'Sin turno',
    ...Object.fromEntries((turnos ?? []).map((t) => [String(t.id), NOMBRE_TURNO[t.nombre]])),
  }

  const diaMesNum = Number(diaMes)
  const cadaNNum = Number(cadaN)
  const recurrenciaValida =
    tipoRecurrencia === 'dias_semana'
      ? dias.length > 0
      : tipoRecurrencia === 'dia_mes'
        ? Number.isInteger(diaMesNum) && diaMesNum >= 1 && diaMesNum <= 31
        : Number.isInteger(cadaNNum) && cadaNNum >= 1 && !!fechaBase

  const procesando = crear.isPending || actualizar.isPending
  const puedeGuardar =
    titulo.trim().length > 0 &&
    (todos || asignados.length > 0) &&
    recurrenciaValida &&
    !procesando

  function toggleDia(n: number) {
    setDias((prev) => (prev.includes(n) ? prev.filter((d) => d !== n) : [...prev, n]))
  }

  function guardar() {
    if (!puedeGuardar) return
    const datos = {
      titulo: titulo.trim(),
      descripcion: descripcion.trim() || null,
      empleado_id: null, // deprecado (mig 158): manda alcance + la tabla puente
      turno_id: turnoId === '__ninguno__' ? null : Number(turnoId),
      alcance: (todos ? 'todos' : 'empleados') as 'todos' | 'empleados',
      modo,
      tipo_recurrencia: tipoRecurrencia,
      dias_semana: tipoRecurrencia === 'dias_semana' ? [...dias].sort((a, b) => a - b) : [],
      dia_mes: tipoRecurrencia === 'dia_mes' ? diaMesNum : null,
      cada_n_dias: tipoRecurrencia === 'cada_n_dias' ? cadaNNum : null,
      fecha_base: tipoRecurrencia === 'cada_n_dias' ? fechaBase : null,
      vigencia_desde: vigenciaDesde || null,
      vigencia_hasta: vigenciaHasta || null,
      prioridad,
      requiere_evidencia: requiereEvidencia,
      activa,
    }
    const listaAsignados = todos ? [] : asignados
    if (editando && plantilla) {
      actualizar.mutate(
        { id: plantilla.id, datos, asignados: listaAsignados },
        { onSuccess: () => onCambioAbierto(false) }
      )
    } else {
      crear.mutate(
        { datos, asignados: listaAsignados },
        { onSuccess: () => onCambioAbierto(false) }
      )
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
            Se genera sola según la frecuencia elegida.
            {editando && ' Los cambios rigen desde mañana; las tareas de hoy no se modifican.'}
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

          <MultiSelectEmpleados
            opciones={opciones}
            seleccionados={asignados}
            onCambio={setAsignados}
            todos={todos}
            onCambioTodos={setTodos}
            disabled={procesando}
          />

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
              disabled={procesando}
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
                  disabled={procesando}
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
                    disabled={procesando}
                    className={`${claseInput} tabular-nums`}
                  />
                  <p className="text-[11px] text-[#c8a58a]">Ej: 15 = quincenal.</p>
                </div>
                <div className="space-y-1">
                  <Input
                    type="date"
                    value={fechaBase}
                    onChange={(e) => setFechaBase(e.target.value)}
                    disabled={procesando}
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
              <Label className="text-[#391511] font-medium text-sm">Vigente desde</Label>
              <Input
                type="date"
                value={vigenciaDesde}
                onChange={(e) => setVigenciaDesde(e.target.value)}
                disabled={procesando}
                className={`${claseInput} tabular-nums`}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">Hasta (opcional)</Label>
              <Input
                type="date"
                value={vigenciaHasta}
                onChange={(e) => setVigenciaHasta(e.target.value)}
                disabled={procesando}
                className={`${claseInput} tabular-nums`}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
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
