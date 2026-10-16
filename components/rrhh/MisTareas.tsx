'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { ArrowRightToLine, CheckCircle2, Loader2, Play, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SubirEvidencia } from './SubirEvidencia'
import { NOMBRE_TURNO, hoyAr } from './asistenciaConstantes'
import { horaActualAr } from './paseTurnoConstantes'
import {
  ESTADO_DERIVADO,
  MODO_TAREA,
  PRIORIDAD_TAREA,
  esCobertura,
  formatoDuracion,
  formatoHora,
  tareaEsDe,
} from './tareasConstantes'
import {
  type TareaAgenda,
  contextoReloj,
  estaAbierta,
  estadoDerivado,
  focoDelTurno,
  ordenarCronologico,
  turnoPorTerminar,
} from './tareasAgenda'
import { useTurnos } from '@/lib/hooks/useAsistencia'
import {
  useCompletarTarea,
  useIniciarTarea,
  useMaterializar,
  useOmitirTarea,
  useTareasAgenda,
  useTrasladarTarea,
} from '@/lib/hooks/useTareas'
import { isoMasDias } from '@/lib/utils/periodos'
import { cn } from '@/lib/utils'
import type { TareaConParticipantes } from '@/lib/queries/tareas'

interface Props {
  empleadoId: number
  nombre: string
}

function TarjetaMiTarea({
  item,
  empleadoId,
  destacada,
}: {
  item: TareaAgenda
  empleadoId: number
  destacada?: boolean
}) {
  const tarea = item.tarea
  const d = item.derivado
  const completar = useCompletarTarea()
  const iniciar = useIniciarTarea()
  const omitir = useOmitirTarea()
  const [evidencia, setEvidencia] = useState<string | null>(tarea.evidencia_url)
  const [mostrarOmision, setMostrarOmision] = useState(false)
  const [motivo, setMotivo] = useState('')
  const hecha = tarea.estado === 'completada'
  const grupal = tarea.empleado_id === null
  const rechazada = tarea.rechazos_count > 0 && !hecha
  const abierta = estaAbierta(d)
  const est = ESTADO_DERIVADO[d.estado]
  const ocupado = completar.isPending || iniciar.isPending || omitir.isPending
  const esBloque = tarea.tipo_actividad === 'bloque'

  return (
    <div
      className={cn(
        'rounded-2xl border p-4 shadow-sm space-y-3',
        hecha
          ? 'bg-[#2f7d4f]/8 border-[#2f7d4f]/25'
          : d.estado === 'atrasada' || d.estado === 'vencida'
            ? 'bg-[#c43e2c]/5 border-[#c43e2c]/30'
            : destacada
              ? 'bg-[#f9b44c]/15 border-[#f9b44c]'
              : 'bg-white border-[#e4c9b0]/60'
      )}
      aria-current={destacada ? 'true' : undefined}
    >
      <div className="flex items-start gap-3">
        <div className="shrink-0 w-12 text-center">
          <span className="block text-[#391511] font-bold tabular-nums">{formatoHora(tarea.hora)}</span>
          {tarea.duracion_min && (
            <span className="block text-[10px] text-[#c8a58a]">{formatoDuracion(tarea.duracion_min)}</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p
            className={cn(
              'text-[#391511] font-semibold leading-snug',
              hecha && 'line-through text-[#6f3a2a]',
              esBloque && 'italic'
            )}
          >
            {esBloque && '⏸ '}
            {tarea.titulo}
          </p>
          {tarea.descripcion && (
            <p className="text-[#6f3a2a] text-sm mt-0.5">{tarea.descripcion}</p>
          )}
          {tarea.checklist.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {tarea.checklist.map((c, i) => (
                <li key={i} className="text-[#6f3a2a] text-xs flex gap-1.5">
                  <span className="text-[#c8a58a]">▢</span>
                  {c}
                </li>
              ))}
            </ul>
          )}
          {esCobertura(tarea.notas) && (
            <p className="text-[#2f7d4f] text-xs font-semibold mt-0.5">↺ {tarea.notas}</p>
          )}
          {tarea.trasladada_de && (
            <p className="text-[#a06b00] text-xs font-semibold mt-0.5">↩ Viene del turno anterior</p>
          )}
          {grupal && !hecha && (
            <p className="flex items-center gap-1 text-[11px] text-[#a06b00] mt-1">
              <Users className="h-3 w-3" />
              Grupal: la cierra el primero que la hace.
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={cn('text-[10px] uppercase font-bold px-1.5 py-0.5 rounded', est.clase)}>
            {est.label}
            {d.atrasada && d.estado === 'en_curso' && ' · atrasada'}
          </span>
          {tarea.prioridad === 'alta' && (
            <span className={cn('text-[10px] uppercase font-bold px-1.5 py-0.5 rounded', PRIORIDAD_TAREA.alta.clase)}>
              Alta
            </span>
          )}
          {grupal && (
            <span className={cn('text-[10px] uppercase font-bold px-1.5 py-0.5 rounded', MODO_TAREA.grupal.clase)}>
              Grupal
            </span>
          )}
        </div>
      </div>

      {rechazada && (
        <div className="rounded-xl bg-[#c43e2c]/8 border border-[#c43e2c]/25 px-3 py-2">
          <p className="text-[#c43e2c] text-xs font-bold uppercase tracking-wide">Te la devolvieron</p>
          {tarea.motivo_rechazo && (
            <p className="text-[#6f3a2a] text-sm mt-0.5">“{tarea.motivo_rechazo}”</p>
          )}
        </div>
      )}

      {hecha ? (
        <div className="flex items-center gap-2 text-[#2f7d4f] text-sm font-medium">
          <CheckCircle2 className="h-5 w-5" />
          {grupal
            ? tarea.completada_por === empleadoId
              ? 'Completada por vos'
              : 'Completada por un compañero'
            : 'Completada'}
          {tarea.evidencia_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={tarea.evidencia_url} alt="Evidencia" className="h-10 w-10 rounded-lg object-cover ml-auto" />
          )}
        </div>
      ) : !abierta ? (
        <p className="text-xs text-[#6f3a2a]">
          {d.estado === 'trasladada' ? 'Trasladada al turno siguiente.' : `Omitida: “${tarea.motivo_omision ?? ''}”`}
        </p>
      ) : (
        <div className="space-y-2.5">
          {tarea.requiere_evidencia && (
            <SubirEvidencia value={evidencia} onChange={setEvidencia} disabled={ocupado} />
          )}
          <div className="flex gap-2">
            {tarea.estado !== 'en_curso' && !esBloque && (
              <Button
                variant="outline"
                onClick={() => iniciar.mutate(tarea.id)}
                disabled={ocupado}
                className="h-12 px-4 border-[#e4c9b0] bg-white text-[#391511] font-semibold gap-1.5"
              >
                <Play className="h-4 w-4" /> Iniciar
              </Button>
            )}
            <Button
              onClick={() => completar.mutate({ id: tarea.id, evidenciaUrl: evidencia })}
              disabled={ocupado || (tarea.requiere_evidencia && !evidencia)}
              className="flex-1 h-12 bg-[#2f7d4f] hover:bg-[#276b43] text-white font-bold text-base gap-2 disabled:opacity-50"
            >
              {completar.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
              {tarea.requiere_evidencia && !evidencia ? 'Sacá la foto primero' : esBloque ? 'Hecho' : 'Completar'}
            </Button>
          </div>
          {!esBloque && (
            <button
              type="button"
              onClick={() => setMostrarOmision((v) => !v)}
              className="text-xs text-[#6f3a2a] underline underline-offset-2"
            >
              No la puedo hacer (registrar impedimento)
            </button>
          )}
          {mostrarOmision && (
            <div className="space-y-2">
              <textarea
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                rows={2}
                placeholder="Contá qué pasó (mínimo 5 letras). Lo ve la encargada."
                className="w-full rounded-lg border border-[#e4c9b0] bg-white px-3 py-2 text-sm text-[#391511] placeholder:text-[#c8a58a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f9b44c]"
              />
              <Button
                variant="outline"
                onClick={() => omitir.mutate({ id: tarea.id, motivo: motivo.trim() })}
                disabled={ocupado || motivo.trim().length < 5}
                className="w-full border-[#c43e2c]/40 text-[#c43e2c] text-xs h-9"
              >
                Registrar impedimento y omitir
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Vista del empleado (desktop /rrhh/mis-tareas y /movil/tareas): su agenda
 * de hoy ordenada por hora, con lo que toca ahora arriba. Incluye las de la
 * noche de ayer si siguen abiertas (la noche termina después de medianoche).
 */
export function MisTareas({ empleadoId, nombre }: Props) {
  const [hoy] = useState(() => hoyAr())
  const [horaAhora, setHoraAhora] = useState(() => horaActualAr())
  useEffect(() => {
    const id = setInterval(() => setHoraAhora(horaActualAr()), 30_000)
    return () => clearInterval(id)
  }, [])
  const { data: tareas, isLoading } = useTareasAgenda(hoy)
  const { data: turnos } = useTurnos()
  const materializar = useMaterializar()
  const trasladar = useTrasladarTarea()
  const materializado = useRef(false)

  useEffect(() => {
    if (!materializado.current) {
      materializado.current = true
      materializar.mutate(hoy)
    }
  }, [hoy, materializar])

  const ayer = isoMasDias(hoy, -1)
  const reloj = useMemo(() => contextoReloj(hoy, hoy, horaAhora), [hoy, horaAhora])
  const turnoDe = (id: number | null) => (turnos ?? []).find((t) => t.id === id) ?? null

  const { lista, continuas, hechas, cerradas, porEntregar } = useMemo(() => {
    // RLS ya filtra a las del empleado logueado; tareaEsDe cubre además las
    // grupales donde participa (empleado_id null). De ayer solo la noche viva.
    const mias = (tareas ?? []).filter((t) => {
      if (!tareaEsDe(t, empleadoId)) return false
      if (t.fecha === hoy) return true
      const turno = turnoDe(t.turno_id)
      return !!turno?.cruza_medianoche && t.estado !== 'completada' && t.estado !== 'cancelada'
    })
    const items = ordenarCronologico(
      mias.map((t) => ({ tarea: t, derivado: estadoDerivado(t, turnoDe(t.turno_id), hoy, reloj) }))
    )
    const continuas = items.filter((x) => x.tarea.tipo_actividad === 'continua')
    const resto = items.filter((x) => x.tarea.tipo_actividad !== 'continua')
    const lista = resto.filter((x) => estaAbierta(x.derivado))
    const hechas = resto.filter((x) => x.derivado.estado === 'completada')
    const cerradas = resto.filter((x) => x.derivado.estado === 'omitida' || x.derivado.estado === 'trasladada')
    const porEntregar = lista.filter((x) => {
      const turno = turnoDe(x.tarea.turno_id)
      return !!turno && turnoPorTerminar(turno, x.tarea.fecha === ayer ? 'ayer' : 'hoy', reloj) && !x.tarea.trasladada_a
    })
    return { lista, continuas, hechas, cerradas, porEntregar }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tareas, empleadoId, turnos, reloj, hoy, ayer])

  const foco = focoDelTurno(lista)
  const total = lista.length + hechas.length
  const turnoActual = (turnos ?? []).find((t) => {
    const ini = t.hora_inicio.slice(0, 5)
    const fin = t.hora_fin.slice(0, 5)
    return t.activo && (t.cruza_medianoche ? horaAhora >= ini || horaAhora < fin : horaAhora >= ini && horaAhora < fin)
  })

  return (
    <div className="p-4 max-w-md mx-auto space-y-4">
      <header>
        <h1 className="text-[#391511] text-2xl font-bold">Mis tareas</h1>
        <p className="text-[#6f3a2a] text-sm capitalize">
          {format(parseISO(hoy), "EEEE d 'de' MMMM", { locale: es })}
          {turnoActual && (
            <span className="normal-case"> · turno {NOMBRE_TURNO[turnoActual.nombre].toLowerCase()} · {horaAhora}</span>
          )}
        </p>
        {total > 0 && (
          <p className="text-[#c8a58a] text-xs tabular-nums">
            {hechas.length} de {total} completadas
          </p>
        )}
      </header>

      {isLoading ? (
        <p className="text-[#c8a58a] text-sm text-center py-8">Cargando…</p>
      ) : lista.length === 0 && hechas.length === 0 && cerradas.length === 0 ? (
        <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-8 text-center">
          <p className="text-[#391511] font-semibold">No tenés tareas para hoy 🎉</p>
          <p className="text-[#6f3a2a] text-sm mt-1">Cuando te asignen, aparecen acá.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {foco && (
            <p className="text-[11px] tracking-wider font-bold text-[#6f3a2a] px-1">
              {foco.tipo === 'ahora'
                ? `AHORA · ${horaAhora}`
                : foco.tipo === 'atrasada'
                  ? 'ATRASADA'
                  : foco.tipo === 'proxima'
                    ? `PRÓXIMA · ${formatoHora(foco.item.tarea.hora)}`
                    : 'PENDIENTE'}
            </p>
          )}
          {continuas.length > 0 && (
            <p className="text-xs text-[#6f3a2a] px-1">
              <span className="font-semibold">Durante todo el turno:</span>{' '}
              {continuas.map((x) => x.tarea.titulo).join(' · ')}.
            </p>
          )}
          {lista.map((x) => (
            <TarjetaMiTarea
              key={x.tarea.id}
              item={x}
              empleadoId={empleadoId}
              destacada={foco?.item.tarea.id === x.tarea.id}
            />
          ))}

          {porEntregar.length > 0 && (
            <div className="rounded-2xl bg-[#fdfaf6] border border-[#f9b44c]/60 p-3 space-y-2">
              <p className="text-[#391511] text-sm font-bold flex items-center gap-1.5">
                <ArrowRightToLine className="h-4 w-4 text-[#a06b00]" />
                Tu turno termina: {porEntregar.length} sin completar
              </p>
              <p className="text-xs text-[#6f3a2a]">
                Podés pasarlas al turno siguiente; queda registrado que vienen de tu turno.
              </p>
              {porEntregar.map((x) => (
                <div key={x.tarea.id} className="flex items-center gap-2 text-sm">
                  <span className="flex-1 min-w-0 truncate text-[#391511]">{x.tarea.titulo}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (confirm(`¿Pasar “${x.tarea.titulo}” al turno siguiente?`)) trasladar.mutate(x.tarea.id)
                    }}
                    disabled={trasladar.isPending}
                    className="h-7 text-xs border-[#e4c9b0] text-[#6f3a2a]"
                  >
                    Trasladar
                  </Button>
                </div>
              ))}
            </div>
          )}

          {hechas.length > 0 && (
            <div className="pt-2 space-y-3">
              <p className="text-[#c8a58a] text-xs font-semibold uppercase tracking-wide">
                Completadas ({hechas.length})
              </p>
              {hechas.map((x) => (
                <TarjetaMiTarea key={x.tarea.id} item={x} empleadoId={empleadoId} />
              ))}
            </div>
          )}
          {cerradas.length > 0 && (
            <div className="pt-2 space-y-3">
              <p className="text-[#c8a58a] text-xs font-semibold uppercase tracking-wide">
                Omitidas / trasladadas ({cerradas.length})
              </p>
              {cerradas.map((x) => (
                <TarjetaMiTarea key={x.tarea.id} item={x} empleadoId={empleadoId} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
