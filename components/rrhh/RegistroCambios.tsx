'use client'

import { useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { Loader2, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useEmpleados } from '@/lib/hooks/useRrhh'
import { useTurnos } from '@/lib/hooks/useAsistencia'
import {
  usePedidosPendientes,
  useRegistroCambios,
  useResolverPedidoConDeshacer,
} from '@/lib/hooks/useTareas'
import type { FiltroRegistro } from '@/lib/queries/tareas'
import { cn } from '@/lib/utils'
import { NOMBRE_TURNO, hoyAr } from './asistenciaConstantes'
import { nombreCompleto } from './constantes'
import { ResumenSemanal } from './ResumenSemanal'
import {
  QUE_PASO,
  agruparPorDia,
  cambiosLegibles,
  dondeFue,
  horaAr,
  lunesDe,
  quienFue,
  sumarDias,
  type ContextoRegistro,
} from './registroLogica'

const FILTROS: [FiltroRegistro, string][] = [
  ['todo', 'Todo'],
  ['rutina', 'Rutina'],
  ['agenda', 'Agenda del día'],
  ['por_otro', 'Marcadas por otro'],
  ['correcciones', 'Correcciones'],
  ['avisos', 'Avisos de atraso'],
]

const claseCampo = 'h-9 rounded-lg border border-[#e4c9b0] bg-white px-2.5 text-sm text-[#391511]'

/**
 * Tareas › Registro de cambios (Tareas v2, Etapa 5), solo administradores:
 * el resumen de la semana, los pedidos para aprobar (con deshacer) y todo lo
 * que pasó con las tareas, agrupado por día. Nadie puede editar ni borrar lo
 * que se muestra acá (la base lo impide).
 */
export function RegistroCambios() {
  const [hoy] = useState(() => hoyAr())
  const [lunes, setLunes] = useState(() => sumarDias(lunesDe(hoy), -7))
  const [filtro, setFiltro] = useState<FiltroRegistro>('todo')
  const [desde, setDesde] = useState(() => sumarDias(hoy, -6))
  const [hasta, setHasta] = useState(hoy)
  const [empleadoId, setEmpleadoId] = useState<number | null>(null)

  const { data: empleados } = useEmpleados()
  const { data: turnos } = useTurnos()
  const ctx: ContextoRegistro = useMemo(
    () => ({
      empleados: new Map((empleados ?? []).map((e) => [e.id, nombreCompleto(e)])),
      turnos: new Map((turnos ?? []).map((t) => [t.id, { nombre: NOMBRE_TURNO[t.nombre] ?? t.nombre, hora_inicio: t.hora_inicio }])),
    }),
    [empleados, turnos]
  )

  const consulta = useMemo(
    () => ({ desde: desde <= hasta ? desde : hasta, hasta, filtro, empleadoId }),
    [desde, hasta, filtro, empleadoId]
  )
  const registro = useRegistroCambios(consulta)
  const eventos = useMemo(() => registro.data?.pages.flat() ?? [], [registro.data])
  const dias = useMemo(() => agruparPorDia(eventos), [eventos])

  return (
    <div className="space-y-5">
      <p className="flex items-center gap-2 text-[13px] text-[#6f3a2a]">
        <Lock className="h-4 w-4" />
        Solo lo ven los administradores. Nadie puede editar ni borrar este registro, tampoco un administrador.
      </p>

      <ResumenSemanal hoy={hoy} lunes={lunes} onLunes={setLunes} ctx={ctx} />
      <Pedidos />

      <section aria-label="Eventos" className="rounded-2xl border border-[#e4c9b0]/60 bg-white p-4 space-y-4">
        <h3 className="text-base font-extrabold text-[#391511]">Todo lo que pasó</h3>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtro">
          {FILTROS.map(([v, l]) => (
            <button
              key={v}
              type="button"
              aria-pressed={filtro === v}
              onClick={() => setFiltro(v)}
              className={cn(
                'h-8 rounded-full border px-3 text-[13px] font-semibold',
                filtro === v ? 'border-[#391511] bg-[#391511] text-white' : 'border-[#e4c9b0] bg-white text-[#6f3a2a] hover:bg-[#fdfaf6]'
              )}
            >
              {l}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3 text-[13px]">
          <label className="space-y-1">
            <span className="block font-semibold text-[#391511]">Persona</span>
            <select
              value={empleadoId ?? ''}
              onChange={(e) => setEmpleadoId(e.target.value ? Number(e.target.value) : null)}
              className={claseCampo}
            >
              <option value="">Todas</option>
              {(empleados ?? []).filter((e) => e.activo).map((e) => (
                <option key={e.id} value={e.id}>{nombreCompleto(e)}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="block font-semibold text-[#391511]">Desde</span>
            <input type="date" value={desde} max={hasta} onChange={(e) => e.target.value && setDesde(e.target.value)} className={claseCampo} />
          </label>
          <label className="space-y-1">
            <span className="block font-semibold text-[#391511]">Hasta</span>
            <input type="date" value={hasta} max={hoy} onChange={(e) => e.target.value && setHasta(e.target.value)} className={claseCampo} />
          </label>
        </div>

        {registro.isLoading ? (
          <p className="flex items-center gap-2 text-sm text-[#6f3a2a]"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</p>
        ) : registro.error ? (
          <p className="text-sm text-[#a3271d]">No se pudo leer el registro: {(registro.error as Error).message}</p>
        ) : dias.length === 0 ? (
          <p className="text-sm text-[#8a6a5a]">No hay nada con esos filtros.</p>
        ) : (
          <div className="space-y-5">
            {dias.map((d) => (
              <div key={d.dia}>
                <h4 className="sticky top-0 z-10 bg-white py-1 text-[12px] font-bold uppercase tracking-wider text-[#6f3a2a] first-letter:uppercase">
                  {format(parseISO(d.dia), "EEEE d 'de' MMMM", { locale: es })}
                </h4>
                <ul className="divide-y divide-[#e4c9b0]/50 rounded-xl border border-[#e4c9b0]/60">
                  {d.eventos.map((ev) => {
                    const cambios = cambiosLegibles(ev, ctx)
                    const turno = ev.turno_id !== null ? ctx.turnos.get(ev.turno_id)?.nombre : null
                    return (
                      <li key={ev.id} className="px-3 py-2.5 text-[13px] space-y-1">
                        <p className="text-[#391511]">
                          <span className="tabular-nums text-[#8a6a5a] mr-2">{horaAr(ev.created_at)}</span>
                          <strong>{quienFue(ev, ctx)}</strong> · {QUE_PASO[ev.tipo] ?? ev.tipo}
                          {ev.titulo && <> · “{ev.titulo}”</>}
                          {ev.privada && (
                            <span className="ml-1.5 rounded bg-[#391511] px-1.5 py-0.5 text-[10px] font-bold text-white align-middle">Privada</span>
                          )}
                        </p>
                        <p className="text-[11.5px] text-[#8a6a5a]">
                          {dondeFue(ev)}
                          {ev.entidad === 'agenda' && ev.fecha && ` del ${ev.fecha.split('-').reverse().slice(0, 2).join('/')}`}
                          {turno && ` · ${turno}`}
                        </p>
                        {cambios.length > 0 && (
                          <ul className="space-y-0.5 pl-3 border-l-2 border-[#e4c9b0]">
                            {cambios.map((c, i) => (
                              <li key={i} className="text-[12.5px] text-[#6f3a2a]">
                                <span className="font-semibold text-[#391511]">{c.campo}:</span>{' '}
                                {c.antes !== null && c.despues !== null ? (
                                  <><span className="line-through decoration-[#c8a58a]">{c.antes}</span> → {c.despues}</>
                                ) : (
                                  c.despues ?? <span className="line-through decoration-[#c8a58a]">{c.antes}</span>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                        {ev.motivo && <p className="text-[12.5px] text-[#6f3a2a]">Motivo: “{ev.motivo}”</p>}
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
            {registro.hasNextPage && (
              <Button
                variant="outline"
                onClick={() => registro.fetchNextPage()}
                disabled={registro.isFetchingNextPage}
                className="w-full border-[#e4c9b0]"
              >
                {registro.isFetchingNextPage ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Cargar más'}
              </Button>
            )}
          </div>
        )}
      </section>
    </div>
  )
}

/** Pedidos de quitar de la rutina, con unos segundos para deshacer. */
function Pedidos() {
  const { data } = usePedidosPendientes()
  const { decidir, enEspera } = useResolverPedidoConDeshacer()
  const pedidos = (data ?? []).filter((p) => !enEspera.has(p.id))
  return (
    <section aria-label="Pedidos para aprobar" className="rounded-2xl border border-[#f3d395] bg-[#fff6e5] p-4 space-y-2.5">
      <h3 className="text-base font-extrabold text-[#4a3008]">Pedidos para aprobar ({pedidos.length})</h3>
      {pedidos.length === 0 ? (
        <p className="text-[13px] text-[#4a3008]">No hay pedidos pendientes.</p>
      ) : (
        pedidos.map((p) => (
          <div key={p.id} className="rounded-xl bg-white border border-[#f3d395] p-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[13px] text-[#391511] min-w-0">
              <strong>{p.pedido_por_nombre ?? 'La encargada'}</strong> pidió quitar de la rutina “
              {p.tareas_recurrentes?.titulo ?? 'una tarea'}”.
              {p.motivo && <span className="block text-[#6f3a2a] mt-0.5">“{p.motivo}”</span>}
            </p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => decidir(p.id, true)} className="bg-[#391511] hover:bg-[#2a0f0c] text-white">
                Aprobar
              </Button>
              <Button size="sm" variant="outline" onClick={() => decidir(p.id, false)} className="border-[#e4c9b0]">
                Rechazar
              </Button>
            </div>
          </div>
        ))
      )}
      <p className="text-[11px] text-[#6f3a2a]">Aprobar saca la tarea de la rutina desde mañana; no se borra.</p>
    </section>
  )
}
