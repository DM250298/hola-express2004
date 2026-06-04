'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  getDatosParaMatch,
  aplicarConciliacion,
  getExtractos,
  getLineasExtracto,
  type AplicarConciliacionPayload,
} from '@/lib/queries/conciliacion'

export const CONCILIACION_KEY = ['conciliacion'] as const

export function useDatosParaMatch(cuentaId: number | undefined) {
  return useQuery({
    queryKey: [...CONCILIACION_KEY, 'datos', cuentaId],
    queryFn: () => getDatosParaMatch(cuentaId as number),
    enabled: cuentaId != null,
    staleTime: 10 * 1000,
  })
}

export function useExtractos() {
  return useQuery({
    queryKey: [...CONCILIACION_KEY, 'extractos'],
    queryFn: getExtractos,
    staleTime: 30 * 1000,
  })
}

export function useLineasExtracto(extractoId: number | undefined) {
  return useQuery({
    queryKey: [...CONCILIACION_KEY, 'lineas', extractoId],
    queryFn: () => getLineasExtracto(extractoId as number),
    enabled: extractoId != null,
  })
}

export function useAplicarConciliacion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: AplicarConciliacionPayload) =>
      aplicarConciliacion(payload),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: CONCILIACION_KEY })
      qc.invalidateQueries({ queryKey: ['acreditaciones'] })
      qc.invalidateQueries({ queryKey: ['cuentas'] })
      qc.invalidateQueries({ queryKey: ['movimientos-cuenta'] })
      const d = data as { conciliadas?: number; anomalias?: number } | null
      toast.success(
        `Conciliación aplicada · ${d?.conciliadas ?? 0} conciliadas, ${
          d?.anomalias ?? 0
        } anomalías`
      )
    },
    onError: (e: Error) =>
      toast.error(`No se pudo aplicar la conciliación: ${e.message}`),
  })
}
