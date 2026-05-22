'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  cambiarEstadoTarea,
  createProyecto,
  createTarea,
  deleteProyecto,
  deleteTarea,
  getProyectos,
  getTareas,
  updateProyecto,
  updateTarea,
} from '@/lib/queries/proyectos'
import type {
  ProyectoInsert,
  ProyectoUpdate,
  TareaInsert,
  TareaUpdate,
} from '@/types/database'

export const PROYECTOS_KEY = ['proyectos'] as const
export const TAREAS_KEY = ['tareas'] as const

// ─── Proyectos ───────────────────────────────────────────────────────────────

export function useProyectos() {
  return useQuery({
    queryKey: PROYECTOS_KEY,
    queryFn: getProyectos,
    staleTime: 30 * 1000,
  })
}

export function useCreateProyecto() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (datos: ProyectoInsert) => createProyecto(datos),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PROYECTOS_KEY })
      toast.success('Proyecto creado')
    },
    onError: (e: Error) => toast.error(`No se pudo crear: ${e.message}`),
  })
}

export function useUpdateProyecto() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, datos }: { id: number; datos: ProyectoUpdate }) =>
      updateProyecto(id, datos),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PROYECTOS_KEY })
      toast.success('Proyecto actualizado')
    },
    onError: (e: Error) => toast.error(`No se pudo actualizar: ${e.message}`),
  })
}

export function useDeleteProyecto() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteProyecto(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PROYECTOS_KEY })
      toast.success('Proyecto eliminado')
    },
    onError: (e: Error) => toast.error(`No se pudo eliminar: ${e.message}`),
  })
}

// ─── Tareas ──────────────────────────────────────────────────────────────────

export function useTareas(proyectoId: number | undefined) {
  return useQuery({
    queryKey: [...TAREAS_KEY, proyectoId],
    queryFn: () => getTareas(proyectoId as number),
    enabled: !!proyectoId,
    staleTime: 15 * 1000,
  })
}

function useTareaMutation<TVars>(
  fn: (v: TVars) => Promise<unknown>,
  okMsg: string
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TAREAS_KEY })
      qc.invalidateQueries({ queryKey: PROYECTOS_KEY })
      if (okMsg) toast.success(okMsg)
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useCreateTarea() {
  return useTareaMutation(
    (datos: TareaInsert) => createTarea(datos),
    'Tarea creada'
  )
}

export function useUpdateTarea() {
  return useTareaMutation(
    ({ id, datos }: { id: number; datos: TareaUpdate }) =>
      updateTarea(id, datos),
    'Tarea actualizada'
  )
}

export function useDeleteTarea() {
  return useTareaMutation((id: number) => deleteTarea(id), 'Tarea eliminada')
}

/** Cambia el estado (mover de columna en el tablero). Sin toast. */
export function useCambiarEstadoTarea() {
  return useTareaMutation(
    ({ id, estado }: { id: number; estado: string }) =>
      cambiarEstadoTarea(id, estado),
    ''
  )
}
