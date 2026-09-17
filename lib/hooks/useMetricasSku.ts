'use client'

import { useQuery } from '@tanstack/react-query'
import { getMetricasSku, getResumenSkus } from '@/lib/queries/metricasSku'

export const METRICAS_SKU_KEY = ['metricas-sku'] as const

/** Cálculo pesado (agrega todo el período en SQL): staleTime largo. */
export function useResumenSkus(desde: string, hasta: string) {
  return useQuery({
    queryKey: [...METRICAS_SKU_KEY, 'resumen', desde, hasta],
    queryFn: () => getResumenSkus(desde, hasta),
    staleTime: 5 * 60 * 1000,
  })
}

export function useMetricasSku(
  productoId: number | undefined,
  desde: string,
  hasta: string
) {
  return useQuery({
    queryKey: [...METRICAS_SKU_KEY, 'producto', productoId, desde, hasta],
    queryFn: () => {
      if (!productoId) return null
      return getMetricasSku(productoId, desde, hasta)
    },
    enabled: !!productoId,
    staleTime: 60 * 1000,
  })
}
