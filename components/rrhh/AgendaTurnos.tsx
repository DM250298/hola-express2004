'use client'

import { useEffect, useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import {
  AlertTriangle,
  ArrowRightToLine,
  Camera,
  CheckCircle2,
  Loader2,
  Play,
  Repeat2,
  UserX,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SkeletonTabla } from '@/components/shared/SkeletonTabla'
import { EstadoError } from '@/components/shared/EstadoError'
import { nombreCompleto } from './constantes'
import { NOMBRE_TURNO, hoyAr } from './asistenciaConstantes'
import { horaActualAr } from './paseTurnoConstantes'
import {
  ESTADO_DERIVADO,
  PRIORIDAD_TAREA,
  esCobertura,
  formatoDuracion,
  formatoHora,
  tareaEsDe,
} from './tareasConstantes'
import {
  type SeleccionTurno,
  type TareaAgenda,
  conteoTurno,
  contextoReloj,
  estaAbierta,
  estadoDerivado,
  etiquetaHorarioTurno,
  fechaDeSeleccion,
  focoDelTurno,
  horaDeMinutos,
  minutosDeHora,
  ordenarCronologico,
  personasEnTurno,
  segmentosDia,
  sinAsignar,
  solapamientosPorPersona,
  tareasDeSeleccion,
  tareasSinTurno,
  turnoEnMinuto,
  turnoPorTerminar,
} from './tareasAgenda'
import { CalendarioAgenda } from './CalendarioAgenda'
import { rangoTurno } from './calendarioTurno'
import { useEmpleados } from '@/lib/hooks/useRrhh'
import { useHorariosRango, useTurnos } from '@/lib/hooks/useAsistencia'
import {
  useCompletarTarea,
  useIniciarTarea,
  useRealtimeTareas,
  useTareasAgenda,
  useTrasladarTarea,
} from '@/lib/hooks/useTareas'
import { isoMasDias } from '@/lib/utils/periodos'
import { cn } from '@/lib/utils'
import type { TareaConParticipantes } from '@/lib/queries/tareas'
import type { TurnoPlantillaRow } from '@/types/database'

interface Props {
  fecha: string
  /** Puede operar cualquier tarea (tareas_gestion). */
  esGestor: boolean
  /** Legajo del usuario logueado (para Iniciar/Completar las propias). */
  empleadoActualId: number | null
  /** Abre la ventana de la tarea (en el celular, y "Editar" en la PC). */
  onAbrirTarea: (t: TareaConParticipantes) => void
  /** Administrador de tareas: ve privadas y "Para revisar". */
  esAdmin?: boolean
  /** Nombre de quien mira, para el aviso "marcada por X en nombre de Y". */
  actorNombre?: string | null
  /** Lleva a la pestaña Registro de cambios (solo administradores). */
  onVerRegistro?: () => void
}

const TICKS = ['00:00', '06:00', '12:00', '18:00', '24:00']

export function AgendaTurnos({
  fecha,
  esGestor,
  empleadoActualId,
  onAbrirTarea,
  esAdmin = false,
  actorNombre = null,
  onVerRegistro,
}: Props) {
  // En vivo (mig 289): lo que marca cualquiera aparece sin recargar.
  useRealtimeTareas()
  const hoy = hoyAr()
  const ayer = isoMasDias(fecha, -1)
  const [horaAhora, setHoraAhora] = useState(() => horaActualAr())
  useEffect(() => {
    const id = setInterval(() => setHoraAhora(horaActualAr()), 30_000)
    return () => clearInterval(id)
  }, [])

  const { data: turnos, isLoading: cargandoTurnos } = useTurnos()
  const { data: tareas, isLoading, isError, refetch } = useTareasAgenda(fecha)
  const { data: horarios } = useHorariosRango(ayer, fecha)
  const { data: empleados } = useEmpleados()
  const iniciar = useIniciarTarea()
  const completar = useCompletarTarea()
  const trasladar = useTrasladarTarea()

  const nombrePorId = useMemo(() => {
    const m = new Map<number, string>()
    for (const e of empleados ?? []) m.set(e.id, nombreCompleto(e))
    return m
  }, [empleados])

  const activos = useMemo(() => (turnos ?? []).filter((t) => t.activo), [turnos])
  const segmentos = useMemo(() => segmentosDia(turnos ?? []), [turnos])
  const reloj = useMemo(() => contextoReloj(fecha, hoy, horaAhora), [fecha, hoy, horaAhora])

  // Selección: el turno actual si la agenda es hoy; si no, el primero del día.
  const [sel, setSel] = useState<SeleccionTurno | null>(null)
  useEffect(() => {
    if (activos.length === 0) return
    if (fecha === hoy) {
      const s = turnoEnMinuto(segmentos, minutosDeHora(horaAhora))
      if (s?.turno) {
        setSel({ turnoId: s.turno.id, origen: s.origen })
        return
      }
    }
    setSel({ turnoId: activos[0].id, origen: 'hoy' })
    // Solo al cambiar de fecha o cargar turnos: no pisar lo que eligió el usuario.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fecha, activos.length, segmentos.length])

  const turnoSel = activos.find((t) => t.id === sel?.turnoId) ?? null
  const fechaSel = sel ? fechaDeSeleccion(sel, fecha, ayer) : fecha

  const listaSel: TareaAgenda[] = useMemo(() => {
    if (!sel || !turnoSel) return []
    const base = tareasDeSeleccion(tareas ?? [], sel, fechaSel)
    return ordenarCronologico(
      base.map((t) => ({ tarea: t, derivado: estadoDerivado(t, turnoSel, fecha, reloj) }))
    )
  }, [tareas, sel, turnoSel, fechaSel, fecha, reloj])

  const sinTurno: TareaAgenda[] = useMemo(
    () =>
      ordenarCronologico(
        tareasSinTurno(tareas ?? [], fecha).map((t) => ({
          tarea: t,
          derivado: estadoDerivado(t, null, fecha, reloj),
        }))
      ),
    [tareas, fecha, reloj]
  )

  const continuas = listaSel.filter((x) => x.tarea.tipo_actividad === 'continua')
  const cronologicas = listaSel.filter((x) => x.tarea.tipo_actividad !== 'continua')
  const conHora = cronologicas.filter((x) => x.derivado.inicio !== null)
  const sinHora = cronologicas.filter((x) => x.derivado.inicio === null)
  const conteo = conteoTurno(listaSel)
  const foco = focoDelTurno(listaSel)
  const solapes = solapamientosPorPersona(listaSel)
  const sinDueno = cronologicas.filter((x) => sinAsignar(x.tarea))
  const atrasadas = cronologicas.filter((x) => x.derivado.atrasada && estaAbierta(x.derivado))
  const noSePudieron = cronologicas.filter((x) => x.derivado.estado === 'no_se_pudo').length
  const personas = turnoSel ? personasEnTurno(horarios ?? [], turnoSel.id, fechaSel) : []
  const huecos = segmentos.filter((s) => !s.turno)
  const porTerminar = !!turnoSel && sel ? turnoPorTerminar(turnoSel, sel.origen, reloj) : false
  const pendientesEntrega = porTerminar
    ? cronologicas.filter((x) => estaAbierta(x.derivado) && !x.tarea.trasladada_a)
    : []

  function puedeOperar(t: TareaConParticipantes) {
    return esGestor || (empleadoActualId !== null && tareaEsDe(t, empleadoActualId))
  }

  function conteoDeTurno(t: TurnoPlantillaRow) {
    const base = tareasDeSeleccion(tareas ?? [], { turnoId: t.id, origen: 'hoy' }, fecha)
    return conteoTurno(
      base.map((x) => ({ tarea: x, derivado: estadoDerivado(x, t, fecha, reloj) }))
    )
  }

  function responsable(t: TareaConParticipantes): { texto: string; sin: boolean } {
    if (t.empleado_id !== null) return { texto: nombrePorId.get(t.empleado_id) ?? '—', sin: false }
    const parts = t.tareas_turno_participantes ?? []
    if (parts.length === 0) return { texto: 'Sin asignar', sin: true }
    const nombres = parts.map((p) => nombrePorId.get(p.empleado_id) ?? `#${p.empleado_id}`)
    return {
      texto: nombres.length <= 2 ? nombres.join(' y ') : `${nombres[0]} +${nombres.length - 1}`,
      sin: false,
    }
  }

  if (isError) return <EstadoError onReintentar={() => refetch()} />
  if (cargandoTurnos || isLoading) {
    return (
      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-6">
        <SkeletonTabla filas={6} columnas={4} />
      </div>
    )
  }
  if (activos.length === 0) {
    return (
      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-8 text-center">
        <p className="text-[#391511] font-semibold">No hay turnos activos.</p>
        <p className="text-[#6f3a2a] text-sm mt-1">
          Activá al menos un turno en Configurar rutina › Horarios de turno.
        </p>
      </div>
    )
  }

  const tituloDia = format(parseISO(fecha), "EEEE d 'de' MMMM", { locale: es })
  const esHoy = fecha === hoy

  return (
    <div className="space-y-4">
      {/* ── Cobertura 00:00–24:00 ── */}
      <section className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-4 space-y-2">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h3 className="text-[#391511] font-bold capitalize">{tituloDia}</h3>
          <span className="text-xs text-[#6f3a2a]">
            {esHoy ? `Ahora son las ${horaAhora}` : fecha < hoy ? 'Día pasado' : 'Día futuro'} ·
            abierto las 24 h
          </span>
        </div>
        <div
          className="grid gap-1 rounded-lg overflow-hidden"
          style={{ gridTemplateColumns: segmentos.map((s) => `${s.hasta - s.desde}fr`).join(' ') }}
          role="group"
          aria-label="Cobertura de turnos durante las 24 horas"
        >
          {segmentos.map((s, i) => {
            const activo = !!s.turno && sel?.turnoId === s.turno.id && sel.origen === s.origen
            const rango = `${horaDeMinutos(s.desde)}–${s.hasta === 1440 ? '24:00' : horaDeMinutos(s.hasta)}`
            return s.turno ? (
              <button
                key={i}
                type="button"
                onClick={() => setSel({ turnoId: s.turno!.id, origen: s.origen })}
                aria-pressed={activo}
                title={`${NOMBRE_TURNO[s.turno.nombre]} ${rango}${s.origen === 'ayer' ? ' (empezó ayer)' : ''}`}
                className={cn(
                  'min-w-0 px-2 py-2 text-left text-[11px] sm:text-xs rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f9b44c]',
                  activo ? 'bg-[#f9b44c] text-[#391511]' : 'bg-[#f3ece4] text-[#6f3a2a] hover:bg-[#f9d2a2]/60'
                )}
              >
                <span className="font-semibold truncate block">
                  {NOMBRE_TURNO[s.turno.nombre]}
                  {s.origen === 'ayer' && ' (de ayer)'}
                </span>
                <span className="tabular-nums truncate block">{rango}</span>
              </button>
            ) : (
              <div
                key={i}
                className="min-w-0 px-2 py-2 text-[11px] sm:text-xs rounded-md bg-[#c43e2c]/10 text-[#c43e2c] border border-dashed border-[#c43e2c]/40"
                title={`Sin cobertura ${rango}`}
              >
                <span className="font-semibold truncate block">Sin cobertura</span>
                <span className="tabular-nums truncate block">{rango}</span>
              </div>
            )
          })}
        </div>
        <div className="flex justify-between text-[10px] text-[#c8a58a] tabular-nums">
          {TICKS.map((t) => (
            <span key={t}>{t}</span>
          ))}
        </div>
        {huecos.length > 0 && (
          <p className="text-xs text-[#c43e2c] flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" />
            Hay franjas sin turno activo: nadie tiene tareas asignadas en esos horarios.
          </p>
        )}
      </section>

      {/* ── Selector de turno ── */}
      <div className="flex sm:grid sm:grid-cols-3 gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {activos.map((t) => {
          const activo = sel?.turnoId === t.id && sel.origen === 'hoy'
          const c = conteoDeTurno(t)
          const gente = personasEnTurno(horarios ?? [], t.id, fecha)
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setSel({ turnoId: t.id, origen: 'hoy' })}
              aria-pressed={activo}
              className={cn(
                'shrink-0 min-w-[200px] sm:min-w-0 text-left bg-white border rounded-2xl p-3.5 space-y-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f9b44c]',
                activo ? 'border-[#f9b44c] ring-1 ring-[#f9b44c]' : 'border-[#e4c9b0]/60 hover:border-[#f9b44c]/60'
              )}
            >
              <span className="flex items-center justify-between gap-2">
                <strong className="text-[#391511] text-base font-semibold">{NOMBRE_TURNO[t.nombre]}</strong>
                <span className="text-xs text-[#6f3a2a] tabular-nums">
                  {c.hechas}/{c.total}
                </span>
              </span>
              <span className="block text-xs text-[#6f3a2a] tabular-nums">{etiquetaHorarioTurno(t)}</span>
              <span className={cn('block text-[11px]', gente.length === 0 ? 'text-[#c43e2c]' : 'text-[#c8a58a]')}>
                {gente.length === 0
                  ? 'Sin personal en el cronograma'
                  : gente.map((id) => nombrePorId.get(id)?.split(' ')[0] ?? `#${id}`).join(', ')}
              </span>
            </button>
          )
        })}
      </div>

      {turnoSel && sel && (
        <>
          {/* ── Cabecera del turno seleccionado ── */}
          <div className="flex items-baseline justify-between gap-3 flex-wrap px-1">
            <h3 className="text-[#391511] font-bold">
              {NOMBRE_TURNO[turnoSel.nombre]}
              {sel.origen === 'ayer' && (
                <span className="font-normal text-[#6f3a2a]">
                  {' '}
                  del {format(parseISO(fechaSel), "EEE d 'de' MMM", { locale: es })} · termina{' '}
                  {turnoSel.hora_fin.slice(0, 5)}
                </span>
              )}
            </h3>
            <span className="text-xs text-[#6f3a2a] tabular-nums">
              {conteo.hechas} de {conteo.total} tareas completadas
              {personas.length > 0 && ` · ${personas.length} en el turno`}
            </span>
          </div>

          {/* ── PC: calendario del turno con panel lateral (Tareas v2, Etapa 2) ── */}
          <div className="hidden md:block">
            <CalendarioAgenda
              lista={listaSel}
              turno={turnoSel}
              rango={rangoTurno(turnoSel, sel.origen)}
              fechaTurno={fechaSel}
              reloj={reloj}
              nombres={nombrePorId}
              esGestor={esGestor}
              esAdmin={esAdmin}
              empleadoActualId={empleadoActualId}
              actorNombre={actorNombre}
              onEditar={onAbrirTarea}
              onVerRegistro={onVerRegistro}
            />
          </div>

          {/* ── Celular: foco y lista ── */}
          <div className="md:hidden space-y-4">
          {/* ── Foco: ahora / atrasada / próxima ── */}
          {foco ? (
            <FocoTarea
              foco={foco}
              horaAhora={esHoy ? horaAhora : null}
              puedeOperar={puedeOperar(foco.item.tarea)}
              responsable={responsable(foco.item.tarea).texto}
              onIniciar={() => iniciar.mutate(foco.item.tarea.id)}
              onCompletar={() =>
                foco.item.tarea.requiere_evidencia
                  ? onAbrirTarea(foco.item.tarea)
                  : completar.mutate({ id: foco.item.tarea.id })
              }
              onAbrir={() => onAbrirTarea(foco.item.tarea)}
              ocupado={iniciar.isPending || completar.isPending}
            />
          ) : cronologicas.length > 0 && noSePudieron > 0 ? (
            <div className="rounded-2xl bg-[#f3ece4] border border-[#e4c9b0] px-4 py-3 text-[#6f3a2a] text-sm font-medium">
              No quedan tareas abiertas: {conteo.hechas} hechas y {noSePudieron}{' '}
              {noSePudieron === 1 ? 'que no se pudo hacer' : 'que no se pudieron hacer'}.
            </div>
          ) : cronologicas.length > 0 ? (
            <div className="rounded-2xl bg-[#2f7d4f]/10 border border-[#2f7d4f]/25 px-4 py-3 text-[#2f7d4f] text-sm font-medium flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" />
              Todas las tareas de este turno están completas.
            </div>
          ) : null}
          </div>

          {/* ── Avisos ── */}
          {(sinDueno.length > 0 || atrasadas.length > 0 || solapes.length > 0 || personas.length === 0) && (
            <ul className="space-y-1.5 text-xs">
              {personas.length === 0 && (
                <Aviso icono={<UserX className="h-3.5 w-3.5" />} tono="rojo">
                  Nadie figura en el cronograma para este turno el{' '}
                  {format(parseISO(fechaSel), 'd/MM')}: las tareas por puesto quedaron con asignación
                  por defecto o sin dueño.
                </Aviso>
              )}
              {sinDueno.length > 0 && (
                <Aviso icono={<UserX className="h-3.5 w-3.5" />} tono="rojo">
                  {sinDueno.length === 1
                    ? '1 tarea sin responsable'
                    : `${sinDueno.length} tareas sin responsable`}
                  : {sinDueno.map((x) => x.tarea.titulo).join(' · ')}
                </Aviso>
              )}
              {atrasadas.length > 0 && (
                <Aviso icono={<AlertTriangle className="h-3.5 w-3.5" />} tono="rojo">
                  {atrasadas.length === 1 ? '1 tarea atrasada' : `${atrasadas.length} tareas atrasadas`}{' '}
                  (venció su ventana y sigue abierta).
                </Aviso>
              )}
              {solapes.map((s, i) => (
                <Aviso key={i} icono={<AlertTriangle className="h-3.5 w-3.5" />} tono="ambar">
                  Solapamiento de {nombrePorId.get(s.empleadoId) ?? '—'}: “{s.a.titulo}” (
                  {formatoHora(s.a.hora)}, {formatoDuracion(s.a.duracion_min)}) pisa a “{s.b.titulo}” (
                  {formatoHora(s.b.hora)}).
                </Aviso>
              ))}
            </ul>
          )}

          <div className="md:hidden space-y-4">
          {/* ── Continuas ── */}
          {continuas.length > 0 && (
            <div className="flex items-start gap-2 text-xs text-[#6f3a2a] px-1">
              <Repeat2 className="h-4 w-4 shrink-0 text-[#c8a58a]" />
              <p>
                <span className="font-semibold">Durante todo el turno:</span>{' '}
                {continuas.map((x) => x.tarea.titulo).join(' · ')}.
              </p>
            </div>
          )}

          {/* ── Lista cronológica ── */}
          <section className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden">
            <header className="flex items-center justify-between px-4 py-2.5 border-b border-[#e4c9b0]/40">
              <h4 className="text-[#391511] text-sm font-bold">Agenda del turno</h4>
              <span className="text-[11px] text-[#c8a58a]">Hora · tarea · responsable · estado</span>
            </header>
            {cronologicas.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-[#c8a58a]">
                Sin tareas en este turno. Cargá la rutina en “Configurar rutina” o creá una tarea.
              </p>
            ) : (
              <ul className="divide-y divide-[#e4c9b0]/40">
                {conHora.map((x) => (
                  <FilaTarea
                    key={x.tarea.id}
                    item={x}
                    responsable={responsable(x.tarea)}
                    puedeOperar={puedeOperar(x.tarea)}
                    onAbrir={() => onAbrirTarea(x.tarea)}
                    onIniciar={() => iniciar.mutate(x.tarea.id)}
                    onCompletar={() =>
                      x.tarea.requiere_evidencia
                        ? onAbrirTarea(x.tarea)
                        : completar.mutate({ id: x.tarea.id })
                    }
                    ocupado={iniciar.isPending || completar.isPending}
                    nombrePorId={nombrePorId}
                  />
                ))}
                {sinHora.length > 0 && (
                  <li className="px-4 py-1.5 bg-[#fdfaf6] text-[11px] font-semibold uppercase tracking-wide text-[#c8a58a]">
                    Durante el turno (sin hora fija)
                  </li>
                )}
                {sinHora.map((x) => (
                  <FilaTarea
                    key={x.tarea.id}
                    item={x}
                    responsable={responsable(x.tarea)}
                    puedeOperar={puedeOperar(x.tarea)}
                    onAbrir={() => onAbrirTarea(x.tarea)}
                    onIniciar={() => iniciar.mutate(x.tarea.id)}
                    onCompletar={() =>
                      x.tarea.requiere_evidencia
                        ? onAbrirTarea(x.tarea)
                        : completar.mutate({ id: x.tarea.id })
                    }
                    ocupado={iniciar.isPending || completar.isPending}
                    nombrePorId={nombrePorId}
                  />
                ))}
              </ul>
            )}
          </section>
          </div>

          {/* ── Pendientes para entregar al turno siguiente ── */}
          {pendientesEntrega.length > 0 && (
            <section className="bg-[#fdfaf6] border border-[#f9b44c]/60 rounded-2xl p-4 space-y-2">
              <div className="flex items-center gap-2">
                <ArrowRightToLine className="h-4 w-4 text-[#a06b00]" />
                <h4 className="text-[#391511] text-sm font-bold">
                  Pendientes para entregar ({pendientesEntrega.length})
                </h4>
              </div>
              <p className="text-xs text-[#6f3a2a]">
                El turno termina: lo que no se completó se puede trasladar al siguiente, con
                registro de dónde viene.
              </p>
              <ul className="space-y-1.5">
                {pendientesEntrega.map((x) => (
                  <li
                    key={x.tarea.id}
                    className="flex items-center gap-2 bg-white border border-[#e4c9b0]/60 rounded-xl px-3 py-2 text-sm"
                  >
                    <span className="tabular-nums text-xs text-[#6f3a2a] w-12 shrink-0">
                      {formatoHora(x.tarea.hora)}
                    </span>
                    <span className="flex-1 min-w-0 truncate text-[#391511]">{x.tarea.titulo}</span>
                    {puedeOperar(x.tarea) && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          if (confirm(`¿Trasladar “${x.tarea.titulo}” al turno siguiente?`))
                            trasladar.mutate(x.tarea.id)
                        }}
                        disabled={trasladar.isPending}
                        className="h-7 text-xs border-[#e4c9b0] text-[#6f3a2a]"
                      >
                        Trasladar
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {/* ── Sin turno ── */}
      {sinTurno.length > 0 && (
        <section className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden">
          <header className="px-4 py-2.5 border-b border-[#e4c9b0]/40">
            <h4 className="text-[#391511] text-sm font-bold">
              Sin turno asignado ({sinTurno.length})
            </h4>
            <p className="text-[11px] text-[#c8a58a]">
              Tareas del día que no pertenecen a un turno. Asignales turno para verlas en la agenda.
            </p>
          </header>
          <ul className="divide-y divide-[#e4c9b0]/40">
            {sinTurno.map((x) => (
              <FilaTarea
                key={x.tarea.id}
                item={x}
                responsable={responsable(x.tarea)}
                puedeOperar={puedeOperar(x.tarea)}
                onAbrir={() => onAbrirTarea(x.tarea)}
                onIniciar={() => iniciar.mutate(x.tarea.id)}
                onCompletar={() =>
                  x.tarea.requiere_evidencia
                    ? onAbrirTarea(x.tarea)
                    : completar.mutate({ id: x.tarea.id })
                }
                ocupado={iniciar.isPending || completar.isPending}
                nombrePorId={nombrePorId}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

// ─── Piezas ────────────────────────────────────────────────────────────────

function Aviso({
  icono,
  tono,
  children,
}: {
  icono: React.ReactNode
  tono: 'rojo' | 'ambar'
  children: React.ReactNode
}) {
  return (
    <li
      className={cn(
        'flex items-start gap-2 rounded-xl px-3 py-2 border',
        tono === 'rojo'
          ? 'bg-[#c43e2c]/8 border-[#c43e2c]/25 text-[#c43e2c]'
          : 'bg-[#f9b44c]/15 border-[#f9b44c]/40 text-[#a06b00]'
      )}
    >
      <span className="mt-0.5 shrink-0">{icono}</span>
      <span>{children}</span>
    </li>
  )
}

function FocoTarea({
  foco,
  horaAhora,
  puedeOperar,
  responsable,
  onIniciar,
  onCompletar,
  onAbrir,
  ocupado,
}: {
  foco: NonNullable<ReturnType<typeof focoDelTurno>>
  horaAhora: string | null
  puedeOperar: boolean
  responsable: string
  onIniciar: () => void
  onCompletar: () => void
  onAbrir: () => void
  ocupado: boolean
}) {
  const t = foco.item.tarea
  const d = foco.item.derivado
  const eyebrow =
    foco.tipo === 'ahora'
      ? `AHORA${horaAhora ? ` · ${horaAhora}` : ''}`
      : foco.tipo === 'atrasada'
        ? `ATRASADA · DEBÍA EMPEZAR ${formatoHora(t.hora)}`
        : foco.tipo === 'proxima'
          ? `PRÓXIMA TAREA · ${formatoHora(t.hora)}`
          : 'PENDIENTE DEL TURNO'
  const abierta = estaAbierta(d)
  return (
    <div
      className={cn(
        'rounded-2xl px-4 py-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 border',
        foco.tipo === 'atrasada'
          ? 'bg-[#c43e2c]/8 border-[#c43e2c]/30'
          : foco.tipo === 'ahora'
            ? 'bg-[#f9b44c]/20 border-[#f9b44c]'
            : 'bg-[#f3ece4] border-[#e4c9b0]/60'
      )}
    >
      <button type="button" onClick={onAbrir} className="text-left min-w-0 flex-1">
        <span
          className={cn(
            'block text-[11px] tracking-wider font-bold',
            foco.tipo === 'atrasada' ? 'text-[#c43e2c]' : 'text-[#6f3a2a]'
          )}
        >
          {eyebrow}
        </span>
        <strong className="block text-[#391511] text-lg font-semibold leading-snug my-0.5">
          {t.titulo}
        </strong>
        <span className="block text-xs text-[#6f3a2a]">
          {[formatoHora(t.hora) !== '—' ? formatoHora(t.hora) : null, responsable, formatoDuracion(t.duracion_min)]
            .filter(Boolean)
            .join(' · ')}
          {d.estado === 'en_curso' && ' · en curso'}
        </span>
      </button>
      {puedeOperar && abierta && (
        <div className="flex gap-2 w-full sm:w-auto shrink-0">
          {t.estado !== 'en_curso' && (
            <Button
              variant="outline"
              onClick={onIniciar}
              disabled={ocupado}
              className="h-10 flex-1 sm:flex-initial border-[#e4c9b0] bg-white text-[#391511] gap-1.5"
            >
              <Play className="h-4 w-4" /> Iniciar
            </Button>
          )}
          <Button
            onClick={onCompletar}
            disabled={ocupado}
            className="h-10 flex-1 sm:flex-initial bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5"
          >
            {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {t.requiere_evidencia ? 'Completar con foto' : 'Completar'}
          </Button>
        </div>
      )}
    </div>
  )
}

function FilaTarea({
  item,
  responsable,
  puedeOperar,
  onAbrir,
  onIniciar,
  onCompletar,
  ocupado,
  nombrePorId,
}: {
  item: TareaAgenda
  responsable: { texto: string; sin: boolean }
  puedeOperar: boolean
  onAbrir: () => void
  onIniciar: () => void
  onCompletar: () => void
  ocupado: boolean
  nombrePorId: Map<number, string>
}) {
  const t = item.tarea
  const d = item.derivado
  const est = ESTADO_DERIVADO[d.estado]
  const abierta = estaAbierta(d)
  const esBloque = t.tipo_actividad === 'bloque'
  const cerrada =
    d.estado === 'completada' ||
    d.estado === 'no_se_pudo' ||
    d.estado === 'omitida' ||
    d.estado === 'trasladada'
  return (
    <li
      aria-current={d.estado === 'ahora' || d.estado === 'en_curso' ? 'true' : undefined}
      className={cn(
        'grid grid-cols-[52px_minmax(0,1fr)_auto] sm:grid-cols-[64px_minmax(0,1fr)_150px_110px_auto] gap-x-3 gap-y-1 items-center px-3 sm:px-4 py-2.5',
        d.estado === 'ahora' || d.estado === 'en_curso' ? 'bg-[#f9b44c]/10' : '',
        esBloque && 'bg-[#fdfaf6]',
        cerrada && 'opacity-70'
      )}
    >
      <button
        type="button"
        onClick={onAbrir}
        className="tabular-nums text-sm font-semibold text-[#391511] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f9b44c] rounded"
        aria-label={`Abrir ${t.titulo}`}
      >
        {formatoHora(t.hora)}
      </button>
      <button type="button" onClick={onAbrir} className="min-w-0 text-left">
        <span
          className={cn(
            'block text-sm text-[#391511] leading-snug',
            esBloque && 'italic text-[#6f3a2a]',
            d.estado === 'completada' && 'line-through text-[#6f3a2a]'
          )}
        >
          {esBloque && '⏸ '}
          {t.titulo}
          {t.trasladada_de && (
            <span className="ml-1.5 text-[10px] font-bold text-[#a06b00]" title={t.notas ?? undefined}>
              ↩ viene de otro turno
            </span>
          )}
        </span>
        <span className="block text-[11px] text-[#6f3a2a] truncate">
          {[formatoDuracion(t.duracion_min), PRIORIDAD_TAREA[t.prioridad].label !== 'Media' ? `prioridad ${PRIORIDAD_TAREA[t.prioridad].label.toLowerCase()}` : null]
            .filter(Boolean)
            .join(' · ')}
          <span className="sm:hidden">
            {t.duracion_min ? ' · ' : ''}
            <span className={cn(responsable.sin && 'text-[#c43e2c] font-semibold')}>{responsable.texto}</span>
          </span>
          {esCobertura(t.notas) && <span className="text-[#2f7d4f] font-semibold"> · ↺ {t.notas}</span>}
          {t.rechazos_count > 0 && !cerrada && (
            <span className="text-[#c43e2c] font-semibold"> · rechazada ×{t.rechazos_count}</span>
          )}
          {d.estado === 'en_curso' && t.iniciada_por != null && (
            <span> · la inició {nombrePorId.get(t.iniciada_por) ?? '—'}</span>
          )}
        </span>
      </button>
      <span
        className={cn(
          'hidden sm:flex items-center gap-1 text-xs truncate',
          responsable.sin ? 'text-[#c43e2c] font-semibold' : 'text-[#6f3a2a]'
        )}
        title={responsable.texto}
      >
        {t.empleado_id === null && !responsable.sin && <Users className="h-3 w-3 shrink-0" />}
        {responsable.texto}
      </span>
      <span className="hidden sm:block">
        <span className={cn('inline-block text-[11px] font-bold px-2 py-0.5 rounded-full', est.clase)}>
          {est.label}
          {d.atrasada && d.estado === 'en_curso' && ' · atrasada'}
        </span>
      </span>
      <div className="flex items-center justify-end gap-1">
        <span className={cn('sm:hidden inline-block text-[10px] font-bold px-1.5 py-0.5 rounded-full', est.clase)}>
          {est.label}
        </span>
        {puedeOperar && abierta && !esBloque ? (
          t.estado === 'en_curso' || d.estado === 'ahora' || d.estado === 'atrasada' || d.estado === 'vencida' ? (
            <Button
              size="sm"
              onClick={onCompletar}
              disabled={ocupado}
              aria-label={`Completar ${t.titulo}`}
              className="h-8 px-2.5 bg-[#2f7d4f] hover:bg-[#276b43] text-white text-xs gap-1"
            >
              {t.requiere_evidencia ? <Camera className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">Completar</span>
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={onIniciar}
              disabled={ocupado}
              aria-label={`Iniciar ${t.titulo}`}
              className="h-8 px-2.5 border-[#e4c9b0] text-[#391511] text-xs gap-1"
            >
              <Play className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Iniciar</span>
            </Button>
          )
        ) : puedeOperar && abierta && esBloque ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={onCompletar}
            disabled={ocupado}
            aria-label={`Marcar hecho ${t.titulo}`}
            className="h-8 px-2 text-[#6f3a2a] text-xs"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
          </Button>
        ) : null}
      </div>
    </li>
  )
}
