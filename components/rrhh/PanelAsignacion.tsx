'use client'

import { useEffect, useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { AlertTriangle, Info, Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { ESTILO_TURNO, NOMBRE_TURNO, capitalizar } from './asistenciaConstantes'
import { ROLES_OPERATIVOS, nombreCompleto } from './constantes'
import {
  armarNota,
  esTurnoPlanificado,
  etiquetaHorasCorta,
  parseNota,
  type EmpleadoCrono,
} from './cronogramaCalculos'
import { useEliminarHorario, useUpsertHorario } from '@/lib/hooks/useAsistencia'
import { cn } from '@/lib/utils'
import type { HorarioAsignadoRow, TurnoPlantillaRow } from '@/types/database'

type EstadoPlan = 'planificado' | 'franco' | 'licencia'

const ITEMS_PLAN: Record<EstadoPlan, string> = {
  planificado: 'Trabaja (turno)',
  franco: 'Franco',
  licencia: 'Licencia',
}
const NADIE = '__nadie__'
const claseInput = 'border-[#e4c9b0] focus-visible:ring-[#f9b44c]'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  empleado: EmpleadoCrono | null
  fecha: string
  hoy: string
  turnos: TurnoPlantillaRow[]
  horario?: HorarioAsignadoRow
  /** Horario del mismo empleado el día anterior (aviso "viene de noche"). */
  horarioAnterior?: HorarioAsignadoRow
  /** Resto del equipo, para "Cubre a". */
  empleados: EmpleadoCrono[]
  /** Horarios de TODOS ese día (empleado_id → fila), para avisar si el cubierto también trabaja. */
  horariosDelDia: Map<number, HorarioAsignadoRow>
}

/**
 * Editor contextual de una celda de Planificación. Solo toca el plan
 * (`horarios_asignados`); las marcaciones se corrigen desde la vista Fichadas.
 */
export function PanelAsignacion({
  abierto,
  onCambioAbierto,
  empleado,
  fecha,
  hoy,
  turnos,
  horario,
  horarioAnterior,
  empleados,
  horariosDelDia,
}: Props) {
  const upsert = useUpsertHorario()
  const borrar = useEliminarHorario()

  const [estadoPlan, setEstadoPlan] = useState<EstadoPlan>('planificado')
  const [turnoId, setTurnoId] = useState<string>('')
  const [cubreA, setCubreA] = useState<string>(NADIE)
  const [observacion, setObservacion] = useState('')
  const [confirmarQuitar, setConfirmarQuitar] = useState(false)

  const turnoPorId = useMemo(() => new Map(turnos.map((t) => [t.id, t])), [turnos])
  const otros = useMemo(
    () => empleados.filter((e) => e.id !== empleado?.id && e.activo),
    [empleados, empleado]
  )

  useEffect(() => {
    if (!abierto) return
    const est = (horario?.estado ?? 'planificado') as EstadoPlan
    setEstadoPlan(est === 'franco' || est === 'licencia' ? est : 'planificado')
    setTurnoId(horario?.turno_id ? String(horario.turno_id) : '')
    const nota = parseNota(horario?.notas)
    const cubierto = nota.cubreA
      ? otros.find((e) => nombreCompleto(e) === nota.cubreA?.nombre)
      : undefined
    setCubreA(cubierto ? String(cubierto.id) : NADIE)
    // Si la nota decía "Cubre a X" pero X no está en el equipo, conservarla como texto.
    setObservacion(
      cubierto || !nota.cubreA
        ? (nota.observacion ?? '')
        : (horario?.notas ?? '')
    )
    setConfirmarQuitar(false)
  }, [abierto, horario, otros])

  const itemsTurno: Record<string, string> = Object.fromEntries(
    turnos
      .filter((t) => t.activo || String(t.id) === turnoId)
      .map((t) => [String(t.id), `${NOMBRE_TURNO[t.nombre]} · ${etiquetaHorasCorta(t)}`])
  )
  const itemsCubre: Record<string, string> = {
    [NADIE]: 'Nadie (turno propio)',
    ...Object.fromEntries(otros.map((e) => [String(e.id), nombreCompleto(e)])),
  }

  const turnoSel = turnoId ? turnoPorId.get(Number(turnoId)) : undefined
  const cubierto = cubreA !== NADIE ? otros.find((e) => e.id === Number(cubreA)) : undefined
  const esPasado = fecha < hoy
  const guardando = upsert.isPending || borrar.isPending

  // Avisos (no bloquean): el modelo no tiene reglas de descanso configuradas.
  const avisos: { tono: 'info' | 'atencion'; texto: string }[] = []
  if (esPasado) {
    avisos.push({ tono: 'info', texto: 'Es un día pasado: al guardar se recalcula la asistencia de ese día.' })
  }
  if (cubierto) {
    const hc = horariosDelDia.get(cubierto.id)
    if (esTurnoPlanificado(hc)) {
      avisos.push({
        tono: 'atencion',
        texto: `${nombreCompleto(cubierto)} también está planificado ese día (${NOMBRE_TURNO[turnoPorId.get(hc.turno_id as number)?.nombre ?? 'manana']}).`,
      })
    }
  }
  if (estadoPlan === 'planificado' && turnoSel && !turnoSel.cruza_medianoche && esTurnoPlanificado(horarioAnterior)) {
    const ta = turnoPorId.get(horarioAnterior.turno_id as number)
    if (ta?.cruza_medianoche) {
      avisos.push({ tono: 'info', texto: `Viene del turno noche del día anterior (termina ${ta.hora_fin.slice(0, 5)}).` })
    }
  }
  const tareasAviso =
    'Al guardar, las tareas del día se actualizan según el cronograma: las pendientes sin empezar cambian de responsable; lo iniciado o completado no se toca.'

  const puedeGuardar =
    !!empleado && !guardando && (estadoPlan !== 'planificado' || !!turnoId)

  function guardar() {
    if (!empleado || !puedeGuardar) return
    const notas = armarNota(
      cubierto ? { nombre: nombreCompleto(cubierto), puesto: ROLES_OPERATIVOS[cubierto.rol_operativo] } : null,
      observacion
    )
    upsert.mutate(
      {
        empleado_id: empleado.id,
        fecha,
        estado: estadoPlan,
        turno_id: estadoPlan === 'planificado' ? Number(turnoId) : null,
        notas,
      },
      { onSuccess: () => onCambioAbierto(false) }
    )
  }

  function quitar() {
    if (!horario) return
    borrar.mutate(
      { id: horario.id, empleado_id: horario.empleado_id, fecha: horario.fecha },
      { onSuccess: () => onCambioAbierto(false) }
    )
  }

  return (
    <Sheet open={abierto} onOpenChange={(v) => !guardando && onCambioAbierto(v)}>
      <SheetContent side="right" className="sm:max-w-md w-full flex flex-col p-0">
        <SheetHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <SheetTitle className="text-[#391511] text-lg">
            {empleado ? nombreCompleto(empleado) : 'Asignación'}
          </SheetTitle>
          <SheetDescription className="text-[#6f3a2a]">
            {empleado && <span>{ROLES_OPERATIVOS[empleado.rol_operativo]} · </span>}
            {capitalizar(format(parseISO(fecha), "EEEE d 'de' MMMM yyyy", { locale: es }))}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">Estado del día</Label>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(ITEMS_PLAN) as EstadoPlan[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setEstadoPlan(k)}
                  aria-pressed={estadoPlan === k}
                  disabled={guardando}
                  className={cn(
                    'rounded-xl border-2 px-2 py-2 text-xs font-bold transition-colors',
                    estadoPlan === k
                      ? 'border-[#f9b44c] bg-[#f9b44c]/15 text-[#391511]'
                      : 'border-[#e4c9b0] bg-white text-[#6f3a2a] hover:border-[#c8a58a]'
                  )}
                >
                  {ITEMS_PLAN[k]}
                </button>
              ))}
            </div>
          </div>

          {estadoPlan === 'planificado' && (
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">Turno</Label>
              <div className="grid grid-cols-1 gap-2">
                {turnos
                  .filter((t) => t.activo || String(t.id) === turnoId)
                  .map((t) => {
                    const activo = String(t.id) === turnoId
                    const estilo = ESTILO_TURNO[t.nombre]
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setTurnoId(String(t.id))}
                        aria-pressed={activo}
                        disabled={guardando}
                        className={cn(
                          'flex items-center justify-between rounded-xl border-2 px-3 py-2 text-sm transition-colors',
                          activo ? 'border-[#391511]' : 'border-transparent hover:border-[#c8a58a]',
                          estilo.celda
                        )}
                      >
                        <span className="font-bold">{NOMBRE_TURNO[t.nombre]}</span>
                        <span className="tabular-nums text-xs">
                          {etiquetaHorasCorta(t)}
                          {t.cruza_medianoche && <span className="ml-1 opacity-80">termina al día siguiente</span>}
                        </span>
                      </button>
                    )
                  })}
              </div>
              {Object.keys(itemsTurno).length === 0 && (
                <p className="text-[#c43e2c] text-[11px]">No hay turnos activos. Configuralos en Tareas › Configurar rutina › Horarios de turno.</p>
              )}
            </div>
          )}

          {estadoPlan === 'planificado' && (
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">Cubre a</Label>
              <Select items={itemsCubre} value={cubreA} onValueChange={(v) => setCubreA(v ?? NADIE)} disabled={guardando}>
                <SelectTrigger className={`w-full ${claseInput}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(itemsCubre).map(([v, l]) => (
                    <SelectItem key={v} value={v}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-[#c8a58a]">
                Reemplazo explícito: queda en la celda y en las tareas del puesto cubierto.
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">Observación</Label>
            <Input
              value={observacion}
              onChange={(e) => setObservacion(e.target.value)}
              placeholder="Opcional (ej. cambio pedido por el empleado)"
              disabled={guardando}
              className={claseInput}
            />
          </div>

          {(avisos.length > 0 || fecha >= hoy) && (
            <ul className="space-y-1.5">
              {avisos.map((a, i) => (
                <li
                  key={i}
                  className={cn(
                    'flex items-start gap-2 rounded-lg px-3 py-2 text-[12px]',
                    a.tono === 'atencion' ? 'bg-[#e0a100]/15 text-[#a06b00]' : 'bg-[#fdfaf6] text-[#6f3a2a]'
                  )}
                >
                  {a.tono === 'atencion' ? <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" /> : <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />}
                  {a.texto}
                </li>
              ))}
              {fecha >= hoy && (
                <li className="flex items-start gap-2 rounded-lg px-3 py-2 text-[12px] bg-[#fdfaf6] text-[#6f3a2a]">
                  <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  {tareasAviso}
                </li>
              )}
            </ul>
          )}

          {horario && (
            <p className="text-[11px] text-[#c8a58a]">
              {horario.patron_id ? 'Generada por un patrón' : 'Carga manual'}
              {' · '}al guardar queda como carga manual (no la pisa una regeneración).
            </p>
          )}
        </div>

        <div className="border-t border-[#e4c9b0]/60 bg-[#fdfaf6] px-6 py-4 flex items-center gap-2">
          {horario && !confirmarQuitar && (
            <Button
              variant="ghost"
              onClick={() => setConfirmarQuitar(true)}
              disabled={guardando}
              className="text-[#c43e2c] hover:bg-[#c43e2c]/10 gap-1.5"
            >
              <Trash2 className="h-4 w-4" />
              Quitar
            </Button>
          )}
          {horario && confirmarQuitar && (
            <Button
              variant="ghost"
              onClick={quitar}
              disabled={guardando}
              className="text-[#c43e2c] hover:bg-[#c43e2c]/10 font-bold"
            >
              {borrar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : '¿Quitar la asignación?'}
            </Button>
          )}
          <div className="flex-1" />
          <Button variant="outline" onClick={() => onCambioAbierto(false)} disabled={guardando} className="border-[#e4c9b0] text-[#6f3a2a]">
            Cancelar
          </Button>
          <Button
            onClick={guardar}
            disabled={!puedeGuardar}
            className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-bold disabled:opacity-50"
          >
            {upsert.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Guardar'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
