'use client'

import { useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { Camera, Repeat, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EditorTurnos } from './EditorTurnos'
import { ROLES_OPERATIVOS, nombreCompleto } from './constantes'
import { NOMBRE_TURNO } from './asistenciaConstantes'
import {
  MODO_TAREA,
  PRIORIDAD_TAREA,
  TIPO_ACTIVIDAD,
  formatoDuracion,
  recurrenciaResumen,
} from './tareasConstantes'
import { etiquetaHorarioTurno, horaDeMinutos, minutosDeHora } from './tareasAgenda'
import { useEmpleados } from '@/lib/hooks/useRrhh'
import { useTurnos } from '@/lib/hooks/useAsistencia'
import { useDeletePlantilla, usePlantillas } from '@/lib/hooks/useTareas'
import { cn } from '@/lib/utils'
import type { PlantillaConAsignados } from '@/lib/queries/tareas'
import type { TurnoPlantillaRow } from '@/types/database'

interface Props {
  onNueva: (turnoId: number | null) => void
  onEditar: (p: PlantillaConAsignados) => void
  /** Puede editar los horarios de turno (permiso rrhh). */
  puedeEditarTurnos: boolean
}

const SIN_TURNO = 0

/** Hora efectiva de una plantilla: la fija, o la calculada desde el inicio del turno. */
export function horaPlantilla(p: PlantillaConAsignados, turno: TurnoPlantillaRow | null): string | null {
  if (p.hora) return p.hora.slice(0, 5)
  if (p.minutos_desde_inicio != null && turno) {
    return horaDeMinutos(minutosDeHora(turno.hora_inicio) + p.minutos_desde_inicio)
  }
  return null
}

/** Minutos relativos al inicio del turno, para ordenar (la noche cruza medianoche). */
function ordenPlantilla(p: PlantillaConAsignados, turno: TurnoPlantillaRow | null): number {
  const h = horaPlantilla(p, turno)
  if (h === null) return Number.POSITIVE_INFINITY
  let m = minutosDeHora(h)
  if (turno?.cruza_medianoche && m < minutosDeHora(turno.hora_inicio)) m += 1440
  return m
}

export function TabRutina({ onNueva, onEditar, puedeEditarTurnos }: Props) {
  const { data: plantillas } = usePlantillas()
  const { data: turnos } = useTurnos()
  const { data: empleados } = useEmpleados()
  const borrar = useDeletePlantilla()
  const [turnoId, setTurnoId] = useState<number | null>(null)

  const nombrePorId = useMemo(() => {
    const m = new Map<number, string>()
    for (const e of empleados ?? []) m.set(e.id, nombreCompleto(e))
    return m
  }, [empleados])

  const activos = (turnos ?? []).filter((t) => t.activo)
  const turnoSelId = turnoId ?? activos[0]?.id ?? SIN_TURNO
  const turnoSel = activos.find((t) => t.id === turnoSelId) ?? null

  const lista = useMemo(() => {
    const del = (plantillas ?? []).filter((p) =>
      turnoSelId === SIN_TURNO ? p.turno_id === null : p.turno_id === turnoSelId
    )
    return [...del].sort((a, b) => {
      const oa = ordenPlantilla(a, turnoSel)
      const ob = ordenPlantilla(b, turnoSel)
      if (oa !== ob) return oa - ob
      return a.titulo.localeCompare(b.titulo, 'es')
    })
  }, [plantillas, turnoSelId, turnoSel])

  const conHora = lista.filter((p) => horaPlantilla(p, turnoSel) !== null)
  const sinHora = lista.filter((p) => horaPlantilla(p, turnoSel) === null)
  const cuentaPorTurno = (id: number | null) =>
    (plantillas ?? []).filter((p) => p.turno_id === id).length

  function quien(p: PlantillaConAsignados): string {
    if (p.alcance === 'todos') return 'Todos'
    if (p.alcance === 'puesto') {
      const roles = (p.roles_puesto ?? []).map((r) => ROLES_OPERATIVOS[r]).join(' + ')
      return roles ? `${roles} (según cronograma)` : 'Sin puesto'
    }
    const ids = p.tareas_recurrentes_asignados?.map((a) => a.empleado_id) ?? []
    if (ids.length === 0) return '—'
    if (ids.length === 1) return nombrePorId.get(ids[0]) ?? '—'
    return `${ids.length} personas`
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-1.5 flex-wrap">
          {activos.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTurnoId(t.id)}
              aria-pressed={turnoSelId === t.id}
              className={cn(
                'rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f9b44c]',
                turnoSelId === t.id
                  ? 'bg-[#f9b44c] border-[#f9b44c] text-[#391511]'
                  : 'bg-white border-[#e4c9b0] text-[#6f3a2a] hover:border-[#f9b44c]'
              )}
            >
              {NOMBRE_TURNO[t.nombre]}{' '}
              <span className="font-normal text-xs opacity-80">
                {t.hora_inicio.slice(0, 5)}–{t.hora_fin.slice(0, 5)} · {cuentaPorTurno(t.id)}
              </span>
            </button>
          ))}
          {cuentaPorTurno(null) > 0 && (
            <button
              type="button"
              onClick={() => setTurnoId(SIN_TURNO)}
              aria-pressed={turnoSelId === SIN_TURNO}
              className={cn(
                'rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors',
                turnoSelId === SIN_TURNO
                  ? 'bg-[#f9b44c] border-[#f9b44c] text-[#391511]'
                  : 'bg-white border-[#e4c9b0] text-[#6f3a2a]'
              )}
            >
              Sin turno <span className="font-normal text-xs opacity-80">{cuentaPorTurno(null)}</span>
            </button>
          )}
        </div>
        <Button
          onClick={() => onNueva(turnoSelId === SIN_TURNO ? null : turnoSelId)}
          className="ml-auto bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5"
        >
          <Repeat className="h-4 w-4" />
          Nueva recurrente
        </Button>
      </div>

      <section className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden shadow-sm">
        <header className="flex items-baseline justify-between gap-2 px-4 py-2.5 border-b border-[#e4c9b0]/40 flex-wrap">
          <h3 className="text-[#391511] text-sm font-bold">
            Rutina de {turnoSel ? NOMBRE_TURNO[turnoSel.nombre].toLowerCase() : 'tareas sin turno'}
            {turnoSel && (
              <span className="font-normal text-[#6f3a2a]"> · {etiquetaHorarioTurno(turnoSel)}</span>
            )}
          </h3>
          <span className="text-[11px] text-[#c8a58a]">
            Se repite según cada regla · una lista nueva por turno cada día
          </span>
        </header>
        {lista.length === 0 ? (
          <p className="p-10 text-center text-[#c8a58a] text-sm">
            Sin tareas recurrentes en este turno. Creá una para que se genere sola cada día.
          </p>
        ) : (
          <ul className="divide-y divide-[#e4c9b0]/40">
            {[...conHora, ...sinHora].map((p, i) => {
              const hora = horaPlantilla(p, turnoSel)
              const primeraSinHora = i === conHora.length && sinHora.length > 0
              return (
                <li key={p.id}>
                  {primeraSinHora && (
                    <div className="px-4 py-1.5 bg-[#fdfaf6] text-[11px] font-semibold uppercase tracking-wide text-[#c8a58a]">
                      Durante el turno (sin hora fija)
                    </div>
                  )}
                  <div className="grid grid-cols-[52px_minmax(0,1fr)_auto] sm:grid-cols-[64px_minmax(0,1fr)_200px_auto] gap-x-3 items-center px-3 sm:px-4 py-2.5 hover:bg-[#fdfaf6]">
                    <button
                      type="button"
                      onClick={() => onEditar(p)}
                      className="tabular-nums text-sm font-semibold text-[#391511] text-left"
                      aria-label={`Editar ${p.titulo}`}
                    >
                      {hora ?? '—'}
                      {p.hora === null && p.minutos_desde_inicio != null && (
                        <span className="block text-[9px] font-normal text-[#c8a58a]">+{p.minutos_desde_inicio}′</span>
                      )}
                    </button>
                    <button type="button" onClick={() => onEditar(p)} className="min-w-0 text-left">
                      <span className="block text-sm text-[#391511] leading-snug truncate">
                        {p.tipo_actividad === 'bloque' && '⏸ '}
                        {p.tipo_actividad === 'continua' && '∞ '}
                        {p.titulo}
                        {!p.activa && (
                          <span className="ml-2 text-[10px] uppercase font-bold text-[#c43e2c]">pausada</span>
                        )}
                      </span>
                      <span className="block text-[11px] text-[#6f3a2a] truncate">
                        {[
                          formatoDuracion(p.duracion_min),
                          p.ventana_min && p.ventana_min !== p.duracion_min ? `ventana ${p.ventana_min} min` : null,
                          p.tipo_actividad !== 'puntual' ? TIPO_ACTIVIDAD[p.tipo_actividad].label : null,
                          recurrenciaResumen(p),
                          p.vigencia_hasta
                            ? `hasta ${format(parseISO(p.vigencia_hasta), 'd MMM', { locale: es })}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                        <span className="sm:hidden"> · {quien(p)}</span>
                      </span>
                    </button>
                    <span className="hidden sm:block text-xs text-[#6f3a2a] truncate" title={quien(p)}>
                      {quien(p)}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {p.requiere_evidencia && <Camera className="h-3 w-3 text-[#c8a58a]" />}
                      <span
                        className={cn('hidden sm:inline text-[10px] uppercase font-bold px-1.5 py-0.5 rounded', MODO_TAREA[p.modo].clase)}
                      >
                        {MODO_TAREA[p.modo].label}
                      </span>
                      <span
                        className={cn('text-[10px] uppercase font-bold px-1.5 py-0.5 rounded', PRIORIDAD_TAREA[p.prioridad].clase)}
                      >
                        {PRIORIDAD_TAREA[p.prioridad].label}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          if (confirm(`¿Eliminar la recurrente "${p.titulo}"? Las tareas ya generadas no se borran.`))
                            borrar.mutate(p.id)
                        }}
                        className="h-8 w-8 p-0 text-[#c8a58a] hover:text-[#c43e2c] hover:bg-[#c43e2c]/10"
                        aria-label={`Eliminar ${p.titulo}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {puedeEditarTurnos && <EditorTurnos />}
    </div>
  )
}
