'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  createSubtarea,
  deleteSubtarea,
  getSubtareas,
  marcarSubtarea,
  updateSubtarea,
} from '@/lib/queries/subtareas'
import { TAREAS_KEY } from './useProyectos'
import type { SubtareaInsert, SubtareaUpdate } from '@/types/database'

export const SUBTAREAS_KEY = ['subtareas'] as const

export function useSubtareas(tareaId: number | null | undefined) {
  return useQuery({
    queryKey: [...SUBTAREAS_KEY, tareaId],
    queryFn: () => getSubtareas(tareaId as number),
    enabled: !!tareaId,
    staleTime: 15 * 1000,
  })
}

function useSubtareaMutation<TVars>(
  fn: (v: TVars) => Promise<unknown>,
  okMsg: string
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: SUBTAREAS_KEY })
      qc.invalidateQueries({ queryKey: TAREAS_KEY })
      if (okMsg) toast.success(okMsg)
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useCreateSubtarea() {
  return useSubtareaMutation((d: SubtareaInsert) => createSubtarea(d), '')
}

export function useUpdateSubtarea() {
  return useSubtareaMutation(
    (v: { id: number; datos: SubtareaUpdate }) =>
      updateSubtarea(v.id, v.datos),
    ''
  )
}

export function useDeleteSubtarea() {
  return useSubtareaMutation((id: number) => deleteSubtarea(id), '')
}

export function useMarcarSubtarea() {
  return useSubtareaMutation(
    (v: { id: number; hecha: boolean }) => marcarSubtarea(v.id, v.hecha),
    ''
  )
}
