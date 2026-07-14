'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  getEtiquetasPendientes,
  quitarEtiquetaPendiente,
  quitarEtiquetasPendientes,
} from '@/lib/queries/etiquetas'

export const ETIQUETAS_PENDIENTES_KEY = ['etiquetas-pendientes'] as const

export function useEtiquetasPendientes() {
  return useQuery({
    queryKey: ETIQUETAS_PENDIENTES_KEY,
    queryFn: getEtiquetasPendientes,
    staleTime: 20 * 1000,
  })
}

export function useQuitarEtiqueta() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => quitarEtiquetaPendiente(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ETIQUETAS_PENDIENTES_KEY })
      toast.success('Etiqueta marcada como colocada')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo actualizar: ${error.message}`)
    },
  })
}

/** Marca un lote entero de etiquetas como colocadas (tras imprimir masivo). */
export function useQuitarEtiquetas() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ids: number[]) => quitarEtiquetasPendientes(ids),
    onSuccess: (_, ids) => {
      qc.invalidateQueries({ queryKey: ETIQUETAS_PENDIENTES_KEY })
      toast.success(`${ids.length} etiquetas marcadas como colocadas`)
    },
    onError: (error: Error) => {
      toast.error(`No se pudo actualizar: ${error.message}`)
    },
  })
}
