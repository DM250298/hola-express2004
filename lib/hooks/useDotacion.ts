'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { getDotacionRequerida, guardarDotacionRequerida } from '@/lib/queries/dotacion'
import type { DotacionRequeridaInsert } from '@/types/database'

export const DOTACION_KEY = ['dotacion-requerida'] as const

export function useDotacionRequerida() {
  return useQuery({
    queryKey: DOTACION_KEY,
    queryFn: getDotacionRequerida,
    staleTime: 5 * 60 * 1000,
  })
}

export function useGuardarDotacion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (filas: DotacionRequeridaInsert[]) => guardarDotacionRequerida(filas),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: DOTACION_KEY })
      toast.success('Dotación requerida guardada')
    },
    onError: (e: Error) => toast.error(`No se pudo guardar la dotación: ${e.message}`),
  })
}
