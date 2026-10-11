'use client'

import { useEffect, useMemo, useState } from 'react'
import { addDays, format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { Loader2, Sparkles, Wand2 } from 'lucide-react'
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useEmpleados } from '@/lib/hooks/useRrhh'
import { useTurnos } from '@/lib/hooks/useAsistencia'
import { useGenerarCronograma, usePatrones } from '@/lib/hooks/useCronograma'
import type { ResultadoGeneracion } from '@/lib/queries/cronograma'
import { nombreCompleto } from './constantes'
import { ABREV_TURNO } from './asistenciaConstantes'
import { cn } from '@/lib/utils'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  /** Lunes de la semana que se está viendo (default del "desde"). */
  semanaInicio: string
}

const claseInput = 'border-[#e4c9b0] focus-visible:ring-[#f9b44c]'
const SIN = '__sin__'

/**
 * Genera el cronograma a partir de un patrón, en un rango, solo en las
 * celdas vacías. Primero muestra la previsualización (qué se crea, qué se
 * respeta), después aplica.
 */
export function ModalGenerarCronograma({ abierto, onCambioAbierto, semanaInicio }: Props) {
  const { data: patrones } = usePatrones()
  const { data: empleados } = useEmpleados()
  const { data: turnos } = useTurnos()
  const generar = useGenerarCronograma()

  const [patronId, setPatronId] = useState(SIN)
  const [desde, setDesde] = useState(semanaInicio)
  const [hasta, setHasta] = useState(format(addDays(parseISO(semanaInicio), 27), 'yyyy-MM-dd'))
  const [sobrescribir, setSobrescribir] = useState(false)
  const [preview, setPreview] = useState<ResultadoGeneracion | null>(null)

  const activos = useMemo(() => (patrones ?? []).filter((p) => p.activo), [patrones])

  useEffect(() => {
    if (!abierto) return
    setDesde(semanaInicio)
    setHasta(format(addDays(parseISO(semanaInicio), 27), 'yyyy-MM-dd'))
    setSobrescribir(false)
    setPreview(null)
    setPatronId((prev) => (prev !== SIN ? prev : activos[0] ? String(activos[0].id) : SIN))
  }, [abierto, semanaInicio, activos])

  // Cualquier cambio de parámetros invalida la previsualización.
  useEffect(() => {
    setPreview(null)
  }, [patronId, desde, hasta, sobrescribir])

  const nombrePorId = useMemo(() => {
    const m = new Map<number, string>()
    for (const e of empleados ?? []) m.set(e.id, nombreCompleto(e))
    return m
  }, [empleados])
  const abrevTurno = (id: number | null) => {
    const t = turnos?.find((x) => x.id === id)
    return t ? ABREV_TURNO[t.nombre] : ''
  }

  const itemsPatron: Record<string, string> = {
    [SIN]: 'Elegí un patrón',
    ...Object.fromEntries(activos.map((p) => [String(p.id), p.nombre])),
  }

  const dias = desde && hasta ? Math.round((parseISO(hasta).getTime() - parseISO(desde).getTime()) / 86400000) + 1 : 0
  const rangoOk = dias >= 1 && dias <= 91
  const procesando = generar.isPending
  const puedePrevisualizar = patronId !== SIN && rangoOk && !procesando

  // Resumen por empleado de la previsualización.
  const porEmpleado = useMemo(() => {
    if (!preview) return []
    const m = new Map<number, { crear: number; reemplazar: number; omitir: number; francos: number }>()
    for (const f of preview.filas) {
      const r = m.get(f.empleado_id) ?? { crear: 0, reemplazar: 0, omitir: 0, francos: 0 }
      r[f.accion]++
      if (f.estado === 'franco' && f.accion !== 'omitir') r.francos++
      m.set(f.empleado_id, r)
    }
    return [...m.entries()].sort((a, b) =>
      (nombrePorId.get(a[0]) ?? '').localeCompare(nombrePorId.get(b[0]) ?? '', 'es')
    )
  }, [preview, nombrePorId])

  // Primera semana del rango, para ver la rotación de un vistazo.
  const primeraSemana = useMemo(() => {
    if (!preview) return []
    const fin = format(addDays(parseISO(desde), 6), 'yyyy-MM-dd')
    return preview.filas.filter((f) => f.fecha <= fin)
  }, [preview, desde])
  const diasPrimera = useMemo(
    () => Array.from({ length: Math.min(7, dias) }, (_, i) => format(addDays(parseISO(desde), i), 'yyyy-MM-dd')),
    [desde, dias]
  )

  function previsualizar() {
    generar.mutate(
      { patronId: Number(patronId), desde, hasta, sobrescribir, aplicar: false },
      { onSuccess: (r) => setPreview(r) }
    )
  }
  function aplicar() {
    generar.mutate(
      { patronId: Number(patronId), desde, hasta, sobrescribir, aplicar: true },
      { onSuccess: () => onCambioAbierto(false) }
    )
  }

  return (
    <Dialog open={abierto} onOpenChange={(v) => !procesando && onCambioAbierto(v)}>
      <DialogContent className="sm:max-w-2xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <DialogTitle className="text-[#391511] text-lg flex items-center gap-2">
            <Wand2 className="h-5 w-5 text-[#f9b44c]" />
            Generar cronograma
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            Completa solo las celdas vacías del rango. Licencias, cambios y francos cargados a mano se respetan.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-5 space-y-4 max-h-[64vh] overflow-y-auto">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="space-y-1.5 col-span-2">
              <Label className="text-[#391511] font-medium text-sm">Patrón</Label>
              <Select items={itemsPatron} value={patronId} onValueChange={(v) => setPatronId(v ?? SIN)} disabled={procesando}>
                <SelectTrigger className={`w-full ${claseInput}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(itemsPatron).map(([v, l]) => (
                    <SelectItem key={v} value={v}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {activos.length === 0 && (
                <p className="text-[#c43e2c] text-[11px]">No hay patrones activos. Crealos desde "Patrones".</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">Desde</Label>
              <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} disabled={procesando} className={`${claseInput} tabular-nums`} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">Hasta</Label>
              <Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} disabled={procesando} className={`${claseInput} tabular-nums`} />
              <p className={cn('text-[11px]', rangoOk ? 'text-[#c8a58a]' : 'text-[#c43e2c]')}>
                {rangoOk ? `${dias} día${dias === 1 ? '' : 's'}` : 'Entre 1 día y 13 semanas.'}
              </p>
            </div>
          </div>

          <label className="flex items-start gap-2 text-sm text-[#391511] cursor-pointer">
            <input
              type="checkbox"
              checked={sobrescribir}
              onChange={(e) => setSobrescribir(e.target.checked)}
              disabled={procesando}
              className="mt-0.5 accent-[#f9b44c]"
            />
            <span>
              Reemplazar lo que ya generó este mismo patrón
              <span className="block text-[#c8a58a] text-xs">
                Útil si cambiaste el orden o el pivote. Nunca toca lo cargado a mano.
              </span>
            </span>
          </label>

          {!preview ? (
            <Button
              onClick={previsualizar}
              disabled={!puedePrevisualizar}
              variant="outline"
              className="w-full border-[#e4c9b0] text-[#6f3a2a] gap-1.5"
            >
              {procesando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Previsualizar
            </Button>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <Kpi label="Se crean" valor={preview.creados} clase="text-[#2f7d4f]" />
                <Kpi label="Se reemplazan" valor={preview.reemplazados} clase="text-[#e4a42a]" />
                <Kpi label="Se respetan" valor={preview.omitidos} clase="text-[#6f3a2a]" />
              </div>

              {diasPrimera.length > 0 && (
                <div className="rounded-xl border border-[#e4c9b0]/60 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-[#fdfaf6]">
                      <tr>
                        <th className="text-left px-2 py-1.5 text-[#391511]">Primera semana</th>
                        {diasPrimera.map((d) => (
                          <th key={d} className="px-1 py-1.5 text-center text-[#6f3a2a] font-semibold">
                            {format(parseISO(d), 'EEEEEE d', { locale: es })}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {porEmpleado.map(([empId]) => (
                        <tr key={empId} className="border-t border-[#e4c9b0]/40">
                          <td className="px-2 py-1 text-[#391511] whitespace-nowrap">{nombrePorId.get(empId) ?? `#${empId}`}</td>
                          {diasPrimera.map((d) => {
                            const f = primeraSemana.find((x) => x.empleado_id === empId && x.fecha === d)
                            return (
                              <td key={d} className="px-1 py-1 text-center">
                                {f ? (
                                  <span
                                    title={f.notas ?? undefined}
                                    className={cn(
                                      'inline-block min-w-[26px] rounded px-1 font-bold',
                                      f.accion === 'omitir'
                                        ? 'bg-[#f3ece4] text-[#c8a58a] line-through'
                                        : f.estado === 'franco'
                                          ? 'bg-[#c43e2c]/10 text-[#c43e2c]'
                                          : f.notas
                                            ? 'bg-[#2f7d4f]/15 text-[#2f7d4f]'
                                            : 'bg-[#f9d2a2]/40 text-[#391511]'
                                    )}
                                  >
                                    {f.estado === 'franco' ? 'F' : abrevTurno(f.turno_id)}
                                    {f.notas ? '*' : ''}
                                  </span>
                                ) : (
                                  '—'
                                )}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="px-2 py-1.5 text-[10px] text-[#c8a58a]">
                    F = franco · * = cubre a otro · tachado = ya estaba cargado, se respeta
                  </p>
                </div>
              )}

              <ul className="text-xs text-[#6f3a2a] space-y-0.5">
                {porEmpleado.map(([empId, r]) => (
                  <li key={empId} className="flex justify-between gap-2">
                    <span className="truncate">{nombrePorId.get(empId) ?? `#${empId}`}</span>
                    <span className="tabular-nums shrink-0">
                      {r.francos} franco{r.francos === 1 ? '' : 's'} · {r.crear + r.reemplazar} días
                      {r.omitir > 0 && <span className="text-[#c8a58a]"> · {r.omitir} respetados</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="border-t border-[#e4c9b0]/60 bg-[#fdfaf6] px-6 py-4 flex gap-2">
          <Button variant="outline" onClick={() => onCambioAbierto(false)} disabled={procesando} className="flex-1 border-[#e4c9b0] text-[#6f3a2a]">
            Cancelar
          </Button>
          <Button
            onClick={aplicar}
            disabled={!preview || procesando || preview.creados + preview.reemplazados === 0}
            className="flex-[2] bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-bold disabled:opacity-50"
          >
            {procesando ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generando…
              </>
            ) : preview ? (
              `Aplicar (${preview.creados + preview.reemplazados})`
            ) : (
              'Aplicar'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Kpi({ label, valor, clase }: { label: string; valor: number; clase: string }) {
  return (
    <div className="rounded-xl border border-[#e4c9b0]/60 bg-white p-2.5 text-center">
      <p className={cn('text-xl font-bold tabular-nums', clase)}>{valor}</p>
      <p className="text-[10px] uppercase tracking-wide text-[#c8a58a] font-semibold">{label}</p>
    </div>
  )
}
