'use client'

import { useQuery } from '@tanstack/react-query'
import { getAgenda, type TareaAgenda } from '@/lib/queries/agenda'

export const AGENDA_KEY = ['agenda'] as const

export function useAgenda(
  usuarioId: string | undefined,
  verTodas: boolean
) {
  return useQuery<TareaAgenda[]>({
    queryKey: [...AGENDA_KEY, usuarioId ?? null, verTodas],
    queryFn: () => getAgenda(usuarioId as string, verTodas),
    enabled: !!usuarioId,
    staleTime: 30 * 1000,
  })
}
