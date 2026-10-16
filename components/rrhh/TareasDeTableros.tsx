'use client'

import Link from 'next/link'
import { CalendarClock, ChevronRight, FolderKanban } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { useAgenda } from '@/lib/hooks/useAgenda'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { tienePermiso } from '@/lib/permisos'
import { hoyIso } from '@/lib/utils/periodos'
import { formatearFechaCortaISO } from '@/lib/utils/formato'
import { cn } from '@/lib/utils'

const COLOR_PRIORIDAD: Record<string, string> = {
  alta: 'bg-[#c43e2c]/15 text-[#c43e2c]',
  media: 'bg-[#f9b44c]/20 text-[#6f3a2a]',
  baja: 'bg-[#e4c9b0]/40 text-[#6f3a2a]',
}

interface Props {
  /** Dentro de /movil: sin enlace a Mi agenda (es una pantalla de escritorio). */
  enMovil?: boolean
}

/**
 * Sección "De tableros y alertas" de Mis tareas: las tareas de los tableros
 * (kanban y "Acciones de HEX" que generan las Alertas) asignadas a este
 * usuario. Lee lo mismo que Mi agenda (`useAgenda`, por
 * `tareas.responsable_id`), sin tablas nuevas ni copias; las tareas del turno
 * siguen siendo las de arriba. Solo lectura: se trabajan en Mi agenda.
 */
export function TareasDeTableros({ enMovil = false }: Props) {
  const { data: usuario } = useUsuario()
  const { data: tareas, isLoading } = useAgenda(usuario?.id, false)
  const hoy = hoyIso()
  const enlazarAgenda = !enMovil && tienePermiso(usuario?.permisos, 'proyectos')
  const lista = tareas ?? []

  return (
    <section className="p-4 pt-0 max-w-md mx-auto space-y-2">
      <div className="flex items-center gap-2 border-b border-[#e4c9b0]/60 pb-2">
        <FolderKanban className="h-4 w-4 text-[#6f3a2a]" />
        <h2 className="text-[#391511] text-sm font-bold">De tableros y alertas</h2>
        {lista.length > 0 && (
          <span className="text-[11px] text-[#6f3a2a] tabular-nums">{lista.length}</span>
        )}
        {enlazarAgenda && (
          <Link
            href="/agenda"
            className="ml-auto inline-flex items-center gap-0.5 text-xs font-medium text-[#6f3a2a] hover:text-[#391511]"
          >
            Mi agenda
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>

      {isLoading || !usuario ? (
        <div className="space-y-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-12 rounded-xl bg-[#f9d2a2]/30" />
          ))}
        </div>
      ) : lista.length === 0 ? (
        <p className="text-[#6f3a2a] text-xs px-1">
          No tenés tareas pendientes de tableros ni de alertas.
        </p>
      ) : (
        <ul className="space-y-2">
          {lista.map((t) => {
            const vencida = t.fecha_limite != null && t.fecha_limite < hoy
            return (
              <li
                key={t.id}
                className="rounded-xl border border-[#e4c9b0]/60 bg-white px-3 py-2.5 shadow-sm"
              >
                <div className="flex items-start gap-2">
                  <p className="flex-1 min-w-0 text-sm font-medium text-[#391511] leading-snug">
                    {t.titulo}
                  </p>
                  <span
                    className={cn(
                      'text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded shrink-0',
                      COLOR_PRIORIDAD[t.prioridad] ?? COLOR_PRIORIDAD.media
                    )}
                  >
                    {t.prioridad}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2 flex-wrap text-[11px] text-[#6f3a2a]">
                  {t.fecha_limite && (
                    <span
                      className={cn(
                        'inline-flex items-center gap-0.5 tabular-nums',
                        vencida && 'text-[#c43e2c] font-bold'
                      )}
                    >
                      <CalendarClock className="h-3 w-3" />
                      {vencida ? 'Venció ' : 'Para el '}
                      {formatearFechaCortaISO(t.fecha_limite)}
                    </span>
                  )}
                  <span className="truncate">
                    <span
                      className="inline-block h-2 w-2 rounded-full mr-1 align-middle"
                      style={{ backgroundColor: t.tablero_color }}
                    />
                    {t.tablero_nombre} / {t.proyecto_nombre}
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
