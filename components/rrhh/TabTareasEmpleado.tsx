'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { ClipboardList, ExternalLink } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { ESTADO_TAREA, PRIORIDAD_TAREA } from './tareasConstantes'
import { hoyAr } from './asistenciaConstantes'
import { useTareasFecha } from '@/lib/hooks/useTareas'
import { cn } from '@/lib/utils'

interface Props {
  empleadoId: number
}

export function TabTareasEmpleado({ empleadoId }: Props) {
  const [hoy] = useState(() => hoyAr())
  const { data: tareas, isLoading } = useTareasFecha(hoy)

  const mias = useMemo(
    () => (tareas ?? []).filter((t) => t.empleado_id === empleadoId),
    [tareas, empleadoId]
  )

  return (
    <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl shadow-sm p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[#391511] font-bold capitalize">
          Tareas de hoy · {format(new Date(`${hoy}T00:00:00`), "d 'de' MMM", { locale: es })}
        </h3>
        <Link
          href="/rrhh/tareas"
          className={cn(
            buttonVariants({ variant: 'ghost', size: 'sm' }),
            'text-[#6f3a2a] gap-1 text-xs'
          )}
        >
          Ver tablero <ExternalLink className="h-3 w-3" />
        </Link>
      </div>

      {isLoading ? (
        <p className="text-[#c8a58a] text-sm">Cargando…</p>
      ) : mias.length === 0 ? (
        <div className="py-8 text-center">
          <div className="inline-flex p-3 rounded-full bg-[#f9d2a2]/40 mb-2">
            <ClipboardList className="h-5 w-5 text-[#6f3a2a]" />
          </div>
          <p className="text-[#6f3a2a] text-sm">Sin tareas asignadas para hoy.</p>
        </div>
      ) : (
        <ul className="divide-y divide-[#e4c9b0]/40">
          {mias.map((t) => (
            <li key={t.id} className="flex items-center gap-2 py-2.5">
              <span className="flex-1 text-[#391511] text-sm">{t.titulo}</span>
              <span
                className={cn(
                  'text-[10px] uppercase font-bold px-1.5 py-0.5 rounded',
                  PRIORIDAD_TAREA[t.prioridad].clase
                )}
              >
                {PRIORIDAD_TAREA[t.prioridad].label}
              </span>
              <span
                className={cn(
                  'text-[10px] font-bold px-2 py-0.5 rounded-full',
                  ESTADO_TAREA[t.estado].clase
                )}
              >
                {ESTADO_TAREA[t.estado].label}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
