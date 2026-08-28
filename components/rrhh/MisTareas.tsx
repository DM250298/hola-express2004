'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { CheckCircle2, Loader2, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SubirEvidencia } from './SubirEvidencia'
import { hoyAr } from './asistenciaConstantes'
import { MODO_TAREA, PRIORIDAD_TAREA, tareaEsDe } from './tareasConstantes'
import { useCompletarTarea, useMaterializar, useTareasFecha } from '@/lib/hooks/useTareas'
import { cn } from '@/lib/utils'
import type { TareaConParticipantes } from '@/lib/queries/tareas'

interface Props {
  empleadoId: number
  nombre: string
}

function TarjetaMiTarea({
  tarea,
  empleadoId,
}: {
  tarea: TareaConParticipantes
  empleadoId: number
}) {
  const completar = useCompletarTarea()
  const [evidencia, setEvidencia] = useState<string | null>(tarea.evidencia_url)
  const hecha = tarea.estado === 'completada'
  const grupal = tarea.empleado_id === null
  const rechazada = tarea.rechazos_count > 0 && !hecha

  return (
    <div
      className={cn(
        'rounded-2xl border p-4 shadow-sm space-y-3',
        hecha ? 'bg-[#2f7d4f]/8 border-[#2f7d4f]/25' : 'bg-white border-[#e4c9b0]/60'
      )}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p
            className={cn(
              'text-[#391511] font-semibold leading-snug',
              hecha && 'line-through text-[#6f3a2a]'
            )}
          >
            {tarea.titulo}
          </p>
          {tarea.descripcion && (
            <p className="text-[#6f3a2a] text-sm mt-0.5">{tarea.descripcion}</p>
          )}
          {grupal && !hecha && (
            <p className="flex items-center gap-1 text-[11px] text-[#a06b00] mt-1">
              <Users className="h-3 w-3" />
              Grupal: la cierra el primero que la hace.
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span
            className={cn(
              'text-[10px] uppercase font-bold px-1.5 py-0.5 rounded',
              PRIORIDAD_TAREA[tarea.prioridad].clase
            )}
          >
            {PRIORIDAD_TAREA[tarea.prioridad].label}
          </span>
          {grupal && (
            <span
              className={cn(
                'text-[10px] uppercase font-bold px-1.5 py-0.5 rounded',
                MODO_TAREA.grupal.clase
              )}
            >
              Grupal
            </span>
          )}
        </div>
      </div>

      {/* Te la devolvieron: motivo de la encargada */}
      {rechazada && (
        <div className="rounded-xl bg-[#c43e2c]/8 border border-[#c43e2c]/25 px-3 py-2">
          <p className="text-[#c43e2c] text-xs font-bold uppercase tracking-wide">
            Te la devolvieron
          </p>
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
            <img
              src={tarea.evidencia_url}
              alt="Evidencia"
              className="h-10 w-10 rounded-lg object-cover ml-auto"
            />
          )}
        </div>
      ) : (
        <div className="space-y-2.5">
          {tarea.requiere_evidencia && (
            <SubirEvidencia
              value={evidencia}
              onChange={setEvidencia}
              disabled={completar.isPending}
            />
          )}
          <Button
            onClick={() => completar.mutate({ id: tarea.id, evidenciaUrl: evidencia })}
            disabled={
              completar.isPending || (tarea.requiere_evidencia && !evidencia)
            }
            className="w-full h-12 bg-[#2f7d4f] hover:bg-[#276b43] text-white font-bold text-base gap-2 disabled:opacity-50"
          >
            {completar.isPending ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <CheckCircle2 className="h-5 w-5" />
            )}
            {tarea.requiere_evidencia && !evidencia ? 'Sacá la foto primero' : 'Completar'}
          </Button>
        </div>
      )}
    </div>
  )
}

export function MisTareas({ empleadoId, nombre }: Props) {
  const [hoy] = useState(() => hoyAr())
  const { data: tareas, isLoading } = useTareasFecha(hoy)
  const materializar = useMaterializar()
  const materializado = useRef(false)

  useEffect(() => {
    if (!materializado.current) {
      materializado.current = true
      materializar.mutate(hoy)
    }
  }, [hoy, materializar])

  const { pendientes, hechas } = useMemo(() => {
    // RLS ya filtra a las del empleado logueado; tareaEsDe cubre además las
    // grupales donde participa (empleado_id null).
    const mias = (tareas ?? []).filter((t) => tareaEsDe(t, empleadoId))
    const pri = { alta: 0, media: 1, baja: 2 }
    const pendientes = mias
      .filter((t) => t.estado === 'pendiente' || t.estado === 'en_curso' || t.estado === 'vencida')
      .sort((a, b) => pri[a.prioridad] - pri[b.prioridad])
    const hechas = mias.filter((t) => t.estado === 'completada')
    return { pendientes, hechas }
  }, [tareas, empleadoId])

  return (
    <div className="p-4 max-w-md mx-auto space-y-4">
      <header>
        <h1 className="text-[#391511] text-2xl font-bold">Mis tareas</h1>
        <p className="text-[#6f3a2a] text-sm capitalize">
          {format(new Date(`${hoy}T00:00:00`), "EEEE d 'de' MMMM", { locale: es })}
        </p>
      </header>

      {isLoading ? (
        <p className="text-[#c8a58a] text-sm text-center py-8">Cargando…</p>
      ) : pendientes.length === 0 && hechas.length === 0 ? (
        <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-8 text-center">
          <p className="text-[#391511] font-semibold">No tenés tareas para hoy 🎉</p>
          <p className="text-[#6f3a2a] text-sm mt-1">Cuando te asignen, aparecen acá.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {pendientes.map((t) => (
            <TarjetaMiTarea key={t.id} tarea={t} empleadoId={empleadoId} />
          ))}

          {hechas.length > 0 && (
            <div className="pt-2 space-y-3">
              <p className="text-[#c8a58a] text-xs font-semibold uppercase tracking-wide">
                Completadas ({hechas.length})
              </p>
              {hechas.map((t) => (
                <TarjetaMiTarea key={t.id} tarea={t} empleadoId={empleadoId} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
