'use client'

import { useEffect, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  ESTADO_ASISTENCIA,
  NOMBRE_TURNO,
  capitalizar,
  formatearMinutos,
  horaAr,
} from './asistenciaConstantes'
import { etiquetaHorasCorta } from './cronogramaCalculos'
import {
  useAnularFichaje,
  useCorregirFichaje,
  useFichajesDia,
} from '@/lib/hooks/useAsistencia'
import { cn } from '@/lib/utils'
import type {
  AsistenciaDiariaRow,
  HorarioAsignadoRow,
  TurnoPlantillaRow,
} from '@/types/database'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  empleadoId: number
  fecha: string
  nombre: string
  /** Turno planificado ese día (referencia; el plan se edita desde Planificación). */
  turno?: TurnoPlantillaRow
  horario?: HorarioAsignadoRow
  asistencia?: AsistenciaDiariaRow
}

const claseInput = 'border-[#e4c9b0] focus-visible:ring-[#f9b44c]'

/**
 * Detalle de FICHADAS de una celda: asistencia computada + marcaciones del
 * día, con alta/anulación manual (motivo obligatorio). No edita el plan.
 */
export function ModalCeldaAsistencia({
  abierto,
  onCambioAbierto,
  empleadoId,
  fecha,
  nombre,
  turno,
  horario,
  asistencia,
}: Props) {
  const corregir = useCorregirFichaje()
  const anular = useAnularFichaje()
  const { data: fichajes, isLoading: cargandoFichajes } = useFichajesDia(
    abierto ? empleadoId : undefined,
    fecha
  )

  const [nuevaHora, setNuevaHora] = useState('')
  const [nuevoMotivo, setNuevoMotivo] = useState('')
  const [anulando, setAnulando] = useState<string | null>(null)
  const [motivoAnulacion, setMotivoAnulacion] = useState('')

  useEffect(() => {
    if (abierto) {
      setNuevaHora('')
      setNuevoMotivo('')
      setAnulando(null)
      setMotivoAnulacion('')
    }
  }, [abierto, horario])

  const planLabel =
    horario?.estado === 'franco'
      ? 'Franco'
      : horario?.estado === 'licencia'
        ? 'Licencia'
        : turno
          ? `${NOMBRE_TURNO[turno.nombre]} · ${etiquetaHorasCorta(turno)}`
          : 'Sin turno asignado'

  function agregarMarcacion() {
    if (!nuevaHora || !nuevoMotivo.trim()) return
    corregir.mutate(
      {
        empleadoId,
        momento: `${fecha}T${nuevaHora}:00-03:00`,
        tipo: 'marcacion',
        motivo: nuevoMotivo.trim(),
      },
      {
        onSuccess: () => {
          setNuevaHora('')
          setNuevoMotivo('')
        },
      }
    )
  }

  function confirmarAnulacion() {
    if (!anulando || !motivoAnulacion.trim()) return
    anular.mutate(
      { id: anulando, motivo: motivoAnulacion.trim() },
      {
        onSuccess: () => {
          setAnulando(null)
          setMotivoAnulacion('')
        },
      }
    )
  }

  const estilo = asistencia ? ESTADO_ASISTENCIA[asistencia.estado] : null

  return (
    <Dialog open={abierto} onOpenChange={onCambioAbierto}>
      <DialogContent className="sm:max-w-lg p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <DialogTitle className="text-[#391511] text-lg">{nombre}</DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            {capitalizar(format(parseISO(fecha), "EEEE d 'de' MMMM yyyy", { locale: es }))}
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-5 space-y-5 max-h-[64vh] overflow-y-auto">
          {/* Plan (solo referencia) */}
          <section className="flex items-center justify-between gap-2 text-sm">
            <span className="text-[#6f3a2a]">Planificado</span>
            <span className="font-semibold text-[#391511] tabular-nums">{planLabel}</span>
          </section>
          <p className="text-[11px] text-[#c8a58a] -mt-3">
            El plan se cambia desde la vista Planificación. Acá se corrigen las marcaciones.
          </p>

          {/* Asistencia computada */}
          <section className="space-y-2 rounded-xl bg-[#fdfaf6] border border-[#e4c9b0]/50 p-3">
            <div className="flex items-center justify-between">
              <h4 className="text-[#391511] font-semibold text-sm">Asistencia</h4>
              {estilo && (
                <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full', estilo.clase)}>
                  {estilo.label}
                </span>
              )}
            </div>
            {asistencia ? (
              <div className="grid grid-cols-2 gap-2 text-sm">
                <span className="text-[#6f3a2a]">Entrada: <b className="tabular-nums">{horaAr(asistencia.entrada_real)}</b></span>
                <span className="text-[#6f3a2a]">Salida: <b className="tabular-nums">{horaAr(asistencia.salida_real)}</b></span>
                <span className="text-[#6f3a2a]">Trabajado: <b>{formatearMinutos(asistencia.minutos_trabajados)}</b></span>
                <span className="text-[#6f3a2a]">Tardanza: <b>{formatearMinutos(asistencia.minutos_tardanza)}</b></span>
                {(asistencia.horas_extra_50 > 0 || asistencia.horas_extra_100 > 0) && (
                  <span className="text-[#6f3a2a] col-span-2">
                    Extra: <b>{asistencia.horas_extra_50}h al 50% · {asistencia.horas_extra_100}h al 100%</b>
                  </span>
                )}
              </div>
            ) : (
              <p className="text-[#c8a58a] text-sm">Sin asistencia computada para este día.</p>
            )}
          </section>

          {/* Fichajes del día + corrección */}
          <section className="space-y-2">
            <h4 className="text-[#391511] font-semibold text-sm">Marcaciones</h4>
            {cargandoFichajes ? (
              <p className="text-[#c8a58a] text-sm">Cargando…</p>
            ) : !fichajes || fichajes.length === 0 ? (
              <p className="text-[#c8a58a] text-sm">Sin marcaciones registradas.</p>
            ) : (
              <ul className="space-y-1">
                {fichajes.map((f) => (
                  <li
                    key={f.id}
                    className={cn(
                      'flex items-center justify-between gap-2 text-sm px-2 py-1 rounded-lg',
                      f.tipo === 'correccion'
                        ? 'bg-[#c43e2c]/5 text-[#c8a58a] line-through'
                        : 'bg-[#fdfaf6]'
                    )}
                  >
                    <span className="tabular-nums font-medium text-[#391511]">{horaAr(f.momento)}</span>
                    <span className="text-[#c8a58a] text-xs flex-1">{f.origen}{f.tipo === 'correccion' ? ' · anula' : ''}</span>
                    {f.tipo !== 'correccion' && anulando !== f.id && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setAnulando(f.id)
                          setMotivoAnulacion('')
                        }}
                        className="h-6 w-6 p-0 text-[#c8a58a] hover:text-[#c43e2c] hover:bg-[#c43e2c]/10"
                        aria-label="Anular"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {anulando && (
              <div className="flex items-end gap-2 rounded-lg bg-[#c43e2c]/5 p-2">
                <div className="flex-1 space-y-1">
                  <Label className="text-[#c43e2c] text-xs">Motivo de la anulación (obligatorio)</Label>
                  <Input
                    autoFocus
                    value={motivoAnulacion}
                    onChange={(e) => setMotivoAnulacion(e.target.value)}
                    placeholder="Ej. marcación duplicada del reloj"
                    className={claseInput}
                  />
                </div>
                <Button
                  variant="outline"
                  onClick={() => setAnulando(null)}
                  disabled={anular.isPending}
                  className="h-9 border-[#e4c9b0] text-[#6f3a2a]"
                >
                  Cancelar
                </Button>
                <Button
                  onClick={confirmarAnulacion}
                  disabled={!motivoAnulacion.trim() || anular.isPending}
                  className="h-9 bg-[#c43e2c] hover:bg-[#a83424] text-white font-semibold disabled:opacity-50"
                >
                  {anular.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Anular'}
                </Button>
              </div>
            )}

            {/* Agregar marcación manual */}
            <div className="flex items-end gap-2 pt-1">
              <div className="space-y-1">
                <Label className="text-[#6f3a2a] text-xs">Agregar hora</Label>
                <Input
                  type="time"
                  value={nuevaHora}
                  onChange={(e) => setNuevaHora(e.target.value)}
                  className={`${claseInput} tabular-nums w-28`}
                />
              </div>
              <Input
                value={nuevoMotivo}
                onChange={(e) => setNuevoMotivo(e.target.value)}
                placeholder="Motivo (obligatorio)"
                className={`${claseInput} flex-1`}
              />
              <Button
                onClick={agregarMarcacion}
                disabled={!nuevaHora || !nuevoMotivo.trim() || corregir.isPending}
                className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold h-9 px-3 disabled:opacity-50"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </section>
        </div>

        <div className="border-t border-[#e4c9b0]/60 bg-[#fdfaf6] px-6 py-3 flex justify-end">
          <Button
            variant="outline"
            onClick={() => onCambioAbierto(false)}
            className="border-[#e4c9b0] text-[#6f3a2a]"
          >
            Cerrar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
