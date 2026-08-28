'use client'

import { Fragment, useMemo, useState } from 'react'
import {
  endOfMonth,
  format,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns'
import { es } from 'date-fns/locale'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SkeletonTabla } from '@/components/shared/SkeletonTabla'
import { nombreCompleto } from './constantes'
import { hoyAr } from './asistenciaConstantes'
import { ESTADO_TAREA, MODO_TAREA, tareaEsDe } from './tareasConstantes'
import { useEmpleados } from '@/lib/hooks/useRrhh'
import { useCumplimiento, useTareasRango } from '@/lib/hooks/useTareas'
import { cn } from '@/lib/utils'
import type { CumplimientoEmpleado, CumplimientoTarea } from '@/lib/queries/tareas'

type Preset = 'semana' | 'mes' | 'mes_pasado' | 'custom'

function clasePct(pct: number | null): string {
  if (pct === null) return 'bg-[#c8a58a]'
  if (pct >= 80) return 'bg-[#2f7d4f]'
  if (pct >= 50) return 'bg-[#f9b44c]'
  return 'bg-[#c43e2c]'
}

function BarraPct({ pct }: { pct: number | null }) {
  return (
    <div className="flex items-center gap-2 min-w-[110px]">
      <div className="h-2 flex-1 rounded-full bg-[#e4c9b0]/40 overflow-hidden">
        <div
          className={cn('h-full rounded-full', clasePct(pct))}
          style={{ width: `${pct ?? 0}%` }}
        />
      </div>
      <span className="text-xs tabular-nums text-[#391511] font-semibold w-11 text-right">
        {pct === null ? '—' : `${pct}%`}
      </span>
    </div>
  )
}

export function TabCumplimiento() {
  const hoy = hoyAr()
  const [preset, setPreset] = useState<Preset>('semana')
  const [desdeCustom, setDesdeCustom] = useState(hoy)
  const [hastaCustom, setHastaCustom] = useState(hoy)
  const [detalleEmpleado, setDetalleEmpleado] = useState<number | null>(null)
  const [detalleTarea, setDetalleTarea] = useState<CumplimientoTarea | null>(null)

  const { desde, hasta } = useMemo(() => {
    const d = parseISO(hoy)
    switch (preset) {
      case 'semana':
        return {
          desde: format(startOfWeek(d, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
          hasta: hoy,
        }
      case 'mes':
        return { desde: format(startOfMonth(d), 'yyyy-MM-dd'), hasta: hoy }
      case 'mes_pasado': {
        const m = subMonths(d, 1)
        return {
          desde: format(startOfMonth(m), 'yyyy-MM-dd'),
          hasta: format(endOfMonth(m), 'yyyy-MM-dd'),
        }
      }
      default:
        return { desde: desdeCustom, hasta: hastaCustom }
    }
  }, [preset, hoy, desdeCustom, hastaCustom])

  const rangoValido = desde <= hasta
  const { data, isLoading } = useCumplimiento(rangoValido ? desde : '', rangoValido ? hasta : '')
  const { data: empleados } = useEmpleados()
  const nombrePorId = useMemo(() => {
    const m = new Map<number, string>()
    for (const e of empleados ?? []) m.set(e.id, nombreCompleto(e))
    return m
  }, [empleados])

  // Drill-down: instancias del rango (una sola query, se filtra en cliente
  // para el empleado; por plantilla/título filtra el server).
  const { data: detalleTareas } = useTareasRango(
    desde,
    hasta,
    detalleTarea
      ? detalleTarea.plantilla_id
        ? { plantillaId: detalleTarea.plantilla_id }
        : { plantillaId: null, titulo: detalleTarea.titulo }
      : undefined,
    rangoValido && (detalleEmpleado !== null || detalleTarea !== null)
  )

  const detalleFilasEmpleado = useMemo(() => {
    if (detalleEmpleado === null) return []
    return (detalleTareas ?? []).filter(
      (t) =>
        tareaEsDe(t, detalleEmpleado) ||
        (t.empleado_id === null && t.completada_por === detalleEmpleado)
    )
  }, [detalleTareas, detalleEmpleado])

  const presets: { clave: Preset; label: string }[] = [
    { clave: 'semana', label: 'Esta semana' },
    { clave: 'mes', label: 'Este mes' },
    { clave: 'mes_pasado', label: 'Mes pasado' },
    { clave: 'custom', label: 'Elegir fechas' },
  ]

  return (
    <div className="space-y-4">
      {/* Rango */}
      <div className="flex items-center gap-2 flex-wrap">
        {presets.map((p) => (
          <Button
            key={p.clave}
            variant="outline"
            size="sm"
            onClick={() => setPreset(p.clave)}
            className={cn(
              'h-8 text-xs border-[#e4c9b0]',
              preset === p.clave
                ? 'bg-[#f9b44c]/20 text-[#391511] font-semibold border-[#f9b44c]'
                : 'text-[#6f3a2a]'
            )}
          >
            {p.label}
          </Button>
        ))}
        {preset === 'custom' && (
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={desdeCustom}
              onChange={(e) => setDesdeCustom(e.target.value)}
              className="h-8 w-36 text-xs border-[#e4c9b0] tabular-nums"
            />
            <span className="text-[#c8a58a] text-xs">→</span>
            <Input
              type="date"
              value={hastaCustom}
              onChange={(e) => setHastaCustom(e.target.value)}
              className="h-8 w-36 text-xs border-[#e4c9b0] tabular-nums"
            />
          </div>
        )}
        <span className="text-[#c8a58a] text-xs ml-auto capitalize">
          {rangoValido
            ? `${format(parseISO(desde), "d MMM", { locale: es })} – ${format(parseISO(hasta), "d MMM yyyy", { locale: es })}`
            : 'Rango inválido'}
        </span>
      </div>

      {isLoading ? (
        <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-6">
          <SkeletonTabla filas={5} columnas={5} />
        </div>
      ) : (
        <>
          {/* Por empleado */}
          <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden shadow-sm">
            <div className="px-4 py-3 border-b border-[#e4c9b0]/40 bg-[#fdfaf6]">
              <h3 className="text-[#391511] font-bold text-sm">Cumplimiento por empleado</h3>
              <p className="text-[#c8a58a] text-xs">
                Las grupales le cuentan solo a quien las hizo; no penalizan al resto.
              </p>
            </div>
            {(data?.por_empleado ?? []).length === 0 ? (
              <p className="p-8 text-center text-[#c8a58a] text-sm">
                Sin tareas en el período.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[#c8a58a] text-xs uppercase tracking-wide">
                      <th className="text-left px-4 py-2 font-semibold">Empleado</th>
                      <th className="text-right px-2 py-2 font-semibold">Asignadas</th>
                      <th className="text-right px-2 py-2 font-semibold">Hechas</th>
                      <th className="text-right px-2 py-2 font-semibold">Vencidas</th>
                      <th className="text-right px-2 py-2 font-semibold">Rechazos</th>
                      <th className="text-left px-4 py-2 font-semibold">Cumplimiento</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e4c9b0]/40">
                    {(data?.por_empleado ?? []).map((e: CumplimientoEmpleado) => (
                      <Fragment key={e.empleado_id}>
                        <tr
                          onClick={() => {
                            setDetalleTarea(null)
                            setDetalleEmpleado(
                              detalleEmpleado === e.empleado_id ? null : e.empleado_id
                            )
                          }}
                          className="cursor-pointer hover:bg-[#fdfaf6]"
                        >
                          <td className="px-4 py-2.5 text-[#391511] font-medium">
                            <span className="flex items-center gap-1.5">
                              {detalleEmpleado === e.empleado_id ? (
                                <ChevronUp className="h-3.5 w-3.5 text-[#c8a58a]" />
                              ) : (
                                <ChevronDown className="h-3.5 w-3.5 text-[#c8a58a]" />
                              )}
                              {e.nombre} {e.apellido}
                            </span>
                          </td>
                          <td className="px-2 py-2.5 text-right tabular-nums text-[#6f3a2a]">{e.asignadas}</td>
                          <td className="px-2 py-2.5 text-right tabular-nums text-[#2f7d4f] font-semibold">{e.completadas}</td>
                          <td className={cn('px-2 py-2.5 text-right tabular-nums', e.vencidas > 0 ? 'text-[#c43e2c] font-semibold' : 'text-[#c8a58a]')}>{e.vencidas}</td>
                          <td className={cn('px-2 py-2.5 text-right tabular-nums', e.rechazos > 0 ? 'text-[#c43e2c] font-semibold' : 'text-[#c8a58a]')}>{e.rechazos}</td>
                          <td className="px-4 py-2.5"><BarraPct pct={e.pct} /></td>
                        </tr>
                        {detalleEmpleado === e.empleado_id && (
                          <tr>
                            <td colSpan={6} className="bg-[#fdfaf6] px-6 py-3">
                              {detalleFilasEmpleado.length === 0 ? (
                                <p className="text-[#c8a58a] text-xs">Cargando detalle…</p>
                              ) : (
                                <ul className="space-y-1.5">
                                  {detalleFilasEmpleado.map((t) => (
                                    <li key={t.id} className="flex items-center gap-2 text-xs">
                                      <span className="text-[#c8a58a] tabular-nums w-16">
                                        {format(parseISO(t.fecha), 'd MMM', { locale: es })}
                                      </span>
                                      <span className="flex-1 text-[#391511] truncate">{t.titulo}</span>
                                      {t.empleado_id === null && (
                                        <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded', MODO_TAREA.grupal.clase)}>
                                          Grupal
                                        </span>
                                      )}
                                      {t.rechazos_count > 0 && (
                                        <span className="text-[10px] font-bold text-[#c43e2c]">
                                          ×{t.rechazos_count} rech.
                                        </span>
                                      )}
                                      <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full', ESTADO_TAREA[t.estado].clase)}>
                                        {ESTADO_TAREA[t.estado].label}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Por tarea */}
          <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden shadow-sm">
            <div className="px-4 py-3 border-b border-[#e4c9b0]/40 bg-[#fdfaf6]">
              <h3 className="text-[#391511] font-bold text-sm">Cumplimiento por tarea</h3>
              <p className="text-[#c8a58a] text-xs">
                Acá sí se ve la grupal que quedó sin hacer (venció sin que nadie la tome).
              </p>
            </div>
            {(data?.por_tarea ?? []).length === 0 ? (
              <p className="p-8 text-center text-[#c8a58a] text-sm">
                Sin tareas en el período.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[#c8a58a] text-xs uppercase tracking-wide">
                      <th className="text-left px-4 py-2 font-semibold">Tarea</th>
                      <th className="text-right px-2 py-2 font-semibold">Total</th>
                      <th className="text-right px-2 py-2 font-semibold">Hechas</th>
                      <th className="text-right px-2 py-2 font-semibold">Vencidas</th>
                      <th className="text-right px-2 py-2 font-semibold">Pendientes</th>
                      <th className="text-right px-2 py-2 font-semibold">Rechazos</th>
                      <th className="text-left px-4 py-2 font-semibold">Cumplimiento</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e4c9b0]/40">
                    {(data?.por_tarea ?? []).map((t: CumplimientoTarea) => {
                      const clave = t.plantilla_id ?? `unica-${t.titulo}`
                      const abierta =
                        detalleTarea !== null &&
                        (detalleTarea.plantilla_id ?? `unica-${detalleTarea.titulo}`) === clave
                      return (
                        <Fragment key={clave}>
                          <tr
                            onClick={() => {
                              setDetalleEmpleado(null)
                              setDetalleTarea(abierta ? null : t)
                            }}
                            className="cursor-pointer hover:bg-[#fdfaf6]"
                          >
                            <td className="px-4 py-2.5 text-[#391511] font-medium">
                              <span className="flex items-center gap-1.5">
                                {abierta ? (
                                  <ChevronUp className="h-3.5 w-3.5 text-[#c8a58a]" />
                                ) : (
                                  <ChevronDown className="h-3.5 w-3.5 text-[#c8a58a]" />
                                )}
                                <span className="truncate max-w-[240px]">{t.titulo}</span>
                                <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0', MODO_TAREA[t.modo].clase)}>
                                  {MODO_TAREA[t.modo].label}
                                </span>
                              </span>
                            </td>
                            <td className="px-2 py-2.5 text-right tabular-nums text-[#6f3a2a]">{t.total}</td>
                            <td className="px-2 py-2.5 text-right tabular-nums text-[#2f7d4f] font-semibold">{t.completadas}</td>
                            <td className={cn('px-2 py-2.5 text-right tabular-nums', t.vencidas > 0 ? 'text-[#c43e2c] font-semibold' : 'text-[#c8a58a]')}>{t.vencidas}</td>
                            <td className="px-2 py-2.5 text-right tabular-nums text-[#a06b00]">{t.pendientes}</td>
                            <td className={cn('px-2 py-2.5 text-right tabular-nums', t.rechazos > 0 ? 'text-[#c43e2c] font-semibold' : 'text-[#c8a58a]')}>{t.rechazos}</td>
                            <td className="px-4 py-2.5"><BarraPct pct={t.pct} /></td>
                          </tr>
                          {abierta && (
                            <tr>
                              <td colSpan={7} className="bg-[#fdfaf6] px-6 py-3">
                                {!detalleTareas ? (
                                  <p className="text-[#c8a58a] text-xs">Cargando detalle…</p>
                                ) : (
                                  <ul className="space-y-1.5">
                                    {detalleTareas.map((d) => (
                                      <li key={d.id} className="flex items-center gap-2 text-xs">
                                        <span className="text-[#c8a58a] tabular-nums w-16">
                                          {format(parseISO(d.fecha), 'd MMM', { locale: es })}
                                        </span>
                                        <span className="flex-1 text-[#391511] truncate">
                                          {d.empleado_id !== null
                                            ? nombrePorId.get(d.empleado_id) ?? '—'
                                            : d.completada_por != null
                                              ? `Grupal · la hizo ${nombrePorId.get(d.completada_por) ?? '—'}`
                                              : 'Grupal · sin tomar'}
                                        </span>
                                        {d.rechazos_count > 0 && (
                                          <span className="text-[10px] font-bold text-[#c43e2c]">
                                            ×{d.rechazos_count} rech.
                                          </span>
                                        )}
                                        <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full', ESTADO_TAREA[d.estado].clase)}>
                                          {ESTADO_TAREA[d.estado].label}
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
