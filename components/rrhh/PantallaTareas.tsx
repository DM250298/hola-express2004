'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { addDays, format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  Lock,
  Plus,
  Repeat,
  Trash2,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SkeletonTabla } from '@/components/shared/SkeletonTabla'
import { ModalTarea } from './ModalTarea'
import { ModalPlantilla } from './ModalPlantilla'
import { TabCumplimiento } from './TabCumplimiento'
import { nombreCompleto } from './constantes'
import { hoyAr } from './asistenciaConstantes'
import {
  COLUMNAS_KANBAN,
  ESTADO_TAREA,
  MODO_TAREA,
  PRIORIDAD_TAREA,
  recurrenciaResumen,
} from './tareasConstantes'
import { useEmpleados } from '@/lib/hooks/useRrhh'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { tienePermiso } from '@/lib/permisos'
import {
  useDeletePlantilla,
  useMaterializar,
  usePlantillas,
  useTareasFecha,
} from '@/lib/hooks/useTareas'
import { cn } from '@/lib/utils'
import type {
  PlantillaConAsignados,
  TareaConParticipantes,
} from '@/lib/queries/tareas'

const claseTab = 'data-active:bg-[#f9b44c]/20 data-active:text-[#391511]'

export function PantallaTareas() {
  const [hoy] = useState(() => hoyAr())
  const [fecha, setFecha] = useState(hoy)
  const [modalTarea, setModalTarea] = useState<{ tarea: TareaConParticipantes | null } | null>(null)
  const [modalPlantilla, setModalPlantilla] = useState<{
    plantilla: PlantillaConAsignados | null
  } | null>(null)

  const { data: usuario, isLoading: cargandoUsuario } = useUsuario()
  const esGestor =
    usuario?.rol === 'admin' || tienePermiso(usuario?.permisos, 'tareas_gestion')

  const { data: empleados } = useEmpleados()
  const { data: tareas, isLoading } = useTareasFecha(fecha)
  const { data: plantillas } = usePlantillas()
  const materializar = useMaterializar()
  const borrarPlantilla = useDeletePlantilla()
  const materializado = useRef(false)

  // Fallback del cron: generar las recurrentes de hoy al entrar (una vez).
  useEffect(() => {
    if (!materializado.current) {
      materializado.current = true
      materializar.mutate(hoy)
    }
  }, [hoy, materializar])

  const nombrePorId = useMemo(() => {
    const m = new Map<number, string>()
    for (const e of empleados ?? []) m.set(e.id, nombreCompleto(e))
    return m
  }, [empleados])

  const porEstado = useMemo(() => {
    const m: Record<string, TareaConParticipantes[]> = {
      pendiente: [],
      en_curso: [],
      completada: [],
      vencida: [],
      cancelada: [],
    }
    for (const t of tareas ?? []) m[t.estado]?.push(t)
    return m
  }, [tareas])

  function resumenAsignados(p: PlantillaConAsignados): string {
    if (p.alcance === 'todos') return 'Todos los empleados'
    const ids =
      p.tareas_recurrentes_asignados?.map((a) => a.empleado_id) ??
      (p.empleado_id ? [p.empleado_id] : [])
    if (ids.length === 0) return '—'
    if (ids.length === 1) return nombrePorId.get(ids[0]) ?? '—'
    return `${ids.length} empleados`
  }

  // Gate: la gestión de tareas es de encargadas/administración. Un cajero con
  // 'rrhh' que llegue por URL ve el aviso (RLS igual le negaría escribir).
  if (!cargandoUsuario && !esGestor) {
    return (
      <div className="p-6 max-w-lg mx-auto">
        <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-8 text-center space-y-2">
          <div className="inline-flex p-3 rounded-full bg-[#f9d2a2]/40">
            <Lock className="h-6 w-6 text-[#6f3a2a]" />
          </div>
          <p className="text-[#391511] font-semibold">
            No tenés permiso para gestionar tareas.
          </p>
          <p className="text-[#6f3a2a] text-sm">
            Tus tareas asignadas están en <span className="font-semibold">Mis tareas</span>.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 max-w-[1400px] mx-auto space-y-5">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[#391511] text-2xl font-bold">Tareas</h1>
          <p className="text-[#6f3a2a] text-sm mt-1">
            Asigná tareas al personal, únicas o recurrentes, y controlá el cumplimiento.
          </p>
        </div>
        <Button
          onClick={() => setModalTarea({ tarea: null })}
          className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5"
        >
          <Plus className="h-4 w-4" />
          Nueva tarea
        </Button>
      </header>

      <Tabs defaultValue="tablero" className="space-y-4">
        <TabsList className="bg-white border border-[#e4c9b0]/60 p-1 h-auto flex-wrap">
          <TabsTrigger value="tablero" className={claseTab}>
            Tablero del día
          </TabsTrigger>
          <TabsTrigger value="recurrentes" className={claseTab}>
            Recurrentes
          </TabsTrigger>
          <TabsTrigger value="cumplimiento" className={claseTab}>
            Cumplimiento
          </TabsTrigger>
        </TabsList>

        {/* ── Tablero (kanban por estado) ── */}
        <TabsContent value="tablero" className="space-y-3">
          <div className="flex items-center gap-2 bg-white border border-[#e4c9b0]/60 rounded-2xl px-3 py-2 w-fit">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setFecha(format(addDays(parseISO(fecha), -1), 'yyyy-MM-dd'))}
              className="h-8 w-8 p-0 text-[#6f3a2a]"
              aria-label="Día anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-[#391511] font-semibold text-sm capitalize min-w-[160px] text-center">
              {format(parseISO(fecha), "EEE d 'de' MMM", { locale: es })}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setFecha(format(addDays(parseISO(fecha), 1), 'yyyy-MM-dd'))}
              className="h-8 w-8 p-0 text-[#6f3a2a]"
              aria-label="Día siguiente"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            {fecha !== hoy && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setFecha(hoy)}
                className="h-8 text-xs text-[#6f3a2a]"
              >
                Hoy
              </Button>
            )}
          </div>

          {isLoading ? (
            <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-6">
              <SkeletonTabla filas={4} columnas={4} />
            </div>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {COLUMNAS_KANBAN.map((estado) => {
                const lista = porEstado[estado] ?? []
                const est = ESTADO_TAREA[estado]
                return (
                  <div
                    key={estado}
                    className="min-w-[260px] w-[260px] shrink-0 bg-[#fdfaf6] border border-[#e4c9b0]/60 rounded-2xl p-2.5 space-y-2"
                  >
                    <div className="flex items-center justify-between px-1">
                      <span className={cn('text-xs font-bold px-2 py-0.5 rounded-full', est.clase)}>
                        {est.label}
                      </span>
                      <span className="text-[#c8a58a] text-xs tabular-nums">{lista.length}</span>
                    </div>
                    {lista.length === 0 ? (
                      <p className="text-[#c8a58a] text-xs text-center py-4">—</p>
                    ) : (
                      lista.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => setModalTarea({ tarea: t })}
                          className="w-full text-left bg-white border border-[#e4c9b0]/60 rounded-xl p-2.5 shadow-sm hover:border-[#f9b44c] transition-colors space-y-1.5"
                        >
                          <div className="text-[#391511] text-sm font-medium leading-snug">
                            {t.titulo}
                          </div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span
                              className={cn(
                                'text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded',
                                PRIORIDAD_TAREA[t.prioridad].clase
                              )}
                            >
                              {PRIORIDAD_TAREA[t.prioridad].label}
                            </span>
                            {t.rechazos_count > 0 && t.estado !== 'completada' && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#c43e2c]/15 text-[#c43e2c]">
                                Rechazada ×{t.rechazos_count}
                              </span>
                            )}
                            {t.requiere_evidencia && (
                              <Camera className="h-3 w-3 text-[#c8a58a]" />
                            )}
                            {t.evidencia_url && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={t.evidencia_url}
                                alt=""
                                className="h-5 w-5 rounded object-cover ml-auto"
                              />
                            )}
                            <span className="ml-auto text-[10px] text-[#6f3a2a] truncate max-w-[110px]">
                              {t.empleado_id !== null ? (
                                nombrePorId.get(t.empleado_id) ?? '—'
                              ) : t.estado === 'completada' && t.completada_por != null ? (
                                `✓ ${nombrePorId.get(t.completada_por) ?? '—'}`
                              ) : (
                                <span className="inline-flex items-center gap-0.5">
                                  <Users className="h-3 w-3" />
                                  Grupal · {t.tareas_turno_participantes?.length ?? 0}
                                </span>
                              )}
                            </span>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </TabsContent>

        {/* ── Recurrentes (plantillas) ── */}
        <TabsContent value="recurrentes" className="space-y-3">
          <Button
            onClick={() => setModalPlantilla({ plantilla: null })}
            className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5"
          >
            <Repeat className="h-4 w-4" />
            Nueva recurrente
          </Button>
          <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden shadow-sm">
            {!plantillas || plantillas.length === 0 ? (
              <p className="p-10 text-center text-[#c8a58a] text-sm">
                Sin tareas recurrentes. Creá una para que se genere sola cada día.
              </p>
            ) : (
              <ul className="divide-y divide-[#e4c9b0]/40">
                {plantillas.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 px-4 py-3 hover:bg-[#fdfaf6]">
                    <button
                      onClick={() => setModalPlantilla({ plantilla: p })}
                      className="flex-1 text-left min-w-0"
                    >
                      <p className="text-[#391511] text-sm font-medium truncate">
                        {p.titulo}
                        {!p.activa && (
                          <span className="ml-2 text-[10px] uppercase font-bold text-[#c43e2c]">
                            pausada
                          </span>
                        )}
                      </p>
                      <p className="text-[#c8a58a] text-xs">
                        {resumenAsignados(p)} · {recurrenciaResumen(p)}
                        {p.vigencia_hasta &&
                          ` · hasta ${format(parseISO(p.vigencia_hasta), 'd MMM', { locale: es })}`}
                      </p>
                    </button>
                    <span
                      className={cn(
                        'text-[10px] uppercase font-bold px-1.5 py-0.5 rounded',
                        MODO_TAREA[p.modo].clase
                      )}
                    >
                      {MODO_TAREA[p.modo].label}
                    </span>
                    <span
                      className={cn(
                        'text-[10px] uppercase font-bold px-1.5 py-0.5 rounded',
                        PRIORIDAD_TAREA[p.prioridad].clase
                      )}
                    >
                      {PRIORIDAD_TAREA[p.prioridad].label}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (confirm(`¿Eliminar la recurrente "${p.titulo}"?`))
                          borrarPlantilla.mutate(p.id)
                      }}
                      className="h-8 w-8 p-0 text-[#c8a58a] hover:text-[#c43e2c] hover:bg-[#c43e2c]/10"
                      aria-label="Eliminar"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </TabsContent>

        {/* ── Cumplimiento (control histórico) ── */}
        <TabsContent value="cumplimiento">
          <TabCumplimiento />
        </TabsContent>
      </Tabs>

      {modalTarea && (
        <ModalTarea
          abierto={!!modalTarea}
          onCambioAbierto={(v) => !v && setModalTarea(null)}
          tarea={modalTarea.tarea}
          fechaDefault={fecha}
        />
      )}
      {modalPlantilla && (
        <ModalPlantilla
          abierto={!!modalPlantilla}
          onCambioAbierto={(v) => !v && setModalPlantilla(null)}
          plantilla={modalPlantilla.plantilla}
        />
      )}
    </div>
  )
}
