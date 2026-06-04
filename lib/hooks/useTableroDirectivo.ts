'use client'

import { useQuery } from '@tanstack/react-query'
import { getTableroDirectivo } from '@/lib/queries/tableroDirectivo'

export function useTableroDirectivo(desde: string, hasta: string) {
  return useQuery({
    queryKey: ['tablero-directivo', desde, hasta],
    queryFn: () => getTableroDirectivo(desde, hasta),
    staleTime: 60 * 1000,
  })
}
