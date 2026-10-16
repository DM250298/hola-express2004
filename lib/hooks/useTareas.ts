'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  cambiarEstadoTarea,
  completarTarea,
  createPlantilla,
  createTarea,
  createTareaGrupal,
  createTareasIndividuales,
  deletePlantilla,
  deleteTarea,
  getCumplimiento,
  getPlantillas,
  getTareasAgenda,
  getTareasFecha,
  getTareasRango,
  iniciarTarea,
  materializarFecha,
  omitirTarea,
  reabrirTarea,
  rechazarTarea,
  trasladarTarea,
  updatePlantilla,
  updateTarea,
} from '@/lib/queries/tareas'
import type {
  EstadoTareaTurno,
  TareaRecurrenteInsert,
  TareaTurnoInsert,
} from '@/types/database'

export const PLANTILLAS_KEY = ['tareas-plantillas'] as const
export const TAREAS_KEY = ['tareas-turno'] as const
export const CUMPLIMIENTO_KEY = ['tareas-cumplimiento'] as const

// ─── Plantillas ────────────────────────────────────────────────────────────────

export function usePlantillas() {
  return useQuery({
    queryKey: PLANTILLAS_KEY,
    queryFn: getPlantillas,
    staleTime: 60 * 1000,
  })
}

export function useCreatePlantilla() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      datos,
      asignados,
    }: {
      datos: TareaRecurrenteInsert
      asignados: number[]
    }) => createPlantilla(datos, asignados),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PLANTILLAS_KEY })
      toast.success('Tarea recurrente creada')
    },
    onError: (e: Error) => toast.error(`No se pudo crear: ${e.message}`),
  })
}

export function useUpdatePlantilla() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      datos,
      asignados,
    }: {
      id: string
      datos: Partial<TareaRecurrenteInsert>
      asignados: number[]
    }) => updatePlantilla(id, datos, asignados),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PLANTILLAS_KEY })
      toast.success('Plantilla actualizada')
    },
    onError: (e: Error) => toast.error(`No se pudo actualizar: ${e.message}`),
  })
}

export function useDeletePlantilla() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deletePlantilla(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PLANTILLAS_KEY })
      toast.success('Plantilla eliminada')
    },
    onError: (e: Error) => toast.error(`No se pudo eliminar: ${e.message}`),
  })
}

// ─── Instancias (tareas del día) ─────────────────────────────────────────────

export function useTareasFecha(fecha: string) {
  return useQuery({
    queryKey: [...TAREAS_KEY, fecha],
    queryFn: () => getTareasFecha(fecha),
    enabled: !!fecha,
    staleTime: 15 * 1000,
  })
}

/** Instancias de un rango (drill-down del cumplimiento; solo gestión). */
export function useTareasRango(
  desde: string,
  hasta: string,
  filtros?: { plantillaId?: string | null; titulo?: string },
  habilitado = true
) {
  return useQuery({
    queryKey: [...TAREAS_KEY, 'rango', desde, hasta, filtros ?? null],
    queryFn: () => getTareasRango(desde, hasta, filtros),
    enabled: habilitado && !!desde && !!hasta,
    staleTime: 30 * 1000,
  })
}

export function useCreateTarea() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (datos: TareaTurnoInsert) => createTarea(datos),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TAREAS_KEY })
      toast.success('Tarea creada')
    },
    onError: (e: Error) => toast.error(`No se pudo crear: ${e.message}`),
  })
}

/** Crea una tarea única para varios empleados: N individuales o 1 grupal. */
export function useCreateTareas() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      datos,
      empleados,
      grupal,
    }: {
      datos: Omit<TareaTurnoInsert, 'empleado_id'>
      empleados: number[]
      grupal: boolean
    }) =>
      grupal
        ? createTareaGrupal(datos, empleados)
        : createTareasIndividuales(datos, empleados),
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({ queryKey: TAREAS_KEY })
      toast.success(
        vars.grupal
          ? 'Tarea grupal creada'
          : `Tarea creada para ${vars.empleados.length} empleado${vars.empleados.length === 1 ? '' : 's'}`
      )
    },
    onError: (e: Error) => toast.error(`No se pudo crear: ${e.message}`),
  })
}

export function useUpdateTarea() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, datos }: { id: string; datos: Partial<TareaTurnoInsert> }) =>
      updateTarea(id, datos),
    onSuccess: () => qc.invalidateQueries({ queryKey: TAREAS_KEY }),
    onError: (e: Error) => toast.error(`No se pudo guardar: ${e.message}`),
  })
}

export function useCambiarEstadoTarea() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, estado }: { id: string; estado: EstadoTareaTurno }) =>
      cambiarEstadoTarea(id, estado),
    onSuccess: () => qc.invalidateQueries({ queryKey: TAREAS_KEY }),
    onError: (e: Error) => toast.error(`No se pudo mover: ${e.message}`),
  })
}

export function useDeleteTarea() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteTarea(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TAREAS_KEY })
      toast.success('Tarea eliminada')
    },
    onError: (e: Error) => toast.error(`No se pudo eliminar: ${e.message}`),
  })
}

export function useCompletarTarea() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, evidenciaUrl }: { id: string; evidenciaUrl?: string | null }) =>
      completarTarea(id, evidenciaUrl),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TAREAS_KEY })
      toast.success('¡Tarea completada!')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

/** Agenda del día (mig 251): tareas de la fecha + las de ayer (noche viva). */
export function useTareasAgenda(fecha: string) {
  return useQuery({
    queryKey: [...TAREAS_KEY, 'agenda', fecha],
    queryFn: () => getTareasAgenda(fecha),
    enabled: !!fecha,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  })
}

export function useIniciarTarea() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => iniciarTarea(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TAREAS_KEY })
      toast.success('Tarea en curso')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

/** Solo gestión: vuelve a pendiente una completada, omitida o vencida. */
export function useReabrirTarea() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => reabrirTarea(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TAREAS_KEY })
      qc.invalidateQueries({ queryKey: CUMPLIMIENTO_KEY })
      toast.success('Tarea reabierta: vuelve a pendiente')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

/** Omite con motivo (impedimento): queda cancelada y no cuenta en cumplimiento. */
export function useOmitirTarea() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, motivo }: { id: string; motivo: string }) => omitirTarea(id, motivo),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TAREAS_KEY })
      qc.invalidateQueries({ queryKey: CUMPLIMIENTO_KEY })
      toast.success('Tarea omitida con motivo')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

/** Traslada al turno siguiente con trazabilidad (mig 253). */
export function useTrasladarTarea() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => trasladarTarea(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TAREAS_KEY })
      qc.invalidateQueries({ queryKey: CUMPLIMIENTO_KEY })
      toast.success('Tarea trasladada al turno siguiente')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

/** Rechaza una completada: vuelve a pendiente con el motivo registrado. */
export function useRechazarTarea() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, motivo }: { id: string; motivo: string }) =>
      rechazarTarea(id, motivo),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TAREAS_KEY })
      qc.invalidateQueries({ queryKey: CUMPLIMIENTO_KEY })
      toast.success('Tarea rechazada: vuelve a pendiente')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

/** Agregados de cumplimiento por rango (pantalla de control; solo gestión). */
export function useCumplimiento(desde: string, hasta: string) {
  return useQuery({
    queryKey: [...CUMPLIMIENTO_KEY, desde, hasta],
    queryFn: () => getCumplimiento(desde, hasta),
    enabled: !!desde && !!hasta,
    staleTime: 30 * 1000,
  })
}

/**
 * Botón "Actualizar según cronograma": misma RPC que la materialización
 * (mig 250, sincroniza con francos/licencias/coberturas) pero siempre avisa
 * y refresca el tablero.
 */
export function useSincronizarTareas() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (fecha: string) => materializarFecha(fecha),
    onSuccess: (n) => {
      qc.invalidateQueries({ queryKey: TAREAS_KEY })
      toast.success(
        n > 0
          ? `Se aplicaron ${n} ${n === 1 ? 'cambio' : 'cambios'} según el cronograma`
          : 'Las tareas ya estaban al día con el cronograma'
      )
    },
    onError: (e: Error) => toast.error(`No se pudo actualizar: ${e.message}`),
  })
}

/** Genera y sincroniza las tareas recurrentes del día al entrar (fallback del cron). */
export function useMaterializar() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (fecha: string) => materializarFecha(fecha),
    onSuccess: (n) => {
      if (n > 0) qc.invalidateQueries({ queryKey: TAREAS_KEY })
    },
  })
}
