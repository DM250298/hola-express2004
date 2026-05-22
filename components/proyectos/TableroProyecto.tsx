'use client'

import { useMemo, useState } from 'react'
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
  User,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ModalTarea } from './ModalTarea'
import { ModalProyecto } from './ModalProyecto'
import { useTareas, useCambiarEstadoTarea } from '@/lib/hooks/useProyectos'
import { useUsuariosActivos } from '@/lib/hooks/useConteos'
import { formatearFechaCorta } from '@/lib/utils/formato'
import { cn } from '@/lib/utils'
import type { TareaRow, VistaProyectoRow } from '@/types/database'

interface Props {
  proyecto: VistaProyectoRow
  onVolver: () => void
}

const COLUMNAS: { estado: string; titulo: string }[] = [
  { estado: 'pendiente', titulo: 'Pendiente' },
  { estado: 'en_curso', titulo: 'En curso' },
  { estado: 'hecha', titulo: 'Hecha' },
]

const ORDEN = COLUMNAS.map((c) => c.estado)

const COLOR_PRIORIDAD: Record<string, string> = {
  alta: 'bg-[#c43e2c]/15 text-[#c43e2c]',
  media: 'bg-[#f9b44c]/20 text-[#6f3a2a]',
  baja: 'bg-[#e4c9b0]/40 text-[#6f3a2a]',
}

export function TableroProyecto({ proyecto, onVolver }: Props) {
  const { data: tareas, isLoading } = useTareas(proyecto.id)
  const { data: usuarios } = useUsuariosActivos()
  const cambiarEstado = useCambiarEstadoTarea()

  const [modalTarea, setModalTarea] = useState(false)
  const [tareaEditar, setTareaEditar] = useState<TareaRow | null>(null)
  const [modalProyecto, setModalProyecto] = useState(false)

  const nombrePorId = useMemo(() => {
    const m = new Map<string, string>()
    for (const u of usuarios ?? []) m.set(u.id, u.nombre)
    return m
  }, [usuarios])

  function abrirNueva() {
    setTareaEditar(null)
    setModalTarea(true)
  }

  function abrirEdicion(t: TareaRow) {
    setTareaEditar(t)
    setModalTarea(true)
  }

  function mover(t: TareaRow, dir: -1 | 1) {
    const idx = ORDEN.indexOf(t.estado)
    const nuevo = ORDEN[idx + dir]
    if (!nuevo) return
    cambiarEstado.mutate({ id: t.id, estado: nuevo })
  }

  const hoy = new Date().toISOString().slice(0, 10)

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={onVolver}
            className="text-[#6f3a2a] hover:bg-[#f9d2a2]/40 mt-0.5"
            aria-label="Volver"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-[#391511] text-2xl font-bold flex items-center gap-2">
              {proyecto.nombre}
              <button
                type="button"
                onClick={() => setModalProyecto(true)}
                className="text-[#c8a58a] hover:text-[#391511]"
                aria-label="Editar proyecto"
              >
                <Pencil className="h-4 w-4" />
              </button>
            </h1>
            {proyecto.descripcion && (
              <p className="text-[#6f3a2a] text-sm mt-0.5">
                {proyecto.descripcion}
              </p>
            )}
          </div>
        </div>
        <Button
          onClick={abrirNueva}
          className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5"
        >
          <Plus className="h-4 w-4" />
          Nueva tarea
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {COLUMNAS.map((c) => (
            <Skeleton
              key={c.estado}
              className="h-64 rounded-2xl bg-[#f9d2a2]/30"
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {COLUMNAS.map((col, colIdx) => {
            const items = (tareas ?? []).filter(
              (t) => t.estado === col.estado
            )
            return (
              <div
                key={col.estado}
                className="bg-[#fdfaf6] border border-[#e4c9b0]/60 rounded-2xl p-3 space-y-2"
              >
                <div className="flex items-center justify-between px-1">
                  <h2 className="text-[#391511] font-bold text-sm">
                    {col.titulo}
                  </h2>
                  <span className="text-xs text-[#6f3a2a] tabular-nums bg-white border border-[#e4c9b0]/60 rounded-full px-2">
                    {items.length}
                  </span>
                </div>

                {items.length === 0 ? (
                  <p className="text-[#c8a58a] text-xs text-center py-6">
                    Sin tareas
                  </p>
                ) : (
                  items.map((t) => {
                    const vencida =
                      t.fecha_limite != null &&
                      t.fecha_limite < hoy &&
                      t.estado !== 'hecha'
                    return (
                      <div
                        key={t.id}
                        className="bg-white border border-[#e4c9b0]/60 rounded-xl p-3 shadow-sm space-y-2"
                      >
                        <button
                          type="button"
                          onClick={() => abrirEdicion(t)}
                          className="w-full text-left"
                        >
                          <div className="font-medium text-[#391511] text-sm leading-tight">
                            {t.titulo}
                          </div>
                          {t.descripcion && (
                            <div className="text-[#c8a58a] text-xs mt-0.5 line-clamp-2">
                              {t.descripcion}
                            </div>
                          )}
                        </button>

                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span
                            className={cn(
                              'text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded',
                              COLOR_PRIORIDAD[t.prioridad] ??
                                COLOR_PRIORIDAD.media
                            )}
                          >
                            {t.prioridad}
                          </span>
                          {t.fecha_limite && (
                            <span
                              className={cn(
                                'text-[10px] tabular-nums',
                                vencida
                                  ? 'text-[#c43e2c] font-bold'
                                  : 'text-[#6f3a2a]'
                              )}
                            >
                              {formatearFechaCorta(t.fecha_limite)}
                            </span>
                          )}
                          {t.responsable_id && (
                            <span className="text-[10px] text-[#6f3a2a] flex items-center gap-0.5">
                              <User className="h-3 w-3" />
                              {nombrePorId.get(t.responsable_id) ?? '—'}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center justify-between border-t border-[#e4c9b0]/40 pt-1.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={colIdx === 0 || cambiarEstado.isPending}
                            onClick={() => mover(t, -1)}
                            className="h-6 px-1 text-[#6f3a2a] hover:bg-[#f9d2a2]/40 disabled:opacity-30"
                            aria-label="Mover a la izquierda"
                          >
                            <ChevronLeft className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={
                              colIdx === COLUMNAS.length - 1 ||
                              cambiarEstado.isPending
                            }
                            onClick={() => mover(t, 1)}
                            className="h-6 px-1 text-[#6f3a2a] hover:bg-[#f9d2a2]/40 disabled:opacity-30"
                            aria-label="Mover a la derecha"
                          >
                            <ChevronRight className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            )
          })}
        </div>
      )}

      <ModalTarea
        abierto={modalTarea}
        onCambioAbierto={setModalTarea}
        proyectoId={proyecto.id}
        tarea={tareaEditar}
      />

      <ModalProyecto
        abierto={modalProyecto}
        onCambioAbierto={setModalProyecto}
        proyecto={proyecto}
      />
    </div>
  )
}
