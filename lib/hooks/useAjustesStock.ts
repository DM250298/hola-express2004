'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  crearAjusteStock,
  getAjusteDetalle,
  getAjustesStock,
  type NuevoAjustePayload,
} from '@/lib/queries/ajustesStock'

export const AJUSTES_STOCK_KEY = ['ajustes-stock'] as const

export function useAjustesStock() {
  return useQuery({
    queryKey: AJUSTES_STOCK_KEY,
    queryFn: getAjustesStock,
    staleTime: 30 * 1000,
  })
}

export function useAjusteDetalle(ajusteId: number | null) {
  return useQuery({
    queryKey: ['ajuste-detalle', ajusteId],
    queryFn: () => {
      if (ajusteId === null) return []
      return getAjusteDetalle(ajusteId)
    },
    enabled: ajusteId !== null,
    staleTime: 60 * 1000,
  })
}

export function useCrearAjusteStock() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: NuevoAjustePayload) => crearAjusteStock(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: AJUSTES_STOCK_KEY })
      qc.invalidateQueries({ queryKey: ['productos'] })
      qc.invalidateQueries({ queryKey: ['inventario'] })
      qc.invalidateQueries({ queryKey: ['productos-con-stock'] })
      qc.invalidateQueries({ queryKey: ['alertas-stock'] })
      qc.invalidateQueries({ queryKey: ['movimientos-stock'] })
      toast.success('Ajuste de stock registrado')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo registrar el ajuste: ${error.message}`)
    },
  })
}
