'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  actualizarSugerencia,
  crearSugerencia,
  getSugerencias,
  type CambiosSugerencia,
  type NuevaSugerencia,
} from '@/lib/queries/sugerencias'

export const SUGERENCIAS_KEY = ['sugerencias'] as const

export function useSugerencias() {
  return useQuery({
    queryKey: SUGERENCIAS_KEY,
    queryFn: () => getSugerencias(),
    staleTime: 30 * 1000,
  })
}

export function useCrearSugerencia() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: NuevaSugerencia) => crearSugerencia(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: SUGERENCIAS_KEY })
      toast.success('Sugerencia anotada · ¡gracias!')
    },
    onError: (e: Error) => {
      toast.error(`No se pudo anotar la sugerencia: ${e.message}`)
    },
  })
}

export function useActualizarSugerencia() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, cambios }: { id: number; cambios: CambiosSugerencia }) =>
      actualizarSugerencia(id, cambios),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: SUGERENCIAS_KEY })
    },
    onError: (e: Error) => {
      toast.error(`No se pudo actualizar: ${e.message}`)
    },
  })
}
