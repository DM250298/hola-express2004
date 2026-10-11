'use client'

import { useMemo, useState } from 'react'
import { addDays, format, parseISO, startOfWeek } from 'date-fns'
import { es } from 'date-fns/locale'
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Inbox, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { SkeletonTabla } from '@/components/shared/SkeletonTabla'
import { useEmpleados } from '@/lib/hooks/useRrhh'
import { useTurnos } from '@/lib/hooks/useAsistencia'
import { usePasesPendientesRecibir, usePasesTurno } from '@/lib/hooks/usePaseTurno'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { fechaCortaLocal, nombreCompleto } from './constantes'
import { NOMBRE_TURNO, hoyAr } from './asistenciaConstantes'
import { BLOQUES_PASE, ESTADO_PASE, noConformes } from './paseTurnoConstantes'
import { FormPaseTurno } from './FormPaseTurno'
import { ModalIncidencia, type PrefillIncidencia } from './ModalIncidencia'
import { ModalRecibirPase } from './ModalRecibirPase'
import type { PaseTurnoRow } from '@/types/database'
import { cn } from '@/lib/utils'

function lunesDe(d: Date): string {
  return format(startOfWeek(d, { weekStartsOn: 1 }), 'yyyy-MM-dd')
}

/** Pestaña "Pase de turno" del hub Personal: historial semanal + acciones. */
export function TabPaseTurno() {
  const [inicio, setInicio] = useState(() => lunesDe(parseISO(hoyAr())))
  const fin = format(addDays(parseISO(inicio), 6), 'yyyy-MM-dd')
  const { data: pases, isLoading } = usePasesTurno(inicio, fin)
  const { data: pendientes } = usePasesPendientesRecibir()
  const { data: empleados } = useEmpleados()
  const { data: turnos } = useTurnos()
  const { data: usuario } = useUsuario()

  const [abierto, setAbierto] = useState<number | null>(null)
  const [entregando, setEntregando] = useState(false)
  const [recibiendo, setRecibiendo] = useState<PaseTurnoRow | null>(null)
  const [incidencia, setIncidencia] = useState<{ empleadoId: number; prefill: PrefillIncidencia } | null>(null)

  const nombrePorId = useMemo(() => {
    const m = new Map<number, string>()
    for (const e of empleados ?? []) m.set(e.id, nombreCompleto(e))
    return m
  }, [empleados])
  const nombreTurno = (id: number | null) => {
    const t = turnos?.find((x) => x.id === id)
    return t ? NOMBRE_TURNO[t.nombre] : '—'
  }
  // Legajo de quien está logueado (para que la encargada entregue/reciba a su nombre).
  const miEmpleadoId = useMemo(
    () => (empleados ?? []).find((e) => e.usuario_id === usuario?.id)?.id ?? null,
    [empleados, usuario]
  )

  const semanaLabel = `${format(parseISO(inicio), "d 'de' MMM", { locale: es })} – ${format(parseISO(fin), "d 'de' MMM", { locale: es })}`

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[#391511] text-lg font-bold">Pase de turno</h2>
          <p className="text-[#6f3a2a] text-sm">
            Reposición, orden y limpieza, novedades y pendientes. El entrante marca conforme / no conforme.
          </p>
        </div>
        <Button
          onClick={() => setEntregando(true)}
          className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5"
        >
          <Plus className="h-4 w-4" />
          Entregar pase
        </Button>
      </div>

      {(pendientes ?? []).length > 0 && (
        <div className="bg-[#f9b44c]/10 border border-[#f9b44c]/50 rounded-2xl p-4 space-y-2">
          <p className="text-[#391511] text-sm font-semibold flex items-center gap-2">
            <Inbox className="h-4 w-4" />
            {pendientes!.length} pase{pendientes!.length === 1 ? '' : 's'} sin recibir
          </p>
          <ul className="space-y-1">
            {pendientes!.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="text-[#6f3a2a]">
                  {fechaCortaLocal(p.fecha)} · {nombreTurno(p.turno_saliente_id)} → {nombreTurno(p.turno_entrante_id)} · {nombrePorId.get(p.saliente_empleado_id) ?? '—'}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setRecibiendo(p)}
                  disabled={p.saliente_empleado_id === miEmpleadoId}
                  className="h-7 border-[#e4c9b0] text-[#6f3a2a] text-xs"
                >
                  Recibir
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => setInicio(format(addDays(parseISO(inicio), -7), 'yyyy-MM-dd'))} className="h-8 w-8 p-0 text-[#6f3a2a]" aria-label="Semana anterior">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-[#391511] font-semibold text-sm min-w-[180px] text-center">{semanaLabel}</span>
        <Button variant="ghost" size="sm" onClick={() => setInicio(format(addDays(parseISO(inicio), 7), 'yyyy-MM-dd'))} className="h-8 w-8 p-0 text-[#6f3a2a]" aria-label="Semana siguiente">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl shadow-sm px-5 py-2">
        {isLoading ? (
          <div className="py-3">
            <SkeletonTabla filas={5} columnas={4} />
          </div>
        ) : (pases ?? []).length === 0 ? (
          <p className="text-[#c8a58a] text-sm text-center py-8">Sin pases de turno en esta semana.</p>
        ) : (
          <ul className="divide-y divide-[#e4c9b0]/40">
            {pases!.map((p) => {
              const nc = noConformes(p)
              const exp = abierto === p.id
              return (
                <li key={p.id} className="py-3">
                  <button
                    type="button"
                    onClick={() => setAbierto(exp ? null : p.id)}
                    className="w-full flex items-center gap-3 text-left"
                  >
                    <span className="text-[#c8a58a] text-xs tabular-nums w-20 shrink-0">{fechaCortaLocal(p.fecha)}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[#391511] text-sm font-semibold">
                        {nombreTurno(p.turno_saliente_id)} → {nombreTurno(p.turno_entrante_id)}
                      </span>
                      <span className="block text-[#6f3a2a] text-xs truncate">
                        {nombrePorId.get(p.saliente_empleado_id) ?? '—'}
                        {p.entrante_empleado_id != null && <> → {nombrePorId.get(p.entrante_empleado_id) ?? '—'}</>}
                      </span>
                    </span>
                    {p.estado === 'recibido' && (
                      <span className="flex gap-1 shrink-0" title={`${nc} no conforme(s)`}>
                        {[p.conforme_reposicion, p.conforme_orden, p.conforme_novedades, p.conforme_pendientes].map((c, i) => (
                          <span key={i} className={cn('h-2.5 w-2.5 rounded-full', c ? 'bg-[#2f7d4f]' : 'bg-[#c43e2c]')} />
                        ))}
                      </span>
                    )}
                    <span className={cn('text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full shrink-0', ESTADO_PASE[p.estado].clase)}>
                      {ESTADO_PASE[p.estado].label}
                    </span>
                    {exp ? <ChevronUp className="h-4 w-4 text-[#c8a58a] shrink-0" /> : <ChevronDown className="h-4 w-4 text-[#c8a58a] shrink-0" />}
                  </button>

                  {exp && (
                    <div className="mt-3 sm:ml-[92px] space-y-3">
                      {BLOQUES_PASE.map((b) => {
                        const conforme = p[b.conforme]
                        return (
                          <div key={b.clave} className="rounded-xl border border-[#e4c9b0]/60 p-3">
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <p className="text-[#c8a58a] text-xs font-semibold uppercase tracking-wide">{b.etiqueta}</p>
                              {conforme !== null && (
                                <span className={cn('text-[10px] font-bold uppercase', conforme ? 'text-[#2f7d4f]' : 'text-[#c43e2c]')}>
                                  {conforme ? 'Conforme' : 'No conforme'}
                                </span>
                              )}
                            </div>
                            <p className="text-[#391511] text-sm whitespace-pre-wrap">{p[b.clave] || '—'}</p>
                          </div>
                        )
                      })}
                      <div className="rounded-xl border border-[#e4c9b0]/60 p-3">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <p className="text-[#c8a58a] text-xs font-semibold uppercase tracking-wide">Pendientes</p>
                          {p.conforme_pendientes !== null && (
                            <span className={cn('text-[10px] font-bold uppercase', p.conforme_pendientes ? 'text-[#2f7d4f]' : 'text-[#c43e2c]')}>
                              {p.conforme_pendientes ? 'Conforme' : 'No conforme'}
                            </span>
                          )}
                        </div>
                        {p.pendientes.length === 0 ? (
                          <p className="text-[#c8a58a] text-sm">Sin pendientes.</p>
                        ) : (
                          <ul className="space-y-0.5">
                            {p.pendientes.map((x, i) => (
                              <li key={i} className="text-sm text-[#391511]">
                                • {x.texto}
                                <span className="text-[#6f3a2a]"> → {x.responsable_empleado_id != null ? nombrePorId.get(x.responsable_empleado_id) ?? '—' : 'sin responsable'}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      {p.observaciones_entrante && (
                        <p className="text-[#c43e2c] text-sm">
                          <span className="font-semibold">Observaciones del entrante:</span> {p.observaciones_entrante}
                        </p>
                      )}
                      <div className="flex gap-2 flex-wrap">
                        {p.estado === 'entregado' && (
                          <Button size="sm" variant="outline" onClick={() => setRecibiendo(p)} disabled={p.saliente_empleado_id === miEmpleadoId} className="border-[#e4c9b0] text-[#6f3a2a] h-8">
                            Recibir
                          </Button>
                        )}
                        {nc > 0 && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setIncidencia({
                                empleadoId: p.saliente_empleado_id,
                                prefill: {
                                  tipologiaCodigo: 'pase_turno_incompleto',
                                  fecha: p.fecha,
                                  turnoId: p.turno_saliente_id,
                                  descripcion: `Pase de turno ${nombreTurno(p.turno_saliente_id)} del ${fechaCortaLocal(p.fecha)} con ${nc} bloque(s) no conforme(s). ${p.observaciones_entrante ?? ''}`.trim(),
                                },
                              })
                            }
                            className="border-[#c43e2c]/40 text-[#c43e2c] h-8 gap-1"
                          >
                            <AlertTriangle className="h-3.5 w-3.5" />
                            Registrar incidencia
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <Dialog open={entregando} onOpenChange={setEntregando}>
        <DialogContent className="sm:max-w-xl p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
            <DialogTitle className="text-[#391511] text-lg">Entregar pase de turno</DialogTitle>
            <DialogDescription className="text-[#6f3a2a]">
              Podés cargarlo a tu nombre o a nombre de quien cerró el turno.
            </DialogDescription>
          </DialogHeader>
          <div className="px-6 py-5 max-h-[70vh] overflow-y-auto">
            {miEmpleadoId == null && (empleados ?? []).length === 0 ? (
              <p className="text-[#c8a58a] text-sm">Cargando empleados…</p>
            ) : (
              <FormPaseTurno
                salienteEmpleadoId={miEmpleadoId ?? (empleados ?? []).find((e) => e.activo)?.id ?? 0}
                puedeElegirSaliente
                onEntregado={() => setEntregando(false)}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ModalRecibirPase
        pase={recibiendo}
        onCerrar={() => setRecibiendo(null)}
        nombrePorId={nombrePorId}
        nombreTurno={nombreTurno}
        entranteEmpleadoId={miEmpleadoId}
      />

      <ModalIncidencia
        abierto={!!incidencia}
        onCambioAbierto={(v) => !v && setIncidencia(null)}
        empleadoIdFijo={incidencia?.empleadoId ?? null}
        prefill={incidencia?.prefill ?? null}
      />
    </div>
  )
}
