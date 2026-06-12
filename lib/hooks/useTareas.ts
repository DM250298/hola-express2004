'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  cambiarEstadoTarea,
  completarTarea,
  createPlantilla,
  createTarea,
  deletePlantilla,
  deleteTarea,
  getPlantillas,
  getTareasFecha,
  materializarFecha,
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
    mutationFn: (datos: TareaRecurrenteInsert) => createPlantilla(datos),
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
    }: {
      id: string
      datos: Partial<TareaRecurrenteInsert>
    }) => updatePlantilla(id, datos),
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

/** Genera las tareas recurrentes del día si todavía no están (fallback del cron). */
export function useMaterializar() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (fecha: string) => materializarFecha(fecha),
    onSuccess: (n) => {
      if (n > 0) qc.invalidateQueries({ queryKey: TAREAS_KEY })
    },
  })
}
