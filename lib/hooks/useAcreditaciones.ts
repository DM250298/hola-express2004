'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  getAcreditaciones,
  getResumenPorCobrar,
  acreditarPago,
  acreditarLote,
  type FiltrosAcreditaciones,
  type AcreditarPayload,
} from '@/lib/queries/acreditaciones'

export const ACREDITACIONES_KEY = ['acreditaciones'] as const

export function useAcreditaciones(filtros: FiltrosAcreditaciones = {}) {
  return useQuery({
    queryKey: [...ACREDITACIONES_KEY, filtros],
    queryFn: () => getAcreditaciones(filtros),
    staleTime: 30 * 1000,
  })
}

export function useResumenPorCobrar() {
  return useQuery({
    queryKey: [...ACREDITACIONES_KEY, 'resumen'],
    queryFn: getResumenPorCobrar,
    staleTime: 30 * 1000,
  })
}

function invalidar(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ACREDITACIONES_KEY })
  qc.invalidateQueries({ queryKey: ['cuentas'] })
  qc.invalidateQueries({ queryKey: ['movimientos-cuenta'] })
}

export function useAcreditarPago() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: AcreditarPayload) => acreditarPago(payload),
    onSuccess: () => {
      invalidar(qc)
      toast.success('Acreditación cobrada · ingresada al banco')
    },
    onError: (e: Error) => toast.error(`No se pudo acreditar: ${e.message}`),
  })
}

export function useAcreditarLote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      ids,
      usuarioId,
      fecha,
    }: {
      ids: number[]
      usuarioId: string
      fecha: string | null
    }) => acreditarLote(ids, usuarioId, fecha),
    onSuccess: (data) => {
      invalidar(qc)
      toast.success(`${data.length} acreditación(es) cobradas`)
    },
    onError: (e: Error) => toast.error(`Error al acreditar lote: ${e.message}`),
  })
}
