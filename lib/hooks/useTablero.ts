'use client'

import { useQuery } from '@tanstack/react-query'
import {
  getMetricasAgrupadas,
  getTableroGerencial,
  type DimensionTablero,
} from '@/lib/queries/tablero'

export const TABLERO_KEY = ['tablero'] as const

/** Todo el tablero en un viaje. Pesado: se recalcula cada 2 minutos. */
export function useTableroGerencial(desde: string, hasta: string) {
  return useQuery({
    queryKey: [...TABLERO_KEY, 'gerencial', desde, hasta],
    queryFn: () => getTableroGerencial(desde, hasta),
    staleTime: 2 * 60 * 1000,
  })
}

export function useMetricasAgrupadas(
  dimension: DimensionTablero,
  desde: string,
  hasta: string
) {
  return useQuery({
    queryKey: [...TABLERO_KEY, 'agrupadas', dimension, desde, hasta],
    queryFn: () => getMetricasAgrupadas(dimension, desde, hasta),
    staleTime: 5 * 60 * 1000,
  })
}
