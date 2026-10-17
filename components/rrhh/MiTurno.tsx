'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { NOMBRE_TURNO, hoyAr } from './asistenciaConstantes'
import { horaActualAr } from './paseTurnoConstantes'
import { tareaEsDe } from './tareasConstantes'
import {
  cerradaSinHacer,
  contextoReloj,
  estadoDerivado,
  ordenarCronologico,
  turnoPorTerminar,
} from './tareasAgenda'
import { companerosTexto, minutosTarde, saludo, secciones } from './miTurnoLogica'
import { TarjetaTareaMovil } from './TarjetaTareaMovil'
import { NotificacionesCelular } from './NotificacionesCelular'
import { useTurnos } from '@/lib/hooks/useAsistencia'
import {
  useCompanerosTurno,
  useMaterializar,
  useRealtimeTareas,
  useTareasAgenda,
  useTrasladarTarea,
} from '@/lib/hooks/useTareas'
import { isoMasDias } from '@/lib/utils/periodos'
import { cn } from '@/lib/utils'

interface Props {
  empleadoId: number
  nombre: string
}

/**
 * Mi turno (Tareas v2, Etapa 6): lo que le toca al empleado hoy, pensado para
 * el celular. Arriba lo atrasado y lo de ahora con botones grandes; después lo
 * que está en curso, más tarde, todo el turno y lo que ya pasó. Cada uno ve
 * solo lo suyo (la base además no le deja ver otra cosa). Se actualiza en vivo.
 */
export function MiTurno({ empleadoId, nombre }: Props) {
  const [hoy] = useState(() => hoyAr())
  const [horaAhora, setHoraAhora] = useState(() => horaActualAr())
  const [verAtrasadas, setVerAtrasadas] = useState(false)
  const [verPasadas, setVerPasadas] = useState(false)
  useEffect(() => {
    const id = setInterval(() => setHoraAhora(horaActualAr()), 30_000)
    return () => clearInterval(id)
  }, [])

  useRealtimeTareas()
  const { data: tareas, isLoading } = useTareasAgenda(hoy)
  const { data: turnos } = useTurnos()
  const { data: companeros } = useCompanerosTurno(hoy)
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

  const { s, porEntregar } = useMemo(() => {
    // Solo lo suyo (también las grupales donde participa). De ayer, solo la noche que sigue abierta.
    const mias = (tareas ?? []).filter((t) => {
      if (!tareaEsDe(t, empleadoId)) return false
      if (t.fecha === hoy) return true
      return !!turnoDe(t.turno_id)?.cruza_medianoche && t.estado !== 'completada' && !cerradaSinHacer(t.estado)
    })
    const items = ordenarCronologico(
      mias.map((t) => ({ tarea: t, derivado: estadoDerivado(t, turnoDe(t.turno_id), hoy, reloj) }))
    )
    const s = secciones(items)
    const abiertas = [...s.atrasadas, ...s.ahora, ...s.enCurso, ...s.todoElTurno]
    const porEntregar = abiertas.filter((x) => {
      const turno = turnoDe(x.tarea.turno_id)
      return !!turno && turnoPorTerminar(turno, x.tarea.fecha === ayer ? 'ayer' : 'hoy', reloj) && !x.tarea.trasladada_a
    })
    return { s, porEntregar }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tareas, empleadoId, turnos, reloj, hoy, ayer])

  const turnoActual = (turnos ?? []).find((t) => {
    const ini = t.hora_inicio.slice(0, 5)
    const fin = t.hora_fin.slice(0, 5)
    return t.activo && (t.cruza_medianoche ? horaAhora >= ini || horaAhora < fin : horaAhora >= ini && horaAhora < fin)
  })
  const conQuien = companerosTexto(companeros ?? [], turnoActual?.id ?? null)
  const { hechas, total } = s.avance
  const nada = total === 0 && s.recordatorios.length === 0
  const [primeraAtrasada, ...otrasAtrasadas] = s.atrasadas
  const [primeraAhora, ...otrasAhora] = s.ahora

  return (
    <div className="mx-auto max-w-md space-y-5 p-4">
      <header className="space-y-2">
        <h1 className="text-2xl font-extrabold text-[#391511]">
          {saludo(horaAhora)}, {nombre.split(' ')[0]}
        </h1>
        <p className="text-sm text-[#6f3a2a]">
          {turnoActual ? `Turno ${NOMBRE_TURNO[turnoActual.nombre].toLowerCase()} · ` : ''}
          {horaAhora}
          {conQuien && <span className="block">{conQuien}</span>}
        </p>
        <NotificacionesCelular />
        {total > 0 && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs font-semibold text-[#6f3a2a]">
              <span>Tu avance de hoy</span>
              <span className="tabular-nums">{hechas} de {total} hechas</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-[#f3ece4]" role="progressbar" aria-label="Avance del día" aria-valuemin={0} aria-valuemax={total} aria-valuenow={hechas}>
              <div className="h-full rounded-full bg-[#2f7d4f] transition-all" style={{ width: `${(hechas / total) * 100}%` }} />
            </div>
          </div>
        )}
      </header>

      {isLoading ? (
        <p className="py-8 text-center text-sm text-[#c8a58a]">Cargando…</p>
      ) : nada ? (
        <div className="rounded-2xl border border-[#e4c9b0]/60 bg-white p-8 text-center">
          <p className="font-semibold text-[#391511]">No tenés tareas para hoy 🎉</p>
          <p className="mt-1 text-sm text-[#6f3a2a]">Cuando te asignen una, aparece acá.</p>
        </div>
      ) : (
        <>
          {primeraAtrasada && (
            <Seccion titulo="Atrasada" rojo>
              <TarjetaTareaMovil key={primeraAtrasada.tarea.id} item={primeraAtrasada} empleadoId={empleadoId} grande tono="rojo" minutosTarde={minutosTarde(primeraAtrasada, reloj.ahora)} />
              {otrasAtrasadas.length > 0 && (
                <>
                  <button type="button" onClick={() => setVerAtrasadas((v) => !v)} className="text-sm font-semibold text-[#a3271d] underline underline-offset-2">
                    {verAtrasadas ? 'Ocultar' : `Y ${otrasAtrasadas.length} ${otrasAtrasadas.length === 1 ? 'atrasada más' : 'atrasadas más'}`}
                  </button>
                  {verAtrasadas && otrasAtrasadas.map((x) => (
                    <TarjetaTareaMovil key={x.tarea.id} item={x} empleadoId={empleadoId} tono="rojo" minutosTarde={minutosTarde(x, reloj.ahora)} />
                  ))}
                </>
              )}
            </Seccion>
          )}

          {primeraAhora && (
            <Seccion titulo={`Ahora · ${horaAhora}`}>
              <TarjetaTareaMovil key={primeraAhora.tarea.id} item={primeraAhora} empleadoId={empleadoId} grande tono="ahora" />
              {otrasAhora.map((x) => <TarjetaTareaMovil key={x.tarea.id} item={x} empleadoId={empleadoId} tono="ahora" />)}
            </Seccion>
          )}

          {s.enCurso.length > 0 && (
            <Seccion titulo="En curso">
              {s.enCurso.map((x) => <TarjetaTareaMovil key={x.tarea.id} item={x} empleadoId={empleadoId} />)}
            </Seccion>
          )}

          {s.masTarde.length > 0 && (
            <Seccion titulo="Más tarde">
              {s.masTarde.map((x) => <TarjetaTareaMovil key={x.tarea.id} item={x} empleadoId={empleadoId} />)}
            </Seccion>
          )}

          {(s.todoElTurno.length > 0 || s.recordatorios.length > 0) && (
            <Seccion titulo="Todo el turno">
              {s.todoElTurno.map((x) => <TarjetaTareaMovil key={x.tarea.id} item={x} empleadoId={empleadoId} />)}
              {s.recordatorios.length > 0 && (
                <ul className="space-y-1 rounded-xl border border-dashed border-[#e4c9b0] bg-white/60 px-3 py-2.5 text-sm text-[#6f3a2a]">
                  {s.recordatorios.map((x) => (
                    <li key={x.tarea.id}>• {x.tarea.titulo}</li>
                  ))}
                  <li className="pt-1 text-[11px] text-[#8a6a5a]">Son recordatorios: no hace falta marcarlos.</li>
                </ul>
              )}
            </Seccion>
          )}

          {porEntregar.length > 0 && (
            <div className="space-y-2 rounded-2xl border border-[#f9b44c]/60 bg-[#fdfaf6] p-3">
              <p className="text-sm font-bold text-[#391511]">Tu turno está por terminar</p>
              <p className="text-xs text-[#6f3a2a]">Lo que no llegues a hacer lo podés pasar al turno siguiente; queda registrado.</p>
              {porEntregar.map((x) => (
                <div key={x.tarea.id} className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate text-[#391511]">{x.tarea.titulo}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (confirm(`¿Pasar “${x.tarea.titulo}” al turno siguiente?`)) trasladar.mutate(x.tarea.id)
                    }}
                    disabled={trasladar.isPending}
                    className="h-9 border-[#e4c9b0] text-xs text-[#6f3a2a]"
                  >
                    Pasar
                  </Button>
                </div>
              ))}
            </div>
          )}

          {s.yaPasaron.length > 0 && (
            <section className="space-y-2">
              <button
                type="button"
                onClick={() => setVerPasadas((v) => !v)}
                aria-expanded={verPasadas}
                className="flex w-full items-center justify-between px-1 text-xs font-bold uppercase tracking-wider text-[#6f3a2a]"
              >
                Ya pasaron ({s.yaPasaron.length})
                <ChevronDown className={cn('h-4 w-4 transition-transform', verPasadas && 'rotate-180')} />
              </button>
              {verPasadas && s.yaPasaron.map((x) => <TarjetaTareaMovil key={x.tarea.id} item={x} empleadoId={empleadoId} />)}
            </section>
          )}
        </>
      )}
    </div>
  )
}

function Seccion({ titulo, rojo, children }: { titulo: string; rojo?: boolean; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className={cn('px-1 text-xs font-bold uppercase tracking-wider', rojo ? 'text-[#a3271d]' : 'text-[#6f3a2a]')}>{titulo}</h2>
      {children}
    </section>
  )
}
