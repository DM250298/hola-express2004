'use client'

import { useState } from 'react'
import { CalendarClock, FolderKanban, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ModalProyecto } from './ModalProyecto'
import { TableroProyecto } from './TableroProyecto'
import { useProyectos } from '@/lib/hooks/useProyectos'
import { formatearFechaCorta } from '@/lib/utils/formato'
import { cn } from '@/lib/utils'

const BADGE_ESTADO: Record<string, string> = {
  activo: 'bg-[#2f8f4e]/15 text-[#2f8f4e]',
  completado: 'bg-[#6f3a2a]/15 text-[#6f3a2a]',
  archivado: 'bg-[#e4c9b0]/50 text-[#6f3a2a]',
}

export function PantallaProyectos() {
  const { data: proyectos, isLoading, isError } = useProyectos()
  const [selId, setSelId] = useState<number | null>(null)
  const [modalNuevo, setModalNuevo] = useState(false)

  const proyectoSel = proyectos?.find((p) => p.id === selId) ?? null

  if (selId !== null && proyectoSel) {
    return (
      <TableroProyecto proyecto={proyectoSel} onVolver={() => setSelId(null)} />
    )
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[#391511] text-2xl font-bold">Proyectos</h1>
          <p className="text-[#6f3a2a] text-sm mt-1">
            Tareas del equipo: reparaciones, trámites y mejoras del local.
          </p>
        </div>
        <Button
          onClick={() => setModalNuevo(true)}
          className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5"
        >
          <Plus className="h-4 w-4" />
          Nuevo proyecto
        </Button>
      </header>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-36 rounded-2xl bg-[#f9d2a2]/30" />
          ))}
        </div>
      ) : isError ? (
        <div className="p-10 text-center text-[#c43e2c] text-sm">
          No se pudieron cargar los proyectos.
        </div>
      ) : !proyectos || proyectos.length === 0 ? (
        <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-12 text-center">
          <div className="inline-flex p-3 rounded-full bg-[#f9d2a2]/40 mb-3">
            <FolderKanban className="h-6 w-6 text-[#6f3a2a]" />
          </div>
          <p className="text-[#391511] font-semibold">
            Todavía no hay proyectos
          </p>
          <p className="text-[#6f3a2a] text-sm mt-1">
            Creá un proyecto para organizar las tareas del equipo.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {proyectos.map((p) => {
            const progreso =
              p.total_tareas > 0
                ? Math.round((p.tareas_hechas / p.total_tareas) * 100)
                : 0
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelId(p.id)}
                className="text-left bg-white border border-[#e4c9b0]/60 rounded-2xl p-4 shadow-sm hover:border-[#f9b44c] transition-colors space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-[#391511] font-bold leading-tight">
                    {p.nombre}
                  </h2>
                  <span
                    className={cn(
                      'text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full shrink-0',
                      BADGE_ESTADO[p.estado] ?? BADGE_ESTADO.activo
                    )}
                  >
                    {p.estado}
                  </span>
                </div>

                {p.descripcion && (
                  <p className="text-[#6f3a2a] text-xs line-clamp-2">
                    {p.descripcion}
                  </p>
                )}

                {/* Progreso */}
                <div className="space-y-1 pt-1">
                  <div className="flex items-center justify-between text-[11px] text-[#6f3a2a]">
                    <span>
                      {p.tareas_hechas} / {p.total_tareas} tareas
                    </span>
                    <span className="tabular-nums font-semibold">
                      {progreso}%
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-[#f9d2a2]/40 overflow-hidden">
                    <div
                      className="h-full bg-[#f9b44c]"
                      style={{ width: `${progreso}%` }}
                    />
                  </div>
                </div>

                {p.fecha_limite && (
                  <div className="flex items-center gap-1 text-[11px] text-[#6f3a2a] pt-0.5">
                    <CalendarClock className="h-3 w-3 text-[#c8a58a]" />
                    Límite {formatearFechaCorta(p.fecha_limite)}
                  </div>
                )}
              </button>
            )
          })}
        </div>
      )}

      <ModalProyecto abierto={modalNuevo} onCambioAbierto={setModalNuevo} />
    </div>
  )
}
