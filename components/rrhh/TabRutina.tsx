'use client'

import { useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { Camera, Repeat, RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EditorTurnos } from './EditorTurnos'
import { CalendarioRutina } from './CalendarioRutina'
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
import { usePlantillas, useQuitarPlantilla, useReactivarPlantilla } from '@/lib/hooks/useTareas'
import { cn } from '@/lib/utils'
import type { PlantillaConAsignados } from '@/lib/queries/tareas'
import type { TurnoPlantillaRow } from '@/types/database'

interface Props {
  onNueva: (turnoId: number | null) => void
  onEditar: (p: PlantillaConAsignados) => void
  /** Puede editar los horarios de turno (administrador de tareas). */
  puedeEditarTurnos: boolean
  /** Administrador de tareas: quita y vuelve a poner tareas de la rutina. */
  esAdmin: boolean
  /** Encargada o administrador: edita la rutina (en el calendario, arrastrando). */
  esGestor?: boolean
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

export function TabRutina({ onNueva, onEditar, puedeEditarTurnos, esAdmin, esGestor = true }: Props) {
  // Etapa 4: la rutina en calendario (PC). La lista queda como alternativa y en el celular.
  const [vista, setVista] = useState<'calendario' | 'lista'>('calendario')
  const { data: plantillas } = usePlantillas()
  const { data: turnos } = useTurnos()
  const { data: empleados } = useEmpleados()
  const quitar = useQuitarPlantilla()
  const reactivar = useReactivarPlantilla()

  // Nada se borra: el administrador la quita desde mañana; la encargada lo pide.
  function onQuitar(p: PlantillaConAsignados) {
    if (esAdmin) {
      if (confirm(`¿Quitar "${p.titulo}" de la rutina desde mañana? No se borra: se puede volver a poner.`))
        quitar.mutate({ id: p.id, motivo: null })
      return
    }
    const motivo = prompt(
      `¿Por qué hay que quitar "${p.titulo}" de la rutina? Le llega el pedido a un administrador.`
    )
    if (motivo === null) return
    if (motivo.trim().length < 5) {
      alert('Contá el motivo en al menos 5 letras.')
      return
    }
    quitar.mutate({ id: p.id, motivo: motivo.trim() })
  }
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

      {esGestor && !esAdmin && (
        <p className="rounded-xl border border-[#f3d395] bg-[#fff6e5] px-3.5 py-2 text-[13px] text-[#4a3008]">
          Estás viendo la rutina como encargada. Podés cambiar horarios, días y quién hace cada tarea, y cada cambio queda
          en el registro que ven los administradores. Para quitar una tarea, se la pedís a ellos.
        </p>
      )}

      {turnoSel && (
        <div className="hidden md:flex items-center gap-2" role="group" aria-label="Cómo ver la rutina">
          {(['calendario', 'lista'] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={vista === v}
              onClick={() => setVista(v)}
              className={cn(
                'rounded-lg px-3 min-h-8 text-xs font-semibold border',
                vista === v ? 'bg-[#f9b44c] border-[#f9b44c] text-[#391511]' : 'bg-white border-[#e4c9b0] text-[#6f3a2a]'
              )}
            >
              {v === 'calendario' ? 'Calendario' : 'Lista'}
            </button>
          ))}
        </div>
      )}

      {turnoSel && vista === 'calendario' && (
        <div className="hidden md:block">
          <CalendarioRutina
            plantillas={lista}
            turno={turnoSel}
            esGestor={esGestor}
            esAdmin={esAdmin}
            nombres={nombrePorId}
          />
        </div>
      )}

      <section
        className={cn(
          'bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden shadow-sm',
          turnoSel && vista === 'calendario' && 'md:hidden'
        )}
      >
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
                          <span className="ml-2 text-[10px] uppercase font-bold text-[#c43e2c]">fuera de la rutina</span>
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
                      {p.activa ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onQuitar(p)}
                          disabled={quitar.isPending}
                          className="h-8 w-8 p-0 text-[#c8a58a] hover:text-[#c43e2c] hover:bg-[#c43e2c]/10"
                          aria-label={esAdmin ? `Quitar ${p.titulo} de la rutina` : `Pedir que se quite ${p.titulo}`}
                          title={esAdmin ? 'Quitar de la rutina' : 'Pedir que se quite'}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      ) : esAdmin ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (confirm(`¿Volver a poner "${p.titulo}" en la rutina desde mañana?`))
                              reactivar.mutate({ id: p.id })
                          }}
                          disabled={reactivar.isPending}
                          className="h-8 w-8 p-0 text-[#c8a58a] hover:text-[#2f7d4f] hover:bg-[#2f7d4f]/10"
                          aria-label={`Volver a poner ${p.titulo} en la rutina`}
                          title="Volver a la rutina"
                        >
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                      ) : null}
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
