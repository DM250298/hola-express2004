'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  getPeriodos,
  cerrarPeriodo,
  reabrirPeriodo,
  getAuditoria,
} from '@/lib/queries/cierrePeriodo'

export const PERIODOS_KEY = ['periodos-contables'] as const
export const AUDITORIA_KEY = ['auditoria'] as const

export function usePeriodos() {
  return useQuery({
    queryKey: PERIODOS_KEY,
    queryFn: () => getPeriodos(),
    staleTime: 60 * 1000,
  })
}

export function useAuditoria(limite = 100) {
  return useQuery({
    queryKey: [...AUDITORIA_KEY, limite],
    queryFn: () => getAuditoria(limite),
    staleTime: 30 * 1000,
  })
}

export function useCerrarPeriodo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      usuarioId,
      anio,
      mes,
    }: {
      usuarioId: string
      anio: number
      mes: number
    }) => cerrarPeriodo(usuarioId, anio, mes),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PERIODOS_KEY })
      qc.invalidateQueries({ queryKey: AUDITORIA_KEY })
      toast.success('Período cerrado')
    },
    onError: (e: Error) => toast.error(`No se pudo cerrar: ${e.message}`),
  })
}

export function useReabrirPeriodo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      usuarioId,
      anio,
      mes,
    }: {
      usuarioId: string
      anio: number
      mes: number
    }) => reabrirPeriodo(usuarioId, anio, mes),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PERIODOS_KEY })
      qc.invalidateQueries({ queryKey: AUDITORIA_KEY })
      toast.success('Período reabierto')
    },
    onError: (e: Error) => toast.error(`No se pudo reabrir: ${e.message}`),
  })
}
