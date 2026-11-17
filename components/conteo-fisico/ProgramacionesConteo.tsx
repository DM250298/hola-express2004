'use client'

import { useEffect, useState } from 'react'
import {
  CalendarClock,
  ChevronDown,
  ChevronUp,
  Loader2,
  Play,
  RotateCcw,
  UserRound,
  XCircle,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ConfirmacionAccion } from '@/components/shared/ConfirmacionAccion'
import { cn } from '@/lib/utils'
import { formatearFechaHora } from '@/lib/utils/formato'
import {
  useAbrirProgramadaConteo,
  useCancelarProgramacionConteo,
  useReprogramarSesionConteo,
} from '@/lib/hooks/useConteoFisico'
import {
  estadoProgramacion,
  fechaHoraPorDefecto,
  horaAr,
  ordenarProgramaciones,
  partesAr,
  tareasDeProgramacion,
  validarProgramacion,
  type ClaveEstadoProgramacion,
} from '@/lib/conteo/programacion'
import type { ConteoProgramacionRow } from '@/types/database'

const ESTILO_ESTADO: Record<ClaveEstadoProgramacion, string> = {
  futura: 'bg-[#e4c9b0]/40 text-[#6f3a2a]',
  por_abrir: 'bg-[#f9b44c]/20 text-[#a3641c]',
  esperando: 'bg-[#f9b44c]/20 text-[#a3641c]',
  demorada: 'bg-[#c43e2c]/10 text-[#c43e2c]',
  fallida: 'bg-[#c43e2c]/10 text-[#c43e2c]',
  abierta: 'bg-[#2f7d4f]/12 text-[#2f7d4f]',
  cancelada: 'bg-[#e4c9b0]/40 text-[#6f3a2a]',
}

interface Props {
  programaciones: ConteoProgramacionRow[]
  nombrePorUsuario: Record<string, string>
  /** Instante de referencia para el estado derivado (se renueva con cada refetch). */
  ahoraMs: number
}

/**
 * Sección "Programadas" del hub (solo gestores): las sesiones que esperan su
 * hora o no se pudieron abrir, con Abrir ahora / Reprogramar / Cancelar, y
 * debajo, en gris, las que se abrieron en la semana.
 */
export function ProgramacionesConteo({ programaciones, nombrePorUsuario, ahoraMs }: Props) {
  const { pendientes, recientes } = ordenarProgramaciones(programaciones, ahoraMs)
  const [abriendo, setAbriendo] = useState<ConteoProgramacionRow | null>(null)
  const [reprogramando, setReprogramando] = useState<ConteoProgramacionRow | null>(null)
  const [cancelando, setCancelando] = useState<ConteoProgramacionRow | null>(null)
  const abrirAhora = useAbrirProgramadaConteo()
  const cancelar = useCancelarProgramacionConteo()

  if (pendientes.length === 0 && recientes.length === 0) return null

  return (
    <div className="space-y-2">
      <h2 className="flex items-center gap-1.5 text-sm font-bold uppercase tracking-wide text-[#6f3a2a]">
        <CalendarClock className="h-3.5 w-3.5" />
        Programadas
      </h2>
      <div className="space-y-2">
        {pendientes.map((p) => (
          <FilaProgramacion
            key={p.id}
            programacion={p}
            nombrePorUsuario={nombrePorUsuario}
            ahoraMs={ahoraMs}
            onAbrir={() => setAbriendo(p)}
            onReprogramar={() => setReprogramando(p)}
            onCancelar={() => setCancelando(p)}
          />
        ))}
        {recientes.map((p) => (
          <FilaProgramacion
            key={p.id}
            programacion={p}
            nombrePorUsuario={nombrePorUsuario}
            ahoraMs={ahoraMs}
          />
        ))}
      </div>

      <ConfirmacionAccion
        abierto={abriendo !== null}
        onCambioAbierto={(v) => !v && setAbriendo(null)}
        titulo={`¿Abrir “${abriendo?.nombre ?? ''}” ahora?`}
        descripcion="Se toma la foto del stock en este momento y se arman las listas de cada tarea con lo que hay hoy. Si hay otra sesión en curso no se va a poder."
        textoConfirmar="Abrir ahora"
        procesando={abrirAhora.isPending}
        onConfirmar={() =>
          abriendo && abrirAhora.mutate(abriendo.id, { onSuccess: () => setAbriendo(null) })
        }
      />

      <ConfirmacionAccion
        abierto={cancelando !== null}
        onCambioAbierto={(v) => !v && setCancelando(null)}
        titulo={`¿Cancelar “${cancelando?.nombre ?? ''}”?`}
        descripcion="La programación se descarta y no se abre. Para contar lo mismo otro día, armá una sesión nueva."
        textoConfirmar="Cancelar programación"
        textoCancelar="Volver"
        destructiva
        procesando={cancelar.isPending}
        onConfirmar={() =>
          cancelando && cancelar.mutate(cancelando.id, { onSuccess: () => setCancelando(null) })
        }
      />

      <DialogoReprogramar
        programacion={reprogramando}
        onCerrar={() => setReprogramando(null)}
      />
    </div>
  )
}

function FilaProgramacion({
  programacion: p,
  nombrePorUsuario,
  ahoraMs,
  onAbrir,
  onReprogramar,
  onCancelar,
}: {
  programacion: ConteoProgramacionRow
  nombrePorUsuario: Record<string, string>
  ahoraMs: number
  /** Sin acciones = fila de historial (ya se abrió). */
  onAbrir?: () => void
  onReprogramar?: () => void
  onCancelar?: () => void
}) {
  const [verTareas, setVerTareas] = useState(false)
  const estado = estadoProgramacion(p, ahoraMs)
  const tareas = tareasDeProgramacion(p.zonas)
  const nombre = (id: string) => nombrePorUsuario[id] ?? 'Usuario'
  const historial = !onAbrir

  return (
    <div
      className={cn(
        'rounded-2xl border bg-white p-3 shadow-sm',
        estado.alerta ? 'border-[#c43e2c]/50' : 'border-[#e4c9b0]/70',
        historial && 'bg-white/70 opacity-80'
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-[#391511]">{p.nombre}</p>
          <p className="text-xs text-[#6f3a2a]">
            {formatearFechaHora(p.programada_para)} · {tareas.length}{' '}
            {tareas.length === 1 ? 'tarea' : 'tareas'} · programó {nombre(p.programada_por)}
          </p>
        </div>
        <span
          className={cn(
            'shrink-0 rounded-lg px-2 py-0.5 text-xs font-semibold',
            ESTILO_ESTADO[estado.clave]
          )}
        >
          {estado.etiqueta}
        </span>
      </div>

      {estado.detalle && (
        <p
          className={cn(
            'mt-1.5 text-xs',
            estado.alerta ? 'font-semibold text-[#c43e2c]' : 'text-[#6f3a2a]'
          )}
        >
          {estado.detalle}
        </p>
      )}
      {estado.clave === 'abierta' && p.abierta_at && (
        <p className="mt-1.5 text-xs text-[#6f3a2a]">
          A las {horaAr(p.abierta_at)}
          {p.abierta_por ? ` · la abrió ${nombre(p.abierta_por)}` : ' · la abrió el sistema'}
        </p>
      )}

      <button
        type="button"
        onClick={() => setVerTareas((v) => !v)}
        className="mt-2 flex items-center gap-1 text-xs font-semibold text-[#a3641c]"
      >
        {verTareas ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        {verTareas ? 'Ocultar tareas' : 'Ver tareas'}
      </button>
      {verTareas && (
        <ul className="mt-1.5 space-y-1 text-xs text-[#6f3a2a]">
          {tareas.map((t, i) => (
            <li key={i} className="flex flex-wrap items-center gap-1.5">
              <UserRound className="h-3 w-3 shrink-0" />
              <span className="font-semibold text-[#391511]">{t.nombre || 'Tarea'}</span>
              <span>
                ·{' '}
                {t.responsables.length > 0
                  ? t.responsables.map(nombre).join(', ')
                  : 'la toma quien la inicie'}
              </span>
            </li>
          ))}
        </ul>
      )}

      {!historial && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            onClick={onAbrir}
            className="bg-[#f9b44c] font-semibold text-[#391511] hover:bg-[#e4a42a]"
          >
            <Play className="h-3.5 w-3.5" />
            Abrir ahora
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onReprogramar}
            className="border-[#e4c9b0] text-[#6f3a2a]"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reprogramar
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onCancelar}
            className="border-[#e4c9b0] text-[#c43e2c]"
          >
            <XCircle className="h-3.5 w-3.5" />
            Cancelar
          </Button>
        </div>
      )}
    </div>
  )
}

/** Otra fecha y hora para una programada o una que no se pudo abrir. */
function DialogoReprogramar({
  programacion,
  onCerrar,
}: {
  programacion: ConteoProgramacionRow | null
  onCerrar: () => void
}) {
  const reprogramar = useReprogramarSesionConteo()
  const [fecha, setFecha] = useState('')
  const [hora, setHora] = useState('')

  // Arranca en la fecha que tenía; si ya pasó, en mañana a las 07:00.
  useEffect(() => {
    if (!programacion) return
    const vencida = Date.parse(programacion.programada_para) <= Date.now()
    const base = vencida
      ? fechaHoraPorDefecto(Date.now())
      : partesAr(Date.parse(programacion.programada_para))
    setFecha(base.fecha)
    setHora(base.hora)
  }, [programacion])

  const validacion = validarProgramacion(fecha, hora, Date.now())
  const hoyAr = partesAr(Date.now()).fecha

  function confirmar() {
    if (!programacion || !validacion.ok) return
    reprogramar.mutate(
      { id: programacion.id, programada_para: validacion.iso },
      { onSuccess: onCerrar }
    )
  }

  return (
    <Dialog
      open={programacion !== null}
      onOpenChange={(v) => !v && !reprogramar.isPending && onCerrar()}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[#391511]">
            ¿Cuándo se abre “{programacion?.nombre}”?
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            Las tareas quedan como están. Para cambiarlas, cancelá esta
            programación y armá otra.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="reprog-fecha" className="text-xs text-[#6f3a2a]">
              Día
            </Label>
            <Input
              id="reprog-fecha"
              type="date"
              min={hoyAr}
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              className="border-[#e4c9b0] tabular-nums"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="reprog-hora" className="text-xs text-[#6f3a2a]">
              Hora
            </Label>
            <Input
              id="reprog-hora"
              type="time"
              value={hora}
              onChange={(e) => setHora(e.target.value)}
              className="border-[#e4c9b0] tabular-nums"
            />
          </div>
        </div>
        {!validacion.ok && (
          <p className="text-xs font-semibold text-[#c43e2c]">{validacion.motivo}</p>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onCerrar}
            disabled={reprogramar.isPending}
            className="border-[#e4c9b0] text-[#6f3a2a]"
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={confirmar}
            disabled={reprogramar.isPending || !validacion.ok}
            className="bg-[#f9b44c] font-semibold text-[#391511] hover:bg-[#e4a42a]"
          >
            {reprogramar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Reprogramar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
