'use client'

import { useEffect, useMemo, useState } from 'react'
import { addDays, format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { AlertTriangle, Copy, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { NOMBRE_TURNO } from './asistenciaConstantes'
import { nombreCompleto } from './constantes'
import type { EmpleadoCrono } from './cronogramaCalculos'
import { useCopiarSemana, usePreviewCopiaSemana } from '@/lib/hooks/useAsistencia'
import { cn } from '@/lib/utils'
import type { FilaCopiaSemana } from '@/lib/queries/asistencia'
import type { HorarioAsignadoRow, TurnoPlantillaRow } from '@/types/database'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  /** Lunes de la semana origen y destino (yyyy-MM-dd). */
  desde: string
  hacia: string
  hoy: string
  empleadoPorId: Map<number, EmpleadoCrono>
  turnoPorId: Map<number, TurnoPlantillaRow>
}

function rango(lunes: string): string {
  return `${format(parseISO(lunes), 'd MMM', { locale: es })} – ${format(addDays(parseISO(lunes), 6), 'd MMM', { locale: es })}`
}

function describir(
  f: Pick<FilaCopiaSemana, 'estado' | 'turno_id'> | HorarioAsignadoRow,
  turnoPorId: Map<number, TurnoPlantillaRow>
): string {
  if (f.estado === 'franco') return 'Franco'
  if (f.estado === 'licencia') return 'Licencia'
  const t = f.turno_id ? turnoPorId.get(f.turno_id) : undefined
  return t ? NOMBRE_TURNO[t.nombre] : f.estado
}

/**
 * "Copiar semana anterior" con previsualización: muestra qué se crea y qué
 * pisaría filas existentes antes de escribir. Por defecto NO pisa nada.
 */
export function ModalCopiarSemana({ abierto, onCambioAbierto, desde, hacia, hoy, empleadoPorId, turnoPorId }: Props) {
  const { data: preview, isLoading } = usePreviewCopiaSemana(desde, hacia, abierto)
  const copiar = useCopiarSemana()
  const [reemplazar, setReemplazar] = useState(false)
  const [entiendoHistorico, setEntiendoHistorico] = useState(false)

  useEffect(() => {
    if (abierto) {
      setReemplazar(false)
      setEntiendoHistorico(false)
    }
  }, [abierto])

  const lunesHoy = useMemo(() => {
    const d = parseISO(hoy)
    const dow = (d.getDay() + 6) % 7 // 0 = lunes
    return format(addDays(d, -dow), 'yyyy-MM-dd')
  }, [hoy])
  const esHistorica = hacia < lunesHoy

  const filas = useMemo(() => {
    if (!preview) return []
    return reemplazar ? [...preview.crear, ...preview.pisar] : preview.crear
  }, [preview, reemplazar])

  const puedeCopiar =
    !!preview && filas.length > 0 && !copiar.isPending && (!esHistorica || entiendoHistorico)

  const nombre = (id: number) => {
    const e = empleadoPorId.get(id)
    return e ? nombreCompleto(e) : `#${id}`
  }

  return (
    <Dialog open={abierto} onOpenChange={(v) => !copiar.isPending && onCambioAbierto(v)}>
      <DialogContent className="sm:max-w-xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <DialogTitle className="text-[#391511] text-lg flex items-center gap-2">
            <Copy className="h-5 w-5 text-[#f9b44c]" />
            Copiar semana anterior
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            {rango(desde)} → <b className="text-[#391511]">{rango(hacia)}</b>. Las notas de cobertura
            (“Cubre a…”) no se copian: son de un día concreto.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-5 space-y-4 max-h-[60vh] overflow-y-auto">
          {isLoading || !preview ? (
            <p className="text-[#c8a58a] text-sm flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Leyendo las dos semanas…
            </p>
          ) : preview.crear.length + preview.pisar.length === 0 ? (
            <p className="text-[#6f3a2a] text-sm">La semana anterior no tiene horarios cargados.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Kpi label="Se crean" valor={preview.crear.length} clase="text-[#2f7d4f]" />
                <Kpi label="Ya existen en destino" valor={preview.pisar.length} clase="text-[#a06b00]" />
              </div>

              {preview.pisar.length > 0 && (
                <div className="space-y-2">
                  <label className="flex items-start gap-2 text-sm text-[#391511] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={reemplazar}
                      onChange={(e) => setReemplazar(e.target.checked)}
                      disabled={copiar.isPending}
                      className="mt-0.5 accent-[#f9b44c]"
                    />
                    <span>
                      Reemplazar las {preview.pisar.length} que ya existen
                      <span className="block text-[#c8a58a] text-xs">Apagado: se respetan tal como están.</span>
                    </span>
                  </label>
                  <ul className="rounded-xl border border-[#e4c9b0]/60 divide-y divide-[#e4c9b0]/40 text-xs max-h-48 overflow-y-auto">
                    {preview.pisar.map((f) => (
                      <li key={`${f.empleado_id}|${f.fecha}`} className={cn('flex items-center gap-2 px-3 py-1.5', !reemplazar && 'opacity-60')}>
                        <span className="flex-1 truncate text-[#391511]">{nombre(f.empleado_id)}</span>
                        <span className="text-[#c8a58a] tabular-nums">{format(parseISO(f.fecha), 'EEE d', { locale: es })}</span>
                        <span className="text-[#6f3a2a]">
                          {f.existente ? describir(f.existente, turnoPorId) : '—'} → <b>{describir(f, turnoPorId)}</b>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {esHistorica && (
                <label className="flex items-start gap-2 rounded-lg bg-[#e0a100]/15 px-3 py-2 text-xs text-[#a06b00] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={entiendoHistorico}
                    onChange={(e) => setEntiendoHistorico(e.target.checked)}
                    className="mt-0.5 accent-[#f9b44c]"
                  />
                  <span className="flex items-start gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    Es una semana pasada: entiendo que modifico planificación histórica (la asistencia de esos días se recalcula).
                  </span>
                </label>
              )}
            </>
          )}
        </div>

        <div className="border-t border-[#e4c9b0]/60 bg-[#fdfaf6] px-6 py-4 flex gap-2">
          <Button variant="outline" onClick={() => onCambioAbierto(false)} disabled={copiar.isPending} className="flex-1 border-[#e4c9b0] text-[#6f3a2a]">
            Cancelar
          </Button>
          <Button
            onClick={() => copiar.mutate(filas, { onSuccess: () => onCambioAbierto(false) })}
            disabled={!puedeCopiar}
            className="flex-[2] bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-bold disabled:opacity-50"
          >
            {copiar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : `Copiar (${filas.length})`}
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
