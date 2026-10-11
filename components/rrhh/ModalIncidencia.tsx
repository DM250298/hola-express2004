'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Info, Loader2 } from 'lucide-react'
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
import { useTareasFecha } from '@/lib/hooks/useTareas'
import {
  useRegistrarIncidencia,
  useResumenReincidencias,
  useTipologias,
} from '@/lib/hooks/useIncidencias'
import { nombreCompleto } from './constantes'
import { NOMBRE_TURNO, hoyAr } from './asistenciaConstantes'
import { tareaEsDe } from './tareasConstantes'
import { GRAVEDAD_INCIDENCIA, INSTANCIA_INCIDENCIA } from './incidenciasConstantes'
import type { GravedadIncidencia } from '@/types/database'
import { cn } from '@/lib/utils'

export interface PrefillIncidencia {
  tipologiaCodigo?: string
  descripcion?: string
  turnoId?: number | null
  fecha?: string
}

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  /** Si viene, el empleado queda fijo (ficha / legajo). */
  empleadoIdFijo?: number | null
  /** Precarga (ej. desde un pase de turno no conforme). */
  prefill?: PrefillIncidencia | null
}

const claseInput = 'border-[#e4c9b0] focus-visible:ring-[#f9b44c]'
const claseTextarea =
  'w-full rounded-md border border-[#e4c9b0] bg-white px-3 py-2 text-sm text-[#391511] placeholder:text-[#c8a58a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f9b44c] disabled:opacity-50 resize-none'

const SIN = '__sin__'

export function ModalIncidencia({ abierto, onCambioAbierto, empleadoIdFijo, prefill }: Props) {
  const { data: empleados } = useEmpleados()
  const { data: tipologias } = useTipologias()
  const { data: turnos } = useTurnos()
  const registrar = useRegistrarIncidencia()

  const [empleadoId, setEmpleadoId] = useState(SIN)
  const [tipologiaId, setTipologiaId] = useState(SIN)
  const [fecha, setFecha] = useState(hoyAr())
  const [turnoId, setTurnoId] = useState(SIN)
  const [tareaId, setTareaId] = useState(SIN)
  const [descripcion, setDescripcion] = useState('')
  const [gravedad, setGravedad] = useState<GravedadIncidencia>('leve')
  const [gravedadTocada, setGravedadTocada] = useState(false)
  const [accion, setAccion] = useState('')

  useEffect(() => {
    if (!abierto) return
    setEmpleadoId(empleadoIdFijo != null ? String(empleadoIdFijo) : SIN)
    const tip = prefill?.tipologiaCodigo
      ? tipologias?.find((t) => t.codigo === prefill.tipologiaCodigo)
      : null
    setTipologiaId(tip ? String(tip.id) : SIN)
    setFecha(prefill?.fecha ?? hoyAr())
    setTurnoId(prefill?.turnoId != null ? String(prefill.turnoId) : SIN)
    setTareaId(SIN)
    setDescripcion(prefill?.descripcion ?? '')
    setGravedad(tip?.gravedad_default ?? 'leve')
    setGravedadTocada(false)
    setAccion('')
  }, [abierto, empleadoIdFijo, prefill, tipologias])

  const empleadoNum = empleadoId === SIN ? null : Number(empleadoId)
  const tipologiaNum = tipologiaId === SIN ? null : Number(tipologiaId)
  const tipologia = tipologias?.find((t) => t.id === tipologiaNum) ?? null

  // Gravedad por defecto de la tipología, salvo que la hayan tocado a mano.
  useEffect(() => {
    if (!gravedadTocada && tipologia) setGravedad(tipologia.gravedad_default)
  }, [tipologia, gravedadTocada])

  const { data: resumen } = useResumenReincidencias(empleadoNum, tipologiaNum, fecha)

  // Tareas del día del empleado, para vincular (opcional).
  const { data: tareasDia } = useTareasFecha(empleadoNum ? fecha : '')
  const tareasEmpleado = useMemo(
    () => (tareasDia ?? []).filter((t) => empleadoNum != null && tareaEsDe(t, empleadoNum)),
    [tareasDia, empleadoNum]
  )

  const itemsEmpleado: Record<string, string> = {
    [SIN]: 'Elegí un empleado',
    ...Object.fromEntries(
      (empleados ?? []).filter((e) => e.activo).map((e) => [String(e.id), nombreCompleto(e)])
    ),
  }
  const itemsTipologia: Record<string, string> = {
    [SIN]: 'Elegí una tipología',
    ...Object.fromEntries((tipologias ?? []).map((t) => [String(t.id), t.nombre])),
  }
  const itemsTurno: Record<string, string> = {
    [SIN]: 'Sin turno',
    ...Object.fromEntries((turnos ?? []).map((t) => [String(t.id), NOMBRE_TURNO[t.nombre]])),
  }
  const itemsTarea: Record<string, string> = {
    [SIN]: 'Sin tarea vinculada',
    ...Object.fromEntries(tareasEmpleado.map((t) => [t.id, t.titulo])),
  }
  const itemsGravedad: Record<string, string> = {
    leve: GRAVEDAD_INCIDENCIA.leve.label,
    grave: GRAVEDAD_INCIDENCIA.grave.label,
  }

  const procesando = registrar.isPending
  const puedeGuardar =
    empleadoNum != null && tipologiaNum != null && descripcion.trim().length > 0 && !!fecha && !procesando

  const instanciaPreview = resumen
    ? gravedad === 'grave'
      ? 3
      : resumen.instancia_sugerida
    : null

  function guardar() {
    if (!puedeGuardar || empleadoNum == null || tipologiaNum == null) return
    registrar.mutate(
      {
        empleadoId: empleadoNum,
        tipologiaId: tipologiaNum,
        descripcion: descripcion.trim(),
        fecha,
        turnoId: turnoId === SIN ? null : Number(turnoId),
        tareaTurnoId: tareaId === SIN ? null : tareaId,
        gravedad,
        accionCorrectiva: accion.trim() || null,
      },
      { onSuccess: () => onCambioAbierto(false) }
    )
  }

  return (
    <Dialog open={abierto} onOpenChange={(v) => !procesando && onCambioAbierto(v)}>
      <DialogContent className="sm:max-w-xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <DialogTitle className="text-[#391511] text-lg">Registrar incidencia</DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            Hecho objetivo: qué pasó, cuándo y dónde. No es una sanción formal.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-5 space-y-4 max-h-[64vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">Empleado</Label>
              <Select
                items={itemsEmpleado}
                value={empleadoId}
                onValueChange={(v) => setEmpleadoId(v ?? SIN)}
                disabled={procesando || empleadoIdFijo != null}
              >
                <SelectTrigger className={`w-full ${claseInput}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(itemsEmpleado).map(([v, l]) => (
                    <SelectItem key={v} value={v}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">Fecha</Label>
              <Input
                type="date"
                value={fecha}
                max={hoyAr()}
                onChange={(e) => setFecha(e.target.value)}
                disabled={procesando}
                className={`${claseInput} tabular-nums`}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">Tipología</Label>
            <Select
              items={itemsTipologia}
              value={tipologiaId}
              onValueChange={(v) => {
                setTipologiaId(v ?? SIN)
                setGravedadTocada(false)
              }}
              disabled={procesando}
            >
              <SelectTrigger className={`w-full ${claseInput}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(itemsTipologia).map(([v, l]) => (
                  <SelectItem key={v} value={v}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {resumen && instanciaPreview != null && (
            <div
              className={cn(
                'rounded-xl border px-3 py-2.5 text-sm flex items-start gap-2',
                instanciaPreview >= 3
                  ? 'border-[#c43e2c]/40 bg-[#c43e2c]/5 text-[#c43e2c]'
                  : instanciaPreview === 2
                    ? 'border-[#f9b44c]/60 bg-[#f9b44c]/10 text-[#391511]'
                    : 'border-[#e4c9b0]/60 bg-[#fdfaf6] text-[#6f3a2a]'
              )}
            >
              {instanciaPreview >= 3 ? (
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              ) : (
                <Info className="h-4 w-4 mt-0.5 shrink-0" />
              )}
              <div>
                <p className="font-semibold">
                  {gravedad === 'grave'
                    ? 'Incidencia grave: escala a Dirección de inmediato.'
                    : `Sería la ${INSTANCIA_INCIDENCIA[instanciaPreview].corta} de esta tipología en 30 días.`}
                </p>
                <p className="text-xs opacity-90">
                  {resumen.previas === 0
                    ? 'Sin antecedentes de esta tipología en los últimos 30 días.'
                    : `${resumen.previas} previa${resumen.previas === 1 ? '' : 's'} en 30 días`}
                  {' · '}
                  {INSTANCIA_INCIDENCIA[instanciaPreview].larga}
                </p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">Turno</Label>
              <Select
                items={itemsTurno}
                value={turnoId}
                onValueChange={(v) => setTurnoId(v ?? SIN)}
                disabled={procesando}
              >
                <SelectTrigger className={`w-full ${claseInput}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(itemsTurno).map(([v, l]) => (
                    <SelectItem key={v} value={v}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">Gravedad</Label>
              <Select
                items={itemsGravedad}
                value={gravedad}
                onValueChange={(v) => {
                  if (!v) return
                  setGravedad(v as GravedadIncidencia)
                  setGravedadTocada(true)
                }}
                disabled={procesando}
              >
                <SelectTrigger className={`w-full ${claseInput}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(itemsGravedad).map(([v, l]) => (
                    <SelectItem key={v} value={v}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {tareasEmpleado.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">
                Tarea vinculada (opcional)
              </Label>
              <Select
                items={itemsTarea}
                value={tareaId}
                onValueChange={(v) => setTareaId(v ?? SIN)}
                disabled={procesando}
              >
                <SelectTrigger className={`w-full ${claseInput}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(itemsTarea).map(([v, l]) => (
                    <SelectItem key={v} value={v}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">Qué pasó</Label>
            <textarea
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              rows={3}
              placeholder="Ej: Góndola de lácteos sin reponer a las 15:30, con stock en depósito."
              disabled={procesando}
              className={claseTextarea}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">
              Acción correctiva (opcional)
            </Label>
            <textarea
              value={accion}
              onChange={(e) => setAccion(e.target.value)}
              rows={2}
              placeholder="Cómo debía hacerse y qué se acordó para corregirlo."
              disabled={procesando}
              className={claseTextarea}
            />
          </div>
        </div>

        <div className="border-t border-[#e4c9b0]/60 bg-[#fdfaf6] px-6 py-4 flex gap-2">
          <Button
            variant="outline"
            onClick={() => onCambioAbierto(false)}
            disabled={procesando}
            className="flex-1 border-[#e4c9b0] text-[#6f3a2a]"
          >
            Cancelar
          </Button>
          <Button
            onClick={guardar}
            disabled={!puedeGuardar}
            className="flex-[2] bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-bold disabled:opacity-50"
          >
            {procesando ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Guardando…
              </>
            ) : (
              'Registrar incidencia'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
